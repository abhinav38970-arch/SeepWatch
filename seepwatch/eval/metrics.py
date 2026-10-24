"""Pre-registered evaluation: skill, bootstrap CIs, pitch scenario selection."""
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
    rng = np.random.default_rng(seed)
    weeks = np.unique(week_ids)
    skills = []
    for _ in range(n_boot):
        sample_weeks = rng.choice(weeks, size=len(weeks), replace=True)
        mask = np.isin(week_ids, sample_weeks)
        if mask.sum() < 5:
            continue
        skills.append(
            skill_score(mae(y_true[mask], y_model[mask]), mae(y_true[mask], y_base[mask]))
        )
    skills = np.array([s for s in skills if np.isfinite(s)])
    if len(skills) == 0:
        return {"skill": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan")}
    return {
        "skill": float(np.mean(skills)),
        "ci_lo": float(np.quantile(skills, 0.025)),
        "ci_hi": float(np.quantile(skills, 0.975)),
    }


def week_id(dates: pd.Series) -> np.ndarray:
    d = pd.to_datetime(dates)
    # Monday-bounded ISO week key
    return (d.dt.isocalendar().year.astype(int) * 100 + d.dt.isocalendar().week.astype(int)).values


def evaluate_predictions(
    df: pd.DataFrame,
    pred_model: np.ndarray,
    pred_persistence: np.ndarray,
    pred_sjrrp: np.ndarray,
    pred_flow: np.ndarray,
    horizons: list[int],
) -> dict[str, Any]:
    """Compute per-horizon skill vs each baseline with bootstrap CIs."""
    out: dict[str, Any] = {"horizons": {}, "overall": {}}
    df = df.copy()
    df["pred_model"] = pred_model
    df["pred_persistence"] = pred_persistence
    df["pred_sjrrp"] = pred_sjrrp
    df["pred_flow"] = pred_flow
    df["week"] = week_id(df["date"])

    for h in horizons:
        sub = df[df["horizon"] == h].dropna(subset=["y", "pred_model"])
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
                **block_bootstrap_skill(y, sub["pred_model"].values, sub[col].values, sub["week"].values),
            }
            entry[name]["beats"] = bool(
                np.isfinite(entry[name]["ci_lo"]) and entry[name]["ci_lo"] > 0
            )
        out["horizons"][str(h)] = entry

    # Overall beats: 4+/7 horizons
    for name in ("persistence", "sjrrp", "flow_aware"):
        beats_count = sum(1 for h in horizons if out["horizons"][str(h)][name]["beats"])
        skills = [out["horizons"][str(h)][name]["skill"] for h in horizons]
        skills = [s for s in skills if np.isfinite(s)]
        out["overall"][name] = {
            "beats_count": beats_count,
            "beats": beats_count >= 4,
            "mean_skill": float(np.mean(skills)) if skills else float("nan"),
        }

    # Best baseline by lowest mean MAE across horizons
    base_maes = {}
    for name, col in [
        ("persistence", "pred_persistence"),
        ("sjrrp", "pred_sjrrp"),
        ("flow_aware", "pred_flow"),
    ]:
        base_maes[name] = mae(df["y"].values, df[col].values)
    best = min(base_maes, key=base_maes.get)
    out["best_baseline"] = best
    out["best_baseline_mae"] = base_maes[best]
    out["model_mae"] = mae(df["y"].values, df["pred_model"].values)
    out["skill_vs_best"] = skill_score(out["model_mae"], out["best_baseline_mae"])
    return out


def evaluate_by_regime(df: pd.DataFrame, pred_model: np.ndarray, pred_best: np.ndarray, horizons: list[int]) -> dict:
    df = df.copy()
    df["pred_model"] = pred_model
    df["pred_best"] = pred_best
    df["week"] = week_id(df["date"])
    result = {}
    for regime_name, mask in [("ramp", df["ramp"] == 1), ("steady", df["ramp"] == 0)]:
        sub = df[mask].dropna(subset=["y", "pred_model"])
        result[regime_name] = {
            "n_days": int(sub["date"].nunique()) if len(sub) else 0,
            "n_rows": int(len(sub)),
            "horizons": {},
        }
        for h in horizons:
            s = sub[sub["horizon"] == h]
            if len(s) < 5:
                result[regime_name]["horizons"][str(h)] = {"beats": False, "skill": float("nan"), "n": len(s)}
                continue
            boot = block_bootstrap_skill(
                s["y"].values, s["pred_model"].values, s["pred_best"].values, week_id(s["date"])
            )
            boot["beats"] = bool(np.isfinite(boot["ci_lo"]) and boot["ci_lo"] > 0)
            boot["n"] = len(s)
            result[regime_name]["horizons"][str(h)] = boot
        beats = sum(1 for h in horizons if result[regime_name]["horizons"].get(str(h), {}).get("beats"))
        result[regime_name]["beats_count"] = beats
        result[regime_name]["beats"] = beats >= 4
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
    beats_best = overall[best]["beats"]
    beats_sjrrp = overall["sjrrp"]["beats"]
    beats_pers = overall["persistence"]["beats"]
    beats_flow = overall["flow_aware"]["beats"]

    ramp_n = regime_eval.get("ramp", {}).get("n_days", 0)
    ramp_beats = regime_eval.get("ramp", {}).get("beats", False)

    # Long-horizon special case for B
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
    elif beats_sjrrp and not beats_pers and not beats_flow:
        scenario = "C"
        key = "beats_sjrrp_curve_only"
    else:
        scenario = "D"
        key = "beats_neither"

    return {
        "pitch_scenario": scenario,
        "pitch_key": key,
        "best_baseline": best,
        "skill_vs_best_baseline": eval_deploy["skill_vs_best"],
        "ramp_n_days": ramp_n,
        "long_horizon_beats": long_beats,
        "overall_beats": {k: overall[k]["beats"] for k in ("persistence", "sjrrp", "flow_aware")},
    }
