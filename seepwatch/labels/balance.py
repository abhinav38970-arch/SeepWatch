"""Reach-balance labels using SJRRP formulas."""
from __future__ import annotations

import numpy as np
import pandas as pd


def compute_reach_loss(
    panel: pd.DataFrame,
    reach: dict,
    uncertainty_pct: float = 5.0,
    upstream_threshold: float = 1600.0,
) -> pd.DataFrame:
    """Return a DataFrame indexed by date with loss columns for one reach."""
    up = reach["upstream"]
    down = reach["downstream"]
    lag = int(reach["lag_days"])
    extras = reach.get("extra_downstream") or []

    if up not in panel.columns or down not in panel.columns:
        raise KeyError(f"Missing gauges for reach {reach['id']}: {up}, {down}")

    upstream = panel[up]
    downstream = panel[down]
    extra = sum(panel[e].fillna(0.0) for e in extras if e in panel.columns)
    if not isinstance(extra, pd.Series):
        extra = pd.Series(0.0, index=panel.index)

    # loss = downstream + extras - upstream(t-lag)
    # Negative => net loss
    up_lag = upstream.shift(lag)
    loss = downstream + extra - up_lag

    # Combined gauge uncertainty in quadrature across independent gauges
    unc = np.sqrt(
        up_lag.fillna(0.0) ** 2 + downstream.fillna(0.0) ** 2 + extra.fillna(0.0) ** 2
    ) * (uncertainty_pct / 100.0)
    unc = unc.where(up_lag.notna() & downstream.notna(), np.nan)

    base_flood = (
        panel["flood"].astype(bool)
        if "flood" in panel.columns
        else pd.Series(False, index=panel.index)
    )
    # Mark flood if any day in the transit window [t-lag, t] had flood operations
    transit_flood = (
        base_flood.rolling(lag + 1, min_periods=1).max().fillna(0).astype(bool)
        | (up_lag.fillna(0.0) > upstream_threshold)
    )

    out = pd.DataFrame(
        {
            "reach_id": reach["id"],
            "upstream_flow": up_lag,
            "downstream_flow": downstream,
            "extra_inflow": extra,
            "loss_cfs": loss,
            "loss_frac": loss / up_lag.replace(0, np.nan),
            "uncertainty_cfs": unc,
            "flood": transit_flood,
        },
        index=panel.index,
    )
    out.index.name = "date"
    return out


def compute_all_reaches(panel: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    frames = []
    up_thresh = float(cfg.get("flood", {}).get("upstream_threshold_cfs", 1600.0))
    for reach in cfg["reaches"]:
        frames.append(
            compute_reach_loss(
                panel,
                reach,
                uncertainty_pct=float(cfg["qc"]["gauge_uncertainty_pct"]),
                upstream_threshold=up_thresh,
            )
        )
    all_loss = pd.concat(frames, axis=0)
    all_loss = all_loss.reset_index().set_index(["date", "reach_id"]).sort_index()
    return all_loss
