"""Leak-safe feature construction as-of forecast date."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _doy_cycle(idx: pd.DatetimeIndex) -> tuple[pd.Series, pd.Series]:
    doy = idx.dayofyear.astype(float)
    return (
        pd.Series(np.sin(2 * np.pi * doy / 365.25), index=idx),
        pd.Series(np.cos(2 * np.pi * doy / 365.25), index=idx),
    )


def wetness_proxy(mil_inflow: pd.Series) -> pd.Series:
    """Cumulative reservoir inflow since March 1 within each restoration year."""
    s = mil_inflow.clip(lower=0.0).fillna(0.0)
    ry = s.index.to_series().apply(lambda d: d.year if d.month >= 3 else d.year - 1)
    cum = s.groupby(ry).cumsum()
    return cum.rename("wetness")


def build_feature_frame(
    panel: pd.DataFrame,
    labels: pd.DataFrame,
    reach: dict,
    horizons: list[int],
) -> pd.DataFrame:
    """One row per (date, horizon) for a reach. Features use only data as-of date."""
    rid = reach["id"]
    up_col = reach["upstream"]
    lag = int(reach["lag_days"])
    reach_lab = labels.xs(rid, level="reach_id")
    loss = reach_lab["loss_cfs"]
    reach_flood = reach_lab["flood"].astype(bool)
    up = panel[up_col]
    up_lag_now = up.shift(lag)

    sin_doy, cos_doy = _doy_cycle(panel.index)
    wet = (
        wetness_proxy(panel["MIL_INFLOW"])
        if "MIL_INFLOW" in panel.columns
        else pd.Series(0.0, index=panel.index)
    )

    # Antecedent volumes scaled by window length so partial NaNs don't mimic dry spells
    vol7 = up.rolling(7, min_periods=3).mean() * 7.0
    vol30 = up.rolling(30, min_periods=10).mean() * 30.0
    vol90 = up.rolling(90, min_periods=30).mean() * 90.0

    up_lag7 = up.shift(7)
    ramp = (((up / up_lag7) - 1.0).abs() > 0.5) & ((up >= 50) | (up_lag7 >= 50))
    ramp = ramp.fillna(False)

    loss_lag1 = loss.shift(1)
    loss_mean7 = loss.rolling(7, min_periods=3).mean()
    loss_std7 = loss.rolling(7, min_periods=3).std().fillna(0.0)
    trend7 = up - up_lag7

    rows = []
    for h in horizons:
        # Label at t+h uses upstream inflow at t+h-lag.
        # In deployable mode, if h <= lag, t+h-lag <= t is already observed as-of t!
        up_future_deploy = up.shift(lag - h) if h <= lag else up
        up_future_whatif = up.shift(-(h - lag))

        # Exclude target dates that fall on flood operations
        target_flood = (
            reach_flood.rolling(h + 1, min_periods=1)
            .max()
            .shift(-h)
            .fillna(reach_flood)
            .astype(bool)
        )

        base = pd.DataFrame(
            {
                "date": panel.index,
                "target_date": panel.index + pd.Timedelta(days=h),
                "reach_id": rid,
                "horizon": h,
                "y": loss.shift(-h),
                "y_now": loss,
                "upstream_now": up,
                "upstream_lag_now": up_lag_now,
                "upstream_future_deploy": up_future_deploy,
                "upstream_future_whatif": up_future_whatif,
                "trend7": trend7,
                "ramp": ramp.astype(int),
                "vol7": vol7,
                "vol30": vol30,
                "vol90": vol90,
                "wetness": wet,
                "sin_doy": sin_doy,
                "cos_doy": cos_doy,
                "loss_lag1": loss_lag1,
                "loss_mean7": loss_mean7,
                "loss_std7": loss_std7,
                "flood": reach_flood.astype(bool),
                "target_flood": target_flood,
                "length_miles": float(reach.get("length_miles") or 0),
            }
        )
        rows.append(base)

    feat = pd.concat(rows, ignore_index=True)
    return feat
