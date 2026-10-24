"""Daily means, flood flags, gauge uncertainty."""
from __future__ import annotations

import numpy as np
import pandas as pd


def to_daily(series: pd.DataFrame, min_hourly_count: int = 20) -> pd.Series:
    """Aggregate a CDEC series to daily mean flow.

    For hourly/event data, require min_hourly_count non-null hours.
    For already-daily data, take the daily value (or mean if duplicates).
    """
    if series.empty:
        return pd.Series(dtype=float, name="flow")

    s = series.dropna(subset=["ts", "value"]).set_index("ts")["value"].sort_index()
    # Detect if mostly hourly: more than 1.5 obs per day on average
    if len(s) < 2:
        return s.resample("D").mean().rename("flow")

    span_days = max((s.index.max() - s.index.min()).days, 1)
    density = len(s) / span_days
    if density > 1.5:
        counts = s.resample("D").count()
        daily = s.resample("D").mean()
        daily[counts < min_hourly_count] = np.nan
    else:
        daily = s.resample("D").mean()
    return daily.rename("flow")


def build_daily_panel(
    series_map: dict[str, pd.DataFrame],
    min_hourly_count: int = 20,
) -> pd.DataFrame:
    cols = {}
    for key, df in series_map.items():
        cols[key] = to_daily(df, min_hourly_count=min_hourly_count)
    panel = pd.DataFrame(cols).sort_index()
    panel.index.name = "date"
    return panel


def add_flood_flag(
    panel: pd.DataFrame,
    cbp_col: str = "CBP",
    upstream_cols: tuple[str, ...] = ("GRF", "SJB", "MIL"),
    cbp_threshold: float = 5.0,
    upstream_threshold: float = 1600.0,
) -> pd.DataFrame:
    out = panel.copy()
    cbp = out[cbp_col].fillna(0.0) if cbp_col in out.columns else 0.0
    up_hi = False
    for c in upstream_cols:
        if c in out.columns:
            up_hi = up_hi | (out[c].fillna(0.0) > upstream_threshold)
    out["flood"] = (cbp > cbp_threshold) | up_hi
    return out


def gauge_uncertainty_cfs(flow: float, pct: float = 5.0) -> float:
    if flow is None or (isinstance(flow, float) and np.isnan(flow)):
        return np.nan
    return abs(flow) * (pct / 100.0)
