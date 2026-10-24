"""Baselines: persistence, per-reach SJRRP loss curve, per-reach flow-aware regression."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression


@dataclass
class BaselineBundle:
    sjrrp_month_frac: dict[tuple[str, int], float] = field(default_factory=dict)
    sjrrp_reach_frac: dict[str, float] = field(default_factory=dict)
    flow_models: dict[str, LinearRegression] = field(default_factory=dict)
    global_flow_model: LinearRegression | None = None
    train_mask_info: dict = field(default_factory=dict)


def _design_matrix(df: pd.DataFrame, up_col: str) -> np.ndarray:
    u = df[up_col].values.astype(float)
    return np.column_stack(
        [
            u,
            u ** 2,
            df["sin_doy"].values.astype(float),
            df["cos_doy"].values.astype(float),
        ]
    )


def fit_baselines(train: pd.DataFrame, mode: str = "deployable") -> BaselineBundle:
    """Fit per-reach baselines on training rows."""
    up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
    df = train.dropna(subset=["y", "upstream_now", up_col, "sin_doy", "cos_doy"]).copy()
    if "target_flood" in df.columns:
        df = df[~df["target_flood"].astype(bool)]
    df["month"] = pd.to_datetime(df["date"]).dt.month

    # Deduplicate across horizons when estimating contemporaneous loss fractions
    dedup = df.sort_values("horizon").drop_duplicates(subset=["reach_id", "date"]).copy()
    denom_col = "upstream_lag_now" if "upstream_lag_now" in dedup.columns else "upstream_now"
    dedup["frac"] = dedup["y_now"] / dedup[denom_col].replace(0, np.nan)

    month_frac: dict[tuple[str, int], float] = {}
    reach_frac: dict[str, float] = {}
    for rid, g in dedup.groupby("reach_id"):
        valid_frac = g["frac"].dropna()
        r_med = float(valid_frac.median()) if len(valid_frac) else -0.3
        reach_frac[str(rid)] = r_med
        by_m = g.dropna(subset=["frac"]).groupby("month")["frac"].median().to_dict()
        for m in range(1, 13):
            month_frac[(str(rid), m)] = float(by_m.get(m, r_med))

    flow_models: dict[str, LinearRegression] = {}
    for rid, g in df.groupby("reach_id"):
        X_r = _design_matrix(g, up_col)
        y_r = g["y"].values.astype(float)
        m_r = LinearRegression()
        m_r.fit(X_r, y_r)
        flow_models[str(rid)] = m_r

    global_model = LinearRegression()
    if len(df):
        global_model.fit(_design_matrix(df, up_col), df["y"].values.astype(float))

    return BaselineBundle(
        sjrrp_month_frac=month_frac,
        sjrrp_reach_frac=reach_frac,
        flow_models=flow_models,
        global_flow_model=global_model,
        train_mask_info={"n": int(len(df)), "mode": mode},
    )


def predict_persistence(df: pd.DataFrame) -> np.ndarray:
    return df["y_now"].values.astype(float)


def predict_sjrrp(df: pd.DataFrame, bundle: BaselineBundle, mode: str = "deployable") -> np.ndarray:
    up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
    months = pd.to_datetime(df["date"]).dt.month.values
    rids = df["reach_id"].astype(str).values
    fracs = np.array(
        [
            bundle.sjrrp_month_frac.get(
                (r, int(m)),
                bundle.sjrrp_reach_frac.get(r, -0.3),
            )
            for r, m in zip(rids, months)
        ],
        dtype=float,
    )
    return (df[up_col].values.astype(float) * fracs).astype(float)


def predict_flow_aware(df: pd.DataFrame, bundle: BaselineBundle, mode: str = "deployable") -> np.ndarray:
    up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
    out = np.full(len(df), np.nan, dtype=float)
    rids = df["reach_id"].astype(str).values
    for rid in np.unique(rids):
        mask = rids == rid
        sub = df.iloc[np.where(mask)[0]]
        valid = sub[up_col].notna() & sub["sin_doy"].notna() & sub["cos_doy"].notna()
        if not valid.any():
            continue
        model = bundle.flow_models.get(str(rid), bundle.global_flow_model)
        if model is None:
            continue
        X = _design_matrix(sub.loc[valid], up_col)
        idx = np.where(mask)[0][valid.values]
        out[idx] = model.predict(X)
    return out
