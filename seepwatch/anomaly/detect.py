"""Excess-loss anomaly flags against learned normal band."""
from __future__ import annotations

import numpy as np
import pandas as pd


def excess_loss(observed_or_forecast: np.ndarray, expected_q50: np.ndarray) -> np.ndarray:
    """Loss magnitude above expected normal loss magnitude (clamping net gains to 0 loss)."""
    obs_loss_mag = np.maximum(0.0, -np.asarray(observed_or_forecast, dtype=float))
    exp_loss_mag = np.maximum(0.0, -np.asarray(expected_q50, dtype=float))
    return obs_loss_mag - exp_loss_mag


def flag_anomalies(
    timeline: pd.DataFrame,
    persist_days: int = 2,
) -> pd.DataFrame:
    """timeline columns: date, reach_id, loss_cfs, q50, q10, q90, flood.

    Here (q10, q50, q90) is the expected normal reach-balance band for that flow/season.
    Flags when observed loss_cfs is below q10 (more water lost than 90% of normal days),
    represents an actual net water loss (loss_cfs < -10 cfs), and persists for
    `persist_days` consecutive calendar days.
    """
    rows = []
    for rid, g in timeline.groupby("reach_id"):
        g = g.sort_values("date").copy()
        dts = pd.to_datetime(g["date"])
        obs_loss_mag = np.maximum(0.0, -g["loss_cfs"].astype(float))
        exp_loss_mag = np.maximum(0.0, -g["q50"].astype(float))
        residual = obs_loss_mag - exp_loss_mag
        band = (g["q50"] - g["q10"]).clip(lower=5.0)

        raw_flag = (
            (g["loss_cfs"] < g["q10"])
            & (residual > 5.0)
            & (g["loss_cfs"] < -10.0)
            & (~g["flood"].astype(bool))
            & g["loss_cfs"].notna()
        )
        # Consecutive calendar-day persistence
        day_gap = dts.diff() != pd.Timedelta(days=1)
        break_group = ((~raw_flag) | day_gap).cumsum()
        run = raw_flag.astype(int).groupby(break_group).cumsum()
        flag = run >= persist_days
        g["excess_loss_cfs"] = residual
        g["anomaly_raw"] = raw_flag.astype(bool)
        g["anomaly"] = flag.astype(bool)
        rows.append(g)
    return pd.concat(rows, ignore_index=True)


def false_alarm_rate(flags: pd.DataFrame) -> dict:
    """Anomaly flags per 30 non-flood days per reach."""
    out = {}
    f = flags[(~flags["flood"].astype(bool)) & flags["loss_cfs"].notna()].copy()
    f["ym"] = pd.to_datetime(f["date"]).dt.to_period("M").astype(str)
    for rid, g in f.groupby("reach_id"):
        total_days = max(int(len(g)), 1)
        total_flags = int(g["anomaly"].astype(bool).sum())
        total_raw = int(g["anomaly_raw"].astype(bool).sum())
        months = int(g["ym"].nunique())
        out[str(rid)] = {
            "mean_flags_per_month": float(30.0 * total_flags / total_days),
            "mean_raw_per_month": float(30.0 * total_raw / total_days),
            "total_flags": total_flags,
            "total_days": total_days,
            "months": months,
        }
    return out


VERIFIED_EVENTS = [
    {
        "date": "2010-04-15",
        "reach_id": "R1",
        "kind": "seepage_response",
        "expect_flag": True,
        "note": "USBR seepage impacts; releases reduced (approx mid-April 2010)",
        "verified": False,
    },
]


def check_events(flags: pd.DataFrame, events: list[dict] | None = None) -> list[dict]:
    events = events or VERIFIED_EVENTS
    results = []
    for ev in events:
        if not ev.get("verified"):
            results.append({**ev, "status": "unverified_skipped"})
            continue
        d = pd.Timestamp(ev["date"])
        window = flags[
            (flags["reach_id"] == ev["reach_id"])
            & (pd.to_datetime(flags["date"]) >= d - pd.Timedelta(days=7))
            & (pd.to_datetime(flags["date"]) <= d + pd.Timedelta(days=7))
        ]
        hit = bool(window["anomaly"].any()) if len(window) else False
        results.append({**ev, "status": "hit" if hit == ev["expect_flag"] else "miss", "hit": hit})
    return results
