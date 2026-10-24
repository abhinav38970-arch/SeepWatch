"""Global LightGBM quantile model."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

FEATURE_COLS = [
    "horizon",
    "upstream_now",
    "upstream_future",
    "trend7",
    "ramp",
    "vol7",
    "vol30",
    "vol90",
    "wetness",
    "sin_doy",
    "cos_doy",
    "loss_lag1",
    "loss_mean7",
    "loss_std7",
    "length_miles",
    "reach_code",
]


@dataclass
class QuantileModel:
    models: dict[float, lgb.LGBMRegressor] = field(default_factory=dict)
    reach_codes: dict[str, int] = field(default_factory=dict)
    feature_cols: list[str] = field(default_factory=lambda: list(FEATURE_COLS))
    coverage_raw: float | None = None
    coverage_corrected: float | None = None
    scale: float = 1.0

    def prepare(self, df: pd.DataFrame, mode: str) -> pd.DataFrame:
        out = df.copy()
        up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
        out["upstream_future"] = out[up_col]
        if not self.reach_codes:
            reaches = sorted(out["reach_id"].unique())
            self.reach_codes = {r: i for i, r in enumerate(reaches)}
        out["reach_code"] = out["reach_id"].map(self.reach_codes).fillna(-1).astype(int)
        return out

    def fit(self, train: pd.DataFrame, mode: str = "deployable") -> "QuantileModel":
        """Fit quantile models on residual from persistence: y - y_now."""
        df = self.prepare(train, mode)
        need = ["y", "y_now"] + [c for c in self.feature_cols if c != "reach_code"]
        df = df.dropna(subset=need)
        X = df[self.feature_cols]
        # Residual learning keeps the model from losing badly to persistence
        resid = df["y"].values - df["y_now"].values
        for alpha in (0.1, 0.5, 0.9):
            m = lgb.LGBMRegressor(
                objective="quantile",
                alpha=alpha,
                n_estimators=250,
                learning_rate=0.05,
                num_leaves=23,
                min_child_samples=40,
                subsample=0.8,
                colsample_bytree=0.8,
                reg_lambda=1.0,
                random_state=42,
                verbosity=-1,
            )
            m.fit(X, resid)
            self.models[alpha] = m
        return self

    def predict(self, df: pd.DataFrame, mode: str = "deployable") -> pd.DataFrame:
        prepared = self.prepare(df, mode)
        X = prepared[self.feature_cols]
        y0 = prepared["y_now"].values.astype(float)
        q10 = y0 + self.models[0.1].predict(X)
        q50 = y0 + self.models[0.5].predict(X)
        q90 = y0 + self.models[0.9].predict(X)
        # Ensure order
        q10e = np.minimum(q10, q50)
        q90e = np.maximum(q90, q50)
        if self.scale != 1.0:
            q10c = q50 - self.scale * (q50 - q10e)
            q90c = q50 + self.scale * (q90e - q50)
        else:
            q10c, q90c = q10e, q90e
        return pd.DataFrame(
            {
                "q10": q10c,
                "q50": q50,
                "q90": q90c,
                "q10_raw": q10e,
                "q90_raw": q90e,
            },
            index=df.index,
        )

    def calibrate_coverage(self, df: pd.DataFrame, mode: str = "deployable") -> dict[str, Any]:
        """Empirical 80% coverage; scale correction if outside [0.70, 0.90]."""
        preds = self.predict(df, mode)
        y = df["y"].values
        inside = (y >= preds["q10_raw"].values) & (y <= preds["q90_raw"].values)
        valid = np.isfinite(y) & np.isfinite(preds["q10_raw"].values)
        cov = float(inside[valid].mean()) if valid.any() else float("nan")
        self.coverage_raw = cov
        self.scale = 1.0
        self.coverage_corrected = cov
        if np.isfinite(cov) and (cov < 0.70 or cov > 0.90):
            # Expand/shrink half-widths
            # Binary search scale so coverage ≈ 0.80
            lo, hi = 0.5, 3.0
            best = 1.0
            for _ in range(20):
                mid = (lo + hi) / 2
                q10 = preds["q50"].values - mid * (preds["q50"].values - preds["q10_raw"].values)
                q90 = preds["q50"].values + mid * (preds["q90_raw"].values - preds["q50"].values)
                c = float(((y >= q10) & (y <= q90))[valid].mean())
                best = mid
                if c < 0.80:
                    lo = mid
                else:
                    hi = mid
            self.scale = best
            q10 = preds["q50"].values - self.scale * (preds["q50"].values - preds["q10_raw"].values)
            q90 = preds["q50"].values + self.scale * (preds["q90_raw"].values - preds["q50"].values)
            self.coverage_corrected = float(((y >= q10) & (y <= q90))[valid].mean())
        return {
            "coverage_raw": self.coverage_raw,
            "coverage_corrected": self.coverage_corrected,
            "scale": self.scale,
        }

    def feature_importance(self) -> dict[str, float]:
        if 0.5 not in self.models:
            return {}
        imp = self.models[0.5].feature_importances_
        return {c: float(v) for c, v in zip(self.feature_cols, imp)}
