"""Daily means, flood flags, gauge uncertainty."""
from __future__ import annotations

import numpy as np
import pandas as pd


def to_daily(
    series: pd.DataFrame,
    min_hourly_count: int = 20,
    duration: str | None = None,
) -> pd.Series:
    """Aggregate a CDEC series to daily mean flow.

    For hourly/event data, require min_hourly_count non-null hours.
    For already-daily data, take the daily value (or mean if duplicates).
    """
    if series.empty:
        return pd.Series(dtype=float, name="flow")

    dur = duration
    if dur is None and "duration" in series.columns and len(series):
        dur = str(series["duration"].iloc[0]).upper()

    s = series.dropna(subset=["ts", "value"]).set_index("ts")["value"].sort_index()
    if len(s) == 0:
        return pd.Series(dtype=float, name="flow")

    is_subdaily = dur in ("H", "E")
    if dur is None and len(s) >= 2:
        span_days = max((s.index.max() - s.index.min()).days, 1)
        is_subdaily = (len(s) / span_days) > 1.5

    if is_subdaily:
        counts = s.resample("D").count()
        daily = s.resample("D").mean()
        daily[counts < min_hourly_count] = np.nan
    else:
        daily = s.resample("D").mean()
    return daily.rename("flow")


def to_daily_art(series: pd.DataFrame) -> pd.Series:
    """Return daily boolean series indicating if any observation was Above Rating Table (ART)."""
    if series.empty or "art" not in series.columns:
        return pd.Series(dtype=bool, name="art")
    s = series.dropna(subset=["ts"]).set_index("ts")["art"].astype(bool).sort_index()
    if len(s) == 0:
        return pd.Series(dtype=bool, name="art")
    return s.resample("D").max().fillna(False).astype(bool)


def build_daily_panel(
    series_map: dict[str, pd.DataFrame],
    min_hourly_count: int = 20,
) -> pd.DataFrame:
    cols = {}
    art_cols = {}
    for key, df in series_map.items():
        cols[key] = to_daily(df, min_hourly_count=min_hourly_count)
        art_cols[key] = to_daily_art(df)
    panel = pd.DataFrame(cols).sort_index()
    art_panel = pd.DataFrame(art_cols).reindex(panel.index).fillna(False)
    panel["art_any"] = art_panel.any(axis=1)
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
    cbp = out[cbp_col].fillna(0.0) if cbp_col in out.columns else pd.Series(0.0, index=out.index)
    up_hi = pd.Series(False, index=out.index)
    for c in upstream_cols:
        if c in out.columns:
            up_hi = up_hi | (out[c].fillna(0.0) > upstream_threshold)
    art_any = out["art_any"].astype(bool) if "art_any" in out.columns else pd.Series(False, index=out.index)
    out["flood"] = (cbp > cbp_threshold) | up_hi | art_any
    return out


def gauge_uncertainty_cfs(flow: float, pct: float = 5.0) -> float:
    if flow is None or (isinstance(flow, float) and np.isnan(flow)):
        return np.nan
    return abs(flow) * (pct / 100.0)
