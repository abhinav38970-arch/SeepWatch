"""Reach-balance labels using SJRRP formulas."""
from __future__ import annotations

import numpy as np
import pandas as pd


def compute_reach_loss(
    panel: pd.DataFrame,
    reach: dict,
    uncertainty_pct: float = 5.0,
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
    loss = downstream + extra - upstream.shift(lag)
    up_lag = upstream.shift(lag)

    # Combined uncertainty ~ sqrt(2) * pct for two gauges (conservative: 2*pct)
    unc = (up_lag.abs() + downstream.abs()) * (uncertainty_pct / 100.0)

    out = pd.DataFrame(
        {
            "reach_id": reach["id"],
            "upstream_flow": up_lag,
            "downstream_flow": downstream,
            "extra_inflow": extra,
            "loss_cfs": loss,
            "loss_frac": loss / up_lag.replace(0, np.nan),
            "uncertainty_cfs": unc,
            "flood": panel["flood"] if "flood" in panel.columns else False,
        },
        index=panel.index,
    )
    out.index.name = "date"
    return out


def compute_all_reaches(panel: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    frames = []
    for reach in cfg["reaches"]:
        frames.append(
            compute_reach_loss(
                panel,
                reach,
                uncertainty_pct=float(cfg["qc"]["gauge_uncertainty_pct"]),
            )
        )
    all_loss = pd.concat(frames, axis=0)
    all_loss = all_loss.reset_index().set_index(["date", "reach_id"]).sort_index()
    return all_loss
