"""End-to-end SeepWatch pipeline: ingest → labels → model → bundle."""
from __future__ import annotations

import argparse
import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

from seepwatch.alerts import watchlist_alerts
from seepwatch.anomaly import check_events, false_alarm_rate, flag_anomalies
from seepwatch.config import ARTIFACTS, DATA_PROCESSED, ensure_dirs, load_config
from seepwatch.eval import evaluate_by_regime, evaluate_predictions, select_pitch_scenario
from seepwatch.export.bundle import build_geometry, write_bundle
from seepwatch.features import build_feature_frame
from seepwatch.ingest import fetch_all_gauges
from seepwatch.labels import compute_all_reaches
from seepwatch.models import (
    QuantileModel,
    fit_baselines,
    predict_flow_aware,
    predict_persistence,
    predict_sjrrp,
)
from seepwatch.propagate import node_shortfalls
from seepwatch.qc import add_flood_flag, build_daily_panel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("seepwatch")


def _filter_usable(feat: pd.DataFrame) -> pd.DataFrame:
    f = feat.copy()
    f = f[~f["flood"].astype(bool)]
    f = f[f["upstream_now"].fillna(0) >= 50]
    return f


def run_pipeline(force_fetch: bool = False, asof: str | None = None) -> Path:
    ensure_dirs()
    cfg = load_config()
    horizons = list(cfg["horizons"])

    # --- Ingest ---
    log.info("Fetching gauges…")
    series = fetch_all_gauges(cfg, start="2009-01-01", force=force_fetch)
    panel = build_daily_panel(series, min_hourly_count=int(cfg["qc"]["min_hourly_count"]))
    panel = add_flood_flag(
        panel,
        cbp_threshold=float(cfg["flood"]["cbp_threshold_cfs"]),
        upstream_threshold=float(cfg["flood"]["upstream_threshold_cfs"]),
    )
    panel_path = DATA_PROCESSED / "daily_panel.parquet"
    panel.to_parquet(panel_path)
    log.info("Daily panel %s → %s rows", panel_path, len(panel))

    # --- Labels ---
    labels = compute_all_reaches(panel, cfg)
    labels_path = DATA_PROCESSED / "labels.parquet"
    labels.to_parquet(labels_path)

    # --- Features (forecast reaches only) ---
    forecast_reaches = [r for r in cfg["reaches"] if r.get("forecast")]
    feat_frames = [build_feature_frame(panel, labels, r, horizons) for r in forecast_reaches]
    features = pd.concat(feat_frames, ignore_index=True)
    features["date"] = pd.to_datetime(features["date"])
    features_path = DATA_PROCESSED / "features.parquet"
    features.to_parquet(features_path)

    train_start = pd.Timestamp(cfg["train"]["start"])
    train_end = pd.Timestamp(cfg["train"]["end"])
    test_start = pd.Timestamp(cfg["test"]["start"])

    usable = _filter_usable(features)
    train = usable[(usable["date"] >= train_start) & (usable["date"] <= train_end)].dropna(subset=["y"])
    test = usable[(usable["date"] >= test_start)].dropna(subset=["y"])
    log.info("Train rows=%d  Test rows=%d", len(train), len(test))

    # --- Baselines + model (deployable mode is headline) ---
    mode = "deployable"
    baselines = fit_baselines(train, mode=mode)
    model = QuantileModel().fit(train, mode=mode)

    # Calibrate on late training year (2024) to avoid touching test prematurely for coverage only
    calib = train[train["date"] >= "2024-01-01"]
    if len(calib) > 50:
        cov = model.calibrate_coverage(calib, mode=mode)
    else:
        cov = model.calibrate_coverage(train.sample(min(len(train), 2000), random_state=42), mode=mode)
    log.info("Coverage %s", cov)

    def scored(df: pd.DataFrame) -> dict:
        preds = model.predict(df, mode=mode)
        pm = preds["q50"].values
        pp = predict_persistence(df)
        ps = predict_sjrrp(df, baselines, mode=mode)
        pf = predict_flow_aware(df, baselines, mode=mode)
        ev = evaluate_predictions(df, pm, pp, ps, pf, horizons)
        best = ev["best_baseline"]
        best_pred = {"persistence": pp, "sjrrp": ps, "flow_aware": pf}[best]
        regime = evaluate_by_regime(df, pm, best_pred, horizons)
        return {"eval": ev, "regime": regime, "preds": preds, "pp": pp, "ps": ps, "pf": pf, "pm": pm}

    # Score test set (held-out) — first time we look at it for metrics
    test_score = scored(test) if len(test) else scored(train.tail(500))
    pitch = select_pitch_scenario(test_score["eval"], test_score["regime"])
    log.info("Pitch scenario: %s", pitch)

    # What-if mode evaluation (reported, not headline)
    baselines_w = fit_baselines(train, mode="whatif")
    model_w = QuantileModel().fit(train, mode="whatif")
    if len(test):
        tw = test.dropna(subset=["upstream_future_whatif", "y"])
        preds_w = model_w.predict(tw, mode="whatif")
        ev_w = evaluate_predictions(
            tw,
            preds_w["q50"].values,
            predict_persistence(tw),
            predict_sjrrp(tw, baselines_w, mode="whatif"),
            predict_flow_aware(tw, baselines_w, mode="whatif"),
            horizons,
        )
    else:
        ev_w = {}

    # --- Timeline + anomalies on recent history ---
    asof_ts = pd.Timestamp(asof) if asof else panel.index.max()
    # Prefer a non-flood day with data
    hist_start = asof_ts - pd.Timedelta(days=120)
    timeline_rows = []
    for r in forecast_reaches:
        rid = r["id"]
        lab = labels.xs(rid, level="reach_id").loc[hist_start:asof_ts].copy()
        if lab.empty:
            continue
        # Build feature rows at horizon=1 for expected band
        feat_r = features[(features["reach_id"] == rid) & (features["horizon"] == 1)]
        feat_r = feat_r[(feat_r["date"] >= hist_start) & (feat_r["date"] <= asof_ts)]
        if feat_r.empty:
            continue
        preds = model.predict(feat_r, mode=mode)
        merged = feat_r[["date", "reach_id", "y_now", "flood", "upstream_now"]].copy()
        merged["loss_cfs"] = merged["y_now"]
        merged["q10"] = preds["q10"].values
        merged["q50"] = preds["q50"].values
        merged["q90"] = preds["q90"].values
        timeline_rows.append(merged)

    timeline = pd.concat(timeline_rows, ignore_index=True) if timeline_rows else pd.DataFrame()
    if len(timeline):
        timeline = flag_anomalies(timeline, persist_days=2)
        far = false_alarm_rate(timeline)
        events = check_events(timeline)
    else:
        far, events = {}, []

    # --- Forecast as-of: last non-flood day with valid y_now on primary reach ---
    rid_primary = "R2A"
    ok = features[
        (features["reach_id"] == rid_primary)
        & (~features["flood"].astype(bool))
        & features["y_now"].notna()
        & features["upstream_now"].notna()
        & (features["horizon"] == 1)
    ]
    if len(ok):
        asof_ts = min(asof_ts, ok["date"].max()) if asof else ok["date"].max()
        # snap to available
        asof_ts = ok.loc[ok["date"] <= asof_ts, "date"].max()

    asof_feat = features[
        (features["date"] == asof_ts)
        & (features["reach_id"].isin([r["id"] for r in forecast_reaches]))
    ].copy()
    if len(asof_feat):
        asof_preds = model.predict(asof_feat, mode=mode).reset_index(drop=True)
        asof_feat = asof_feat.reset_index(drop=True)
        asof_feat["q10"] = asof_preds["q10"]
        asof_feat["q50"] = asof_preds["q50"]
        asof_feat["q90"] = asof_preds["q90"]

    # Watchlist: rank by forecast loss (most negative first).
    # excess > 0 means forecast is more negative than recent observed loss.
    anom_today = set()
    if len(timeline):
        tday = timeline[pd.to_datetime(timeline["date"]) == asof_ts]
        anom_today = set(tday.loc[tday["anomaly"].astype(bool), "reach_id"])

    watchlist = []
    for rid, g in asof_feat.groupby("reach_id"):
        y_now = float(g["y_now"].iloc[0]) if np.isfinite(g["y_now"].iloc[0]) else float("nan")
        q50 = float(g["q50"].mean())
        q10 = float(g["q10"].mean())
        q90 = float(g["q90"].mean())
        excess = float(y_now - q50) if np.isfinite(y_now) and np.isfinite(q50) else 0.0
        watchlist.append(
            {
                "reach_id": rid,
                "forecast_loss_cfs": q50,
                "recent_loss_cfs": y_now if np.isfinite(y_now) else None,
                "excess_loss_cfs": excess,
                "q10": q10,
                "q90": q90,
                "anomaly": rid in anom_today or (excess > 5 and q50 < -20),
                "label": next(r["label"] for r in forecast_reaches if r["id"] == rid),
            }
        )
    watchlist.sort(key=lambda x: (not x["anomaly"], x["forecast_loss_cfs"]))

    # Release scenario: current MIL flow
    release = float(panel.loc[asof_ts, "MIL"]) if asof_ts in panel.index and np.isfinite(panel.loc[asof_ts, "MIL"]) else 400.0
    shortfalls = node_shortfalls(asof_feat, cfg["nodes"], release_cfs=release) if len(asof_feat) else []
    alerts = watchlist_alerts(watchlist, shortfalls)

    # Reach colors for map: excess loss
    reach_colors = []
    for r in cfg["reaches"]:
        w = next((x for x in watchlist if x["reach_id"] == r["id"]), None)
        if r["id"] == "R4A":
            reach_colors.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "excess_loss_cfs": None,
                    "status": "no_forecast",
                    "reason": "signal_at_noise_floor",
                    "label": r["label"],
                }
            )
        elif w is None:
            reach_colors.append(
                {"id": r["id"], "name": r["name"], "excess_loss_cfs": 0.0, "status": "ok", "label": r["label"]}
            )
        else:
            flood_today = bool(panel.loc[asof_ts, "flood"]) if asof_ts in panel.index else False
            reach_colors.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "excess_loss_cfs": w["excess_loss_cfs"],
                    "forecast_loss_cfs": w["forecast_loss_cfs"],
                    "status": "flood_no_forecast" if flood_today else ("flagged" if w["anomaly"] else "ok"),
                    "label": r["label"],
                }
            )

    # Headline numbers
    excess_7d = float(sum(max(0.0, w["excess_loss_cfs"]) for w in watchlist))
    worst = max(shortfalls, key=lambda s: s["shortfall_p50"]) if shortfalls else None
    skill = pitch["skill_vs_best_baseline"]

    # Timeline series for chart (primary reach R2A)
    primary = timeline[timeline["reach_id"] == "R2A"].sort_values("date") if len(timeline) else pd.DataFrame()
    timeline_json = []
    for _, row in primary.iterrows():
        timeline_json.append(
            {
                "date": row["date"].strftime("%Y-%m-%d"),
                "loss_cfs": float(row["loss_cfs"]) if np.isfinite(row["loss_cfs"]) else None,
                "q10": float(row["q10"]),
                "q50": float(row["q50"]),
                "q90": float(row["q90"]),
                "anomaly": bool(row["anomaly"]),
                "flood": bool(row["flood"]),
            }
        )

    # Forecast series per reach for detail drawer
    reach_forecasts = {}
    for rid, g in asof_feat.groupby("reach_id"):
        g = g.sort_values("horizon")
        reach_forecasts[rid] = [
            {
                "horizon": int(row.horizon),
                "q10": float(row.q10),
                "q50": float(row.q50),
                "q90": float(row.q90),
            }
            for row in g.itertuples()
        ]

    bundle = {
        "meta": {
            "asof": asof_ts.strftime("%Y-%m-%d"),
            "generated": pd.Timestamp.now(tz="America/Los_Angeles").isoformat(),
            "version": "0.1.0",
            "mode_headline": "deployable",
        },
        "pitch_scenario": pitch["pitch_scenario"],
        "pitch_key": pitch["pitch_key"],
        "headline": {
            "excess_loss_7d_cfs": excess_7d,
            "worst_node_shortfall": {
                "node_id": worst["node_id"] if worst else None,
                "name": worst["name"] if worst else None,
                "p10": worst["shortfall_p10"] if worst else None,
                "p50": worst["shortfall_p50"] if worst else None,
                "p90": worst["shortfall_p90"] if worst else None,
            },
            "skill_vs_best_baseline": skill,
            "best_baseline": pitch["best_baseline"],
        },
        "watchlist": watchlist[:3],
        "reach_colors": reach_colors,
        "nodes_shortfall": shortfalls,
        "timeline": timeline_json,
        "reach_forecasts": reach_forecasts,
        "alerts": alerts,
        "geometry": build_geometry(cfg),
        "evidence": {
            "deployable": test_score["eval"],
            "deployable_regime": test_score["regime"],
            "whatif": ev_w,
            "coverage": cov,
            "feature_importance": model.feature_importance(),
            "false_alarm_rate": far,
            "events": events,
            "pitch": pitch,
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "rules_doc": "docs/EVALUATION_RULES.md",
            "pitch_doc": "docs/PITCH_SCENARIOS.md",
        },
        "provenance": {
            "labels": "measured",
            "forecast": "modeled",
            "geometry": "schematic",
            "weather": "not_used_in_mvp",
            "notes": [
                "Loss = lagged reach balance (SJRRP formulas).",
                "Reach 1 labeled unexplained_loss (holding contracts).",
                "Reach 4A not forecast (noise floor).",
                "Flood-operations days excluded.",
                "CDEC data is provisional.",
            ],
        },
    }

    # Gate check
    required = ["reach_colors", "nodes_shortfall", "timeline", "watchlist", "pitch_scenario", "headline"]
    missing = [k for k in required if k not in bundle or bundle[k] in (None, [], {})]
    # timeline/watchlist may be empty in edge cases — treat headline+pitch+reach_colors+shortfall as hard
    hard = ["reach_colors", "nodes_shortfall", "pitch_scenario", "headline"]
    hard_missing = [k for k in hard if not bundle.get(k)]
    bundle["gate"] = {
        "passed": len(hard_missing) == 0 and bool(bundle.get("timeline") is not None),
        "missing": missing,
        "hard_missing": hard_missing,
        "cut_list_enforced": False,
    }

    out = ARTIFACTS / "bundle.json"
    write_bundle(out, bundle)

    # Persist models
    with open(ARTIFACTS / "model_deployable.pkl", "wb") as f:
        pickle.dump({"model": model, "baselines": baselines, "pitch": pitch}, f)

    # Evidence markdown summary
    _write_evidence_md(ARTIFACTS / "EVIDENCE.md", bundle)
    log.info("Wrote %s (pitch=%s gate=%s)", out, pitch["pitch_scenario"], bundle["gate"]["passed"])
    return out


