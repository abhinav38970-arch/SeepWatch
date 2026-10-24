"""Pre-registered evaluation: skill, block-bootstrap CIs, pitch scenario selection."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    m = np.isfinite(y_true) & np.isfinite(y_pred)
    if not m.any():
        return float("nan")
    return float(np.mean(np.abs(y_true[m] - y_pred[m])))


def skill_score(mae_model: float, mae_base: float) -> float:
    if not np.isfinite(mae_model) or not np.isfinite(mae_base) or mae_base == 0:
        return float("nan")
    return 1.0 - mae_model / mae_base


def block_bootstrap_skill(
    y_true: np.ndarray,
    y_model: np.ndarray,
    y_base: np.ndarray,
    week_ids: np.ndarray,
    n_boot: int = 500,
    seed: int = 42,
) -> dict[str, float]:
    """Block bootstrap across calendar weeks preserving resample multiplicity."""
    valid = np.isfinite(y_true) & np.isfinite(y_model) & np.isfinite(y_base)
    if valid.sum() < 5:
        return {"skill": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan")}

    yt = y_true[valid]
    ym = y_model[valid]
    yb = y_base[valid]
    wk = week_ids[valid]

    point_skill = skill_score(float(np.mean(np.abs(yt - ym))), float(np.mean(np.abs(yt - yb))))

    unique_weeks, inv = np.unique(wk, return_inverse=True)
    n_weeks = len(unique_weeks)
    if n_weeks < 2:
        return {"skill": float(point_skill), "ci_lo": float(point_skill), "ci_hi": float(point_skill)}

    err_m = np.abs(yt - ym)
    err_b = np.abs(yt - yb)
    sum_m = np.bincount(inv, weights=err_m, minlength=n_weeks)
    sum_b = np.bincount(inv, weights=err_b, minlength=n_weeks)
    counts = np.bincount(inv, minlength=n_weeks).astype(float)

    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n_weeks, size=(n_boot, n_weeks))
    boot_m = sum_m[idx].sum(axis=1) / counts[idx].sum(axis=1)
    boot_b = sum_b[idx].sum(axis=1) / counts[idx].sum(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        skills = 1.0 - (boot_m / boot_b)
    skills = skills[np.isfinite(skills)]
    if len(skills) == 0:
        return {"skill": float(point_skill), "ci_lo": float("nan"), "ci_hi": float("nan")}
    return {
        "skill": float(point_skill),
        "ci_lo": float(np.quantile(skills, 0.025)),
        "ci_hi": float(np.quantile(skills, 0.975)),
    }


def week_id(dates: pd.Series) -> np.ndarray:
    d = pd.to_datetime(dates)
    iso = d.dt.isocalendar()
    return (iso.year.astype(int) * 100 + iso.week.astype(int)).values


def evaluate_predictions(
    df: pd.DataFrame,
    pred_model: np.ndarray,
    pred_persistence: np.ndarray,
    pred_sjrrp: np.ndarray,
    pred_flow: np.ndarray,
    horizons: list[int],
) -> dict[str, Any]:
    """Compute per-horizon skill vs each baseline with block-bootstrap CIs."""
    out: dict[str, Any] = {"horizons": {}, "overall": {}}
    df = df.copy()
    df["pred_model"] = pred_model
    df["pred_persistence"] = pred_persistence
    df["pred_sjrrp"] = pred_sjrrp
    df["pred_flow"] = pred_flow
    df["week"] = week_id(df["date"])

    req_cols = ["y", "pred_model", "pred_persistence", "pred_sjrrp", "pred_flow"]
    df = df.dropna(subset=req_cols)

    for h in horizons:
        sub = df[df["horizon"] == h]
        y = sub["y"].values
        entry: dict[str, Any] = {"n": int(len(sub))}
        for name, col in [
            ("persistence", "pred_persistence"),
            ("sjrrp", "pred_sjrrp"),
            ("flow_aware", "pred_flow"),
        ]:
            entry[name] = {
                "mae_model": mae(y, sub["pred_model"].values),
                "mae_baseline": mae(y, sub[col].values),
                **block_bootstrap_skill(
                    y,
                    sub["pred_model"].values,
                    sub[col].values,
                    sub["week"].values,
                ),
            }
            entry[name]["beats"] = bool(
                np.isfinite(entry[name]["ci_lo"]) and entry[name]["ci_lo"] > 0
            )
        out["horizons"][str(h)] = entry

    for name in ("persistence", "sjrrp", "flow_aware"):
        beats_count = sum(1 for h in horizons if out["horizons"][str(h)][name]["beats"])
        skills = [out["horizons"][str(h)][name]["skill"] for h in horizons]
        skills = [s for s in skills if np.isfinite(s)]
        base_maes_h = [out["horizons"][str(h)][name]["mae_baseline"] for h in horizons]
        base_maes_h = [m for m in base_maes_h if np.isfinite(m)]
        out["overall"][name] = {
            "beats_count": int(beats_count),
            "beats": bool(beats_count >= 4),
            "mean_skill": float(np.mean(skills)) if skills else float("nan"),
            "mean_mae": float(np.mean(base_maes_h)) if base_maes_h else float("nan"),
        }

    base_maes = {
        name: out["overall"][name]["mean_mae"]
        for name in ("persistence", "sjrrp", "flow_aware")
    }
    best = min(base_maes, key=lambda k: base_maes[k] if np.isfinite(base_maes[k]) else float("inf"))
    model_maes_h = [
        out["horizons"][str(h)][best]["mae_model"]
        for h in horizons
        if np.isfinite(out["horizons"][str(h)][best]["mae_model"])
    ]
    out["best_baseline"] = best
    out["best_baseline_mae"] = float(base_maes[best])
    out["model_mae"] = float(np.mean(model_maes_h)) if model_maes_h else float("nan")
    # Per EVALUATION_RULES.md §8: mean skill vs best baseline across horizons 1-7
    out["skill_vs_best"] = float(out["overall"][best]["mean_skill"])
    return out


def evaluate_by_regime(
    df: pd.DataFrame,
    pred_model: np.ndarray,
    pred_best: np.ndarray,
    horizons: list[int],
) -> dict:
    df = df.copy()
    df["pred_model"] = pred_model
    df["pred_best"] = pred_best
    df["week"] = week_id(df["date"])
    result = {}
    for regime_name, mask in [("ramp", df["ramp"] == 1), ("steady", df["ramp"] == 0)]:
        sub = df[mask].dropna(subset=["y", "pred_model", "pred_best"])
        result[regime_name] = {
            "n_days": int(sub["date"].nunique()) if len(sub) else 0,
            "n_rows": int(len(sub)),
            "horizons": {},
        }
        for h in horizons:
            s = sub[sub["horizon"] == h]
            if len(s) < 5:
                result[regime_name]["horizons"][str(h)] = {
                    "beats": False,
                    "skill": float("nan"),
                    "ci_lo": float("nan"),
                    "ci_hi": float("nan"),
                    "n": int(len(s)),
                }
                continue
            boot = block_bootstrap_skill(
                s["y"].values,
                s["pred_model"].values,
                s["pred_best"].values,
                week_id(s["date"]),
            )
            boot["beats"] = bool(np.isfinite(boot["ci_lo"]) and boot["ci_lo"] > 0)
            boot["n"] = int(len(s))
            result[regime_name]["horizons"][str(h)] = boot
        beats = sum(
            1 for h in horizons if result[regime_name]["horizons"].get(str(h), {}).get("beats")
        )
        result[regime_name]["beats_count"] = int(beats)
        result[regime_name]["beats"] = bool(beats >= 4)
        skills = [
            result[regime_name]["horizons"][str(h)]["skill"]
            for h in horizons
            if np.isfinite(result[regime_name]["horizons"].get(str(h), {}).get("skill", np.nan))
        ]
        result[regime_name]["mean_skill"] = float(np.mean(skills)) if skills else float("nan")
    return result


def select_pitch_scenario(eval_deploy: dict, regime_eval: dict) -> dict[str, Any]:
    """Mechanical selector from EVALUATION_RULES.md §8."""
    best = eval_deploy["best_baseline"]
    overall = eval_deploy["overall"]
    beats_best = bool(overall[best]["beats"])
    beats_sjrrp = bool(overall["sjrrp"]["beats"])
    beats_pers = bool(overall["persistence"]["beats"])

    ramp_n = int(regime_eval.get("ramp", {}).get("n_days", 0))
    ramp_beats = bool(regime_eval.get("ramp", {}).get("beats", False))

    long_h = ["5", "6", "7"]
    long_beats = sum(
        1 for h in long_h if eval_deploy["horizons"].get(h, {}).get(best, {}).get("beats")
    )

    if beats_best:
        scenario = "A"
        key = "beats_best_baseline"
    elif ramp_n >= 20 and ramp_beats and not beats_best:
        scenario = "B"
        key = "mixed_by_regime"
    elif long_beats >= 2 and not beats_best:
        scenario = "B"
        key = "mixed_by_regime"
    elif beats_sjrrp and not beats_pers and not beats_best:
        scenario = "C"
        key = "beats_sjrrp_curve_only"
    else:
        scenario = "D"
        key = "beats_neither"

    return {
        "pitch_scenario": scenario,
        "pitch_key": key,
        "best_baseline": best,
        "skill_vs_best_baseline": float(eval_deploy["skill_vs_best"]),
        "skill_vs_sjrrp": float(overall["sjrrp"]["mean_skill"]),
        "skill_vs_flow_aware": float(overall["flow_aware"]["mean_skill"]),
        "ramp_n_days": ramp_n,
        "long_horizon_beats": int(long_beats),
        "overall_beats": {
            k: bool(overall[k]["beats"]) for k in ("persistence", "sjrrp", "flow_aware")
        },
    }
