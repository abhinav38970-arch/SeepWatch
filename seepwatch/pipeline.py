"""End-to-end SeepWatch pipeline: ingest → labels → model → bundle."""
from __future__ import annotations

import argparse
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
    NormalBandModel,
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
    if "target_flood" in f.columns:
        f = f[~f["target_flood"].astype(bool)]
    f = f[f["upstream_now"].fillna(0) >= 50]
    if "upstream_lag_now" in f.columns:
        f = f[f["upstream_lag_now"].fillna(0) >= 50]
    f = f[f["y_now"].notna()]
    return f


def run_pipeline(force_fetch: bool = False, asof: str | None = None) -> Path:
    ensure_dirs()
    cfg = load_config()
    horizons = list(cfg["horizons"])

    # --- Ingest ---
    log.info("Fetching gauges…")
    series = fetch_all_gauges(cfg, start="2009-01-01", force=force_fetch)
    panel = build_daily_panel(series, min_hourly_count=int(cfg["qc"]["min_hourly_count"]))
    upstream_cols = tuple(sorted({r["upstream"] for r in cfg["reaches"]}))
    panel = add_flood_flag(
        panel,
        upstream_cols=upstream_cols,
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

    # --- Features (forecast reaches) ---
    forecast_reaches = [r for r in cfg["reaches"] if r.get("forecast")]
    feat_frames = [build_feature_frame(panel, labels, r, horizons) for r in forecast_reaches]
    features = pd.concat(feat_frames, ignore_index=True)
    features["date"] = pd.to_datetime(features["date"])
    features["target_date"] = pd.to_datetime(features["target_date"])
    features_path = DATA_PROCESSED / "features.parquet"
    features.to_parquet(features_path)

    # Snap asof_ts early so no future data is used if --asof is specified
    rid_primary = "R2A"
    ok_asof = features[
        (features["reach_id"] == rid_primary)
        & (~features["flood"].astype(bool))
        & features["y_now"].notna()
        & (features["upstream_now"].fillna(0) >= 50)
        & (features["horizon"] == 1)
    ]
    if asof:
        req_asof = pd.Timestamp(asof)
        ok_sub = ok_asof[ok_asof["date"] <= req_asof]
        asof_ts = ok_sub["date"].max() if len(ok_sub) else req_asof
    else:
        asof_ts = ok_asof["date"].max() if len(ok_asof) else panel.index.max()

    train_start = pd.Timestamp(cfg["train"]["start"])
    train_end = pd.Timestamp(cfg["train"]["end"])
    test_start = pd.Timestamp(cfg["test"]["start"])

    usable = _filter_usable(features)
    # Prevent target-date boundary leakage from train into test
    train = usable[
        (usable["date"] >= train_start) & (usable["target_date"] <= train_end)
    ].dropna(subset=["y"])
    test = usable[
        (usable["date"] >= test_start) & (usable["target_date"] <= asof_ts)
    ].dropna(subset=["y"])
    log.info("Train rows=%d  Test rows=%d  asof=%s", len(train), len(test), asof_ts.strftime("%Y-%m-%d"))

    # --- Baselines + model (deployable mode is headline) ---
    mode = "deployable"
    baselines = fit_baselines(train, mode=mode)

    # Out-of-sample interval scale calibration on 2024 (trained on 2016-2023)
    calib_split = pd.Timestamp("2024-01-01")
    train_pre2024 = train[train["target_date"] < calib_split]
    calib_2024 = train[train["date"] >= calib_split]

    model = QuantileModel().fit(train, mode=mode)
    if len(train_pre2024) > 500 and len(calib_2024) > 50:
        cal_model = QuantileModel().fit(train_pre2024, mode=mode)
        cal_info = cal_model.calibrate_coverage(calib_2024, test_df=None, mode=mode)
        learned_scale = float(cal_info["scale"])
    else:
        learned_scale = 1.0
        cal_info = {"calib_2024_raw": None, "calib_2024_corrected": None}

    # Evaluate coverage on held-out test set (applying out-of-sample learned_scale)
    eval_target = test if len(test) else calib_2024
    model.scale = 1.0
    preds_raw_test = model.predict(eval_target, mode=mode)
    y_eval = eval_target["y"].values.astype(float)
    valid_eval = np.isfinite(y_eval) & np.isfinite(preds_raw_test["q10_raw"].values)
    cov_raw_test = (
        float(((y_eval >= preds_raw_test["q10_raw"].values) & (y_eval <= preds_raw_test["q90_raw"].values))[valid_eval].mean())
        if valid_eval.any()
        else float("nan")
    )
    model.scale = learned_scale
    preds_scaled_test = model.predict(eval_target, mode=mode)
    cov_corr_test = (
        float(((y_eval >= preds_scaled_test["q10"].values) & (y_eval <= preds_scaled_test["q90"].values))[valid_eval].mean())
        if valid_eval.any()
        else float("nan")
    )
    cov = {
        "coverage_raw": cov_raw_test,
        "coverage_corrected": cov_corr_test,
        "calib_2024_raw": cal_info.get("calib_2024_raw"),
        "calib_2024_corrected": cal_info.get("calib_2024_corrected"),
        "scale": float(model.scale),
    }
    log.info("Coverage (held-out test): %s", cov)

    # Fit physical normal-band model (flow + recharge + season, no y_now anchor)
    normal_model = NormalBandModel().fit(train)

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

    # Score held-out test set
    test_score = scored(test) if len(test) else scored(train.tail(500))
    pitch = select_pitch_scenario(test_score["eval"], test_score["regime"])
    log.info("Pitch scenario: %s", pitch)

    # What-if mode evaluation (reported, not headline)
    baselines_w = fit_baselines(train, mode="whatif")
    model_w = QuantileModel().fit(train, mode="whatif")
    model_w.scale = model.scale
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

    # --- Historical anomaly detection + 120-day timelines for all reaches ---
    # Align 3-day-ahead forecast made at (t - 3) with target_date == t so the
    # expected band on date t is genuinely out-of-time (no y_now(t) cancellation).
    hist_start = asof_ts - pd.Timedelta(days=120)
    full_hist_rows = []
    for r in forecast_reaches:
        rid = r["id"]
        feat_r = features[
            (features["reach_id"] == rid)
            & (features["horizon"] == 3)
            & (features["target_date"] >= pd.Timestamp("2016-01-01"))
            & (features["target_date"] <= asof_ts)
            & features["y"].notna()
            & features["y_now"].notna()
        ].copy()
        if feat_r.empty:
            continue
        preds_h3 = model.predict(feat_r, mode=mode)
        merged = pd.DataFrame(
            {
                "date": feat_r["target_date"].values,
                "reach_id": rid,
                "loss_cfs": feat_r["y"].values,
                "flood": feat_r["target_flood"].values,
                "upstream_now": feat_r["upstream_future_deploy"].values,
                "q10": preds_h3["q10"].values,
                "q50": preds_h3["q50"].values,
                "q90": preds_h3["q90"].values,
            }
        )
        full_hist_rows.append(merged)

    full_hist = pd.concat(full_hist_rows, ignore_index=True) if full_hist_rows else pd.DataFrame()
    if len(full_hist):
        full_hist = flag_anomalies(full_hist, persist_days=2)
        recent_hist = full_hist[full_hist["date"] >= hist_start].copy()
        # Compute false alarm rate across the training/validation history (2016-2024)
        # and flag rate on the recent window
        base_hist = full_hist[full_hist["date"] <= train_end]
        far = false_alarm_rate(base_hist if len(base_hist) else recent_hist)
        events = check_events(full_hist)
    else:
        recent_hist = pd.DataFrame()
        far, events = {}, []

    timelines_by_reach: dict[str, list[dict]] = {}
    if len(recent_hist):
        for rid, g in recent_hist.groupby("reach_id"):
            g = g.sort_values("date")
            timelines_by_reach[str(rid)] = [
                {
                    "date": row.date.strftime("%Y-%m-%d"),
                    "loss_cfs": float(row.loss_cfs) if np.isfinite(row.loss_cfs) else None,
                    "q10": float(row.q10),
                    "q50": float(row.q50),
                    "q90": float(row.q90),
                    "excess_loss_cfs": float(row.excess_loss_cfs),
                    "anomaly": bool(row.anomaly),
                    "flood": bool(row.flood),
                }
                for row in g.itertuples()
            ]

    # Also build context timeline for R4A (observed balance vs noise floor band)
    if "R4A" in labels.index.get_level_values("reach_id"):
        r4_lab = labels.xs("R4A", level="reach_id").loc[hist_start:asof_ts].dropna(subset=["loss_cfs"]).copy()
        if len(r4_lab):
            r4_med = float(r4_lab.loc[~r4_lab["flood"].astype(bool), "loss_cfs"].median()) if (~r4_lab["flood"].astype(bool)).any() else -8.0
            timelines_by_reach["R4A"] = [
                {
                    "date": idx.strftime("%Y-%m-%d"),
                    "loss_cfs": float(row["loss_cfs"]) if np.isfinite(row["loss_cfs"]) else None,
                    "q10": float(r4_med - max(5.0, float(row["uncertainty_cfs"]) if np.isfinite(row["uncertainty_cfs"]) else 8.0)),
                    "q50": float(r4_med),
                    "q90": float(r4_med + max(5.0, float(row["uncertainty_cfs"]) if np.isfinite(row["uncertainty_cfs"]) else 8.0)),
                    "excess_loss_cfs": 0.0,
                    "anomaly": False,
                    "flood": bool(row["flood"]),
                }
                for idx, row in r4_lab.iterrows()
            ]

    # --- Forecast as-of ---
    asof_feat = features[
        (features["date"] == asof_ts)
        & (features["reach_id"].isin([r["id"] for r in forecast_reaches]))
    ].copy()
    if len(asof_feat):
        asof_preds = model.predict(asof_feat, mode=mode).reset_index(drop=True)
        asof_norm = normal_model.predict(asof_feat, ref_col="upstream_future_deploy").reset_index(drop=True)
        asof_feat = asof_feat.reset_index(drop=True)
        asof_feat["q10"] = asof_preds["q10"]
        asof_feat["q50"] = asof_preds["q50"]
        asof_feat["q90"] = asof_preds["q90"]
        asof_feat["normal_q10"] = asof_norm["normal_q10"]
        asof_feat["normal_q50"] = asof_norm["normal_q50"]
        asof_feat["normal_q90"] = asof_norm["normal_q90"]

    anom_today = set()
    if len(recent_hist):
        tday = recent_hist[pd.to_datetime(recent_hist["date"]) == asof_ts]
        anom_today = set(tday.loc[tday["anomaly"].astype(bool), "reach_id"])

    watchlist = []
    for rid, g in asof_feat.groupby("reach_id"):
        y_now = float(g["y_now"].iloc[0]) if np.isfinite(g["y_now"].iloc[0]) else float("nan")
        q50 = float(g["q50"].mean())
        q10 = float(g["q10"].mean())
        q90 = float(g["q90"].mean())
        norm_q50 = float(g["normal_q50"].mean())
        norm_q10 = float(g["normal_q10"].mean())
        # Excess loss magnitude above normal loss magnitude (clamping net gains > 0 to 0 loss)
        fc_loss_mag = max(0.0, -q50)
        norm_loss_mag = max(0.0, -norm_q50)
        excess = float(fc_loss_mag - norm_loss_mag)
        band_width = max(5.0, norm_q50 - norm_q10)
        is_anom = bool((rid in anom_today) or (q50 < norm_q10 and excess > band_width and q50 < -20.0))
        watchlist.append(
            {
                "reach_id": str(rid),
                "forecast_loss_cfs": q50,
                "normal_loss_cfs": norm_q50,
                "recent_loss_cfs": y_now if np.isfinite(y_now) else None,
                "excess_loss_cfs": excess,
                "q10": q10,
                "q90": q90,
                "anomaly": is_anom,
                "label": next(r["label"] for r in forecast_reaches if r["id"] == rid),
            }
        )
    # Sort watchlist: flagged first, then highest excess loss, then largest loss magnitude
    watchlist.sort(key=lambda x: (not x["anomaly"], -x["excess_loss_cfs"], x["forecast_loss_cfs"]))

    # R4A historical context loss for SWA propagation
    r4a_context = {"q10": -16.0, "q50": -9.0, "q90": -2.0, "normal_q50": -9.0}
    if "R4A" in labels.index.get_level_values("reach_id"):
        r4_nonflood = labels.xs("R4A", level="reach_id")
        r4_nonflood = r4_nonflood[(~r4_nonflood["flood"].astype(bool)) & r4_nonflood["loss_cfs"].notna()]
        r4_recent = r4_nonflood.loc["2018-01-01":asof_ts, "loss_cfs"]
        if len(r4_recent) >= 30:
            r4a_context = {
                "q10": float(r4_recent.quantile(0.10)),
                "q50": float(r4_recent.quantile(0.50)),
                "q90": float(r4_recent.quantile(0.90)),
                "normal_q50": float(r4_recent.quantile(0.50)),
            }

    release = (
        float(panel.loc[asof_ts, "MIL"])
        if asof_ts in panel.index and np.isfinite(panel.loc[asof_ts, "MIL"])
        else 400.0
    )
    shortfalls = (
        node_shortfalls(asof_feat, cfg["nodes"], release_cfs=release, r4a_context_loss=r4a_context)
        if len(asof_feat)
        else []
    )
    alerts = watchlist_alerts(watchlist, shortfalls)

    # Reach colors for map
    reach_colors = []
    for r in cfg["reaches"]:
        w = next((x for x in watchlist if x["reach_id"] == r["id"]), None)
        if r["id"] == "R4A":
            reach_colors.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "excess_loss_cfs": None,
                    "forecast_loss_cfs": r4a_context["q50"],
                    "normal_loss_cfs": r4a_context["normal_q50"],
                    "status": "no_forecast",
                    "reason": "signal_at_noise_floor",
                    "label": r["label"],
                }
            )
        elif w is None:
            reach_colors.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "excess_loss_cfs": 0.0,
                    "status": "ok",
                    "label": r["label"],
                }
            )
        else:
            flood_today = bool(panel.loc[asof_ts, "flood"]) if asof_ts in panel.index else False
            reach_colors.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "excess_loss_cfs": w["excess_loss_cfs"],
                    "forecast_loss_cfs": w["forecast_loss_cfs"],
                    "normal_loss_cfs": w["normal_loss_cfs"],
                    "status": "flood_no_forecast"
                    if flood_today
                    else ("flagged" if w["anomaly"] else "ok"),
                    "label": r["label"],
                }
            )

    excess_7d = float(sum(max(0.0, w["excess_loss_cfs"]) for w in watchlist))
    worst = (
        max(shortfalls, key=lambda s: (s["shortfall_p50"], s["shortfall_p90"]))
        if shortfalls
        else None
    )
    skill = pitch["skill_vs_best_baseline"]

    timeline_json = timelines_by_reach.get("R2A", [])

    reach_forecasts = {}
    for rid, g in asof_feat.groupby("reach_id"):
        g = g.sort_values("horizon")
        reach_forecasts[str(rid)] = [
            {
                "horizon": int(row.horizon),
                "q10": float(row.q10),
                "q50": float(row.q50),
                "q90": float(row.q90),
                "normal_q50": float(row.normal_q50),
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
        "timelines_by_reach": timelines_by_reach,
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

    required = ["reach_colors", "nodes_shortfall", "timeline", "watchlist", "pitch_scenario", "headline"]
    missing = [k for k in required if k not in bundle or bundle[k] in (None, [], {})]
    hard = ["reach_colors", "nodes_shortfall", "pitch_scenario", "headline"]
    hard_missing = [k for k in hard if not bundle.get(k)]
    bundle["gate"] = {
        "passed": bool(len(hard_missing) == 0 and bool(bundle.get("timeline") is not None)),
        "missing": missing,
        "hard_missing": hard_missing,
        "cut_list_enforced": False,
    }

    out = ARTIFACTS / "bundle.json"
    write_bundle(out, bundle)

    with open(ARTIFACTS / "model_deployable.pkl", "wb") as f:
        pickle.dump(
            {
                "model": model,
                "normal_model": normal_model,
                "baselines": baselines,
                "pitch": pitch,
            },
            f,
        )

    _write_evidence_md(ARTIFACTS / "EVIDENCE.md", bundle)
    log.info("Wrote %s (pitch=%s gate=%s)", out, pitch["pitch_scenario"], bundle["gate"]["passed"])
    return out


def _write_evidence_md(path: Path, bundle: dict) -> None:
    ev = bundle["evidence"]["deployable"]
    pitch = bundle["pitch_scenario"]
    cov = bundle["evidence"]["coverage"]
    lines = [
        "# SeepWatch evidence",
        "",
        f"- asof: `{bundle['meta']['asof']}`",
        f"- pitch_scenario: **{pitch}** (`{bundle['pitch_key']}`)",
        f"- skill vs best baseline ({bundle['headline']['best_baseline']}): "
        f"**{bundle['headline']['skill_vs_best_baseline']:.3f}**",
        f"- skill vs SJRRP curve: **{ev['overall']['sjrrp']['mean_skill']:.3f}**",
        f"- skill vs flow-aware regression: **{ev['overall']['flow_aware']['mean_skill']:.3f}**",
        f"- held-out 80% interval coverage (raw / calibrated): "
        f"`{cov['coverage_raw']:.3f}` / `{cov['coverage_corrected']:.3f}` (scale `{cov['scale']:.2f}`)",
        f"- train/test rows: {bundle['evidence']['train_rows']} / {bundle['evidence']['test_rows']}",
        "",
        "## Per-horizon skill (deployable)",
        "",
        "| h | vs persistence | vs SJRRP | vs flow-aware |",
        "|---|---|---|---|",
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
