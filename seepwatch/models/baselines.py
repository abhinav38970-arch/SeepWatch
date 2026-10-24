"""Baselines: persistence, SJRRP loss curve, flow-aware regression."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression


FEATURE_FLOW = ["upstream_future", "upstream_sq", "sin_doy", "cos_doy"]


@dataclass
class BaselineBundle:
    sjrrp_month_frac: dict[int, float]
    flow_model: LinearRegression | None
    train_mask_info: dict


def fit_baselines(train: pd.DataFrame, mode: str = "deployable") -> BaselineBundle:
    """Fit baselines on training rows. `train` must have y, upstream_now, sin/cos_doy, and mode upstream."""
    up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
    df = train.dropna(subset=["y", "upstream_now", up_col]).copy()
    df["month"] = pd.to_datetime(df["date"]).dt.month
    # SJRRP curve: median loss_frac by month using contemporaneous upstream at label time ≈ upstream_now
    # Use y / upstream_now as fraction (signed)
    frac = df["y"] / df["upstream_now"].replace(0, np.nan)
    month_frac = frac.groupby(df["month"]).median().to_dict()
    for m in range(1, 13):
        month_frac.setdefault(m, float(frac.median()) if len(frac) else -0.3)

    # Flow-aware regression on the mode's future upstream
    X = np.column_stack(
        [
            df[up_col].values,
            (df[up_col].values ** 2),
            df["sin_doy"].values,
            df["cos_doy"].values,
        ]
    )
    y = df["y"].values
    model = LinearRegression()
    model.fit(X, y)

    return BaselineBundle(
        sjrrp_month_frac=month_frac,
        flow_model=model,
        train_mask_info={"n": len(df), "mode": mode},
    )


def predict_persistence(df: pd.DataFrame) -> np.ndarray:
    return df["y_now"].values.astype(float)


def predict_sjrrp(df: pd.DataFrame, bundle: BaselineBundle, mode: str = "deployable") -> np.ndarray:
    up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
    months = pd.to_datetime(df["date"]).dt.month
    fracs = months.map(lambda m: bundle.sjrrp_month_frac.get(int(m), -0.3)).astype(float)
    return (df[up_col].values * fracs.values).astype(float)


def predict_flow_aware(df: pd.DataFrame, bundle: BaselineBundle, mode: str = "deployable") -> np.ndarray:
    up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
    X = np.column_stack(
        [
            df[up_col].values,
            (df[up_col].values ** 2),
            df["sin_doy"].values,
            df["cos_doy"].values,
        ]
    )
    return bundle.flow_model.predict(X)