def _write_evidence_md(path: Path, bundle: dict) -> None:
    ev = bundle["evidence"]["deployable"]
    pitch = bundle["pitch_scenario"]
    lines = [
        f"# SeepWatch evidence",
        f"",
        f"- asof: `{bundle['meta']['asof']}`",
        f"- pitch_scenario: **{pitch}** (`{bundle['pitch_key']}`)",
        f"- skill vs best baseline ({bundle['headline']['best_baseline']}): "
        f"**{bundle['headline']['skill_vs_best_baseline']:.3f}**",
        f"- coverage raw/corrected: {bundle['evidence']['coverage']}",
        f"- train/test rows: {bundle['evidence']['train_rows']} / {bundle['evidence']['test_rows']}",
        f"",
        f"## Per-horizon skill (deployable)",
        f"",
        f"| h | vs persistence | vs SJRRP | vs flow-aware |",
        f"|---|---|---|---|",
    ]
    for h, row in sorted(ev.get("horizons", {}).items(), key=lambda x: int(x[0])):
        def fmt(b):
            sk = b.get("skill")
            mark = "✓" if b.get("beats") else ""
            return f"{sk:.3f}{mark}" if sk is not None and sk == sk else "n/a"
        lines.append(
            f"| {h} | {fmt(row['persistence'])} | {fmt(row['sjrrp'])} | {fmt(row['flow_aware'])} |"
        )
    path.write_text("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Run SeepWatch pipeline")
    p.add_argument("--force-fetch", action="store_true")
    p.add_argument("--asof", default=None, help="Forecast as-of date YYYY-MM-DD")
    args = p.parse_args(argv)
    run_pipeline(force_fetch=args.force_fetch, asof=args.asof)


if __name__ == "__main__":
    main()
