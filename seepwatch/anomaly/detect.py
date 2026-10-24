"""Excess-loss anomaly flags."""
from __future__ import annotations

import numpy as np
import pandas as pd


def excess_loss(observed_or_forecast: np.ndarray, expected_q50: np.ndarray) -> np.ndarray:
    """More negative than expected => positive excess loss magnitude."""
    # loss_cfs is negative when water disappears. Excess = expected - actual (positive when worse).
    return expected_q50 - observed_or_forecast


def flag_anomalies(
    timeline: pd.DataFrame,
    persist_days: int = 2,
) -> pd.DataFrame:
    """timeline columns: date, reach_id, loss_cfs, q50, q10, q90, flood.

    Flags when excess loss exceeds the upper residual band for N consecutive days.
    Band: q90 is the upper quantile of loss_cfs (less negative / gains). For excess,
    we use residual = q50 - loss; flag when residual > (q50 - q10)  [lower-tail width].
    """
    rows = []
    for rid, g in timeline.groupby("reach_id"):
        g = g.sort_values("date").copy()
        residual = g["q50"] - g["loss_cfs"]
        band = (g["q50"] - g["q10"]).clip(lower=0)
        # Also require residual above a small floor (5 cfs) to avoid noise flags
        raw_flag = (residual > band) & (residual > 5) & (~g["flood"].astype(bool))
        # Persistence rule
        run = raw_flag.astype(int).groupby((~raw_flag).cumsum()).cumsum()
        flag = run >= persist_days
        g["excess_loss_cfs"] = residual
        g["anomaly_raw"] = raw_flag
        g["anomaly"] = flag
        rows.append(g)
    return pd.concat(rows, ignore_index=True)


def false_alarm_rate(flags: pd.DataFrame) -> dict:
    """False alarms per reach per month on non-flood days (proxy: raw flags that don't persist)."""
    out = {}
    f = flags[~flags["flood"].astype(bool)].copy()
    f["ym"] = pd.to_datetime(f["date"]).dt.to_period("M").astype(str)
    for rid, g in f.groupby("reach_id"):
        months = g.groupby("ym").agg(
            days=("date", "count"),
            flags=("anomaly", "sum"),
            raw=("anomaly_raw", "sum"),
        )
        out[rid] = {
            "mean_flags_per_month": float(months["flags"].mean()) if len(months) else 0.0,
            "mean_raw_per_month": float(months["raw"].mean()) if len(months) else 0.0,
            "months": int(len(months)),
        }
    return out


# Candidate events for validation (must be confirmed; used as labels only when verified)
VERIFIED_EVENTS = [
    {
        "date": "2010-04-15",
        "reach_id": "R1",
        "kind": "seepage_response",
        "expect_flag": True,
        "note": "USBR seepage impacts; releases reduced (approx mid-April 2010)",
        "verified": False,  # year/range approximate — not used as hard ground truth yet
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
