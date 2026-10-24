"""Global LightGBM quantile forecast model and normal-band model."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

FEATURE_COLS = [
    "horizon",
    "y_now",
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

NORMAL_FEATURE_COLS = [
    "upstream_ref",
    "trend7",
    "ramp",
    "vol7",
    "vol30",
    "vol90",
    "wetness",
    "sin_doy",
    "cos_doy",
    "length_miles",
    "reach_code",
]


def _order_quantiles_with_floor(
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
    min_half_width: float = 1.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    stacked = np.sort(np.column_stack([q10, q50, q90]), axis=1)
    lo = np.minimum(stacked[:, 0], stacked[:, 1] - min_half_width)
    mid = stacked[:, 1]
    hi = np.maximum(stacked[:, 2], stacked[:, 1] + min_half_width)
    return lo, mid, hi


@dataclass
class QuantileModel:
    models: dict[float, lgb.LGBMRegressor] = field(default_factory=dict)
    reach_codes: dict[str, int] = field(default_factory=dict)
    feature_cols: list[str] = field(default_factory=lambda: list(FEATURE_COLS))
    coverage_raw: float | None = None
    coverage_corrected: float | None = None
    calib_coverage_raw: float | None = None
    calib_coverage_corrected: float | None = None
    scale: float = 1.0

    def prepare(self, df: pd.DataFrame, mode: str) -> pd.DataFrame:
        out = df.copy()
        up_col = "upstream_future_deploy" if mode == "deployable" else "upstream_future_whatif"
        out["upstream_future"] = out[up_col]
        if not self.reach_codes:
            reaches = sorted(out["reach_id"].astype(str).unique())
            self.reach_codes = {r: i for i, r in enumerate(reaches)}
        out["reach_code"] = out["reach_id"].astype(str).map(self.reach_codes).fillna(-1).astype(int)
        return out

    def fit(self, train: pd.DataFrame, mode: str = "deployable") -> "QuantileModel":
        """Fit quantile models on residual from persistence: y - y_now."""
        df = self.prepare(train, mode)
        if "target_flood" in df.columns:
            df = df[~df["target_flood"].astype(bool)]
        need = ["y", "y_now"] + [c for c in self.feature_cols if c != "reach_code"]
        df = df.dropna(subset=need)
        X = df[self.feature_cols]
        resid = df["y"].values.astype(float) - df["y_now"].values.astype(float)
        for alpha in (0.1, 0.5, 0.9):
            m = lgb.LGBMRegressor(
                objective="quantile",
                alpha=alpha,
                n_estimators=220,
                learning_rate=0.04,
                num_leaves=19,
                min_child_samples=50,
                subsample=0.8,
                colsample_bytree=0.8,
                reg_lambda=2.0,
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
        q10e, q50e, q90e = _order_quantiles_with_floor(q10, q50, q90, min_half_width=1.0)
        if self.scale != 1.0:
            q10c = q50e - self.scale * (q50e - q10e)
            q90c = q50e + self.scale * (q90e - q50e)
        else:
            q10c, q90c = q10e, q90e
        return pd.DataFrame(
            {
                "q10": q10c,
                "q50": q50e,
                "q90": q90c,
                "q10_raw": q10e,
                "q90_raw": q90e,
            },
            index=df.index,
        )

    def calibrate_coverage(
        self,
        calib_df: pd.DataFrame,
        test_df: pd.DataFrame | None = None,
        mode: str = "deployable",
    ) -> dict[str, Any]:
        """Calibrate interval scale on out-of-sample calib_df; evaluate coverage on held-out test_df."""
        self.scale = 1.0
        preds_cal = self.predict(calib_df, mode)
        y_cal = calib_df["y"].values.astype(float)
        valid_cal = np.isfinite(y_cal) & np.isfinite(preds_cal["q10_raw"].values)
        inside_cal = (y_cal >= preds_cal["q10_raw"].values) & (y_cal <= preds_cal["q90_raw"].values)
        cal_raw = float(inside_cal[valid_cal].mean()) if valid_cal.any() else float("nan")
        self.calib_coverage_raw = cal_raw

        # Tune scale on calibration set if raw coverage is outside [0.75, 0.85]
        if np.isfinite(cal_raw) and (cal_raw < 0.75 or cal_raw > 0.85):
            lo, hi = 0.5, 3.0
            best = 1.0
            for _ in range(25):
                mid = (lo + hi) / 2.0
                q10 = preds_cal["q50"].values - mid * (preds_cal["q50"].values - preds_cal["q10_raw"].values)
                q90 = preds_cal["q50"].values + mid * (preds_cal["q90_raw"].values - preds_cal["q50"].values)
                c = float(((y_cal >= q10) & (y_cal <= q90))[valid_cal].mean())
                best = mid
                if c < 0.80:
                    lo = mid
                else:
                    hi = mid
            self.scale = best

        q10_cal = preds_cal["q50"].values - self.scale * (preds_cal["q50"].values - preds_cal["q10_raw"].values)
        q90_cal = preds_cal["q50"].values + self.scale * (preds_cal["q90_raw"].values - preds_cal["q50"].values)
        self.calib_coverage_corrected = (
            float(((y_cal >= q10_cal) & (y_cal <= q90_cal))[valid_cal].mean())
            if valid_cal.any()
            else float("nan")
        )

        # Evaluate on held-out test_df if provided (per EVALUATION_RULES.md §7)
        target_df = test_df if (test_df is not None and len(test_df)) else calib_df
        preds_t = self.predict(target_df, mode)
        y_t = target_df["y"].values.astype(float)
        valid_t = np.isfinite(y_t) & np.isfinite(preds_t["q10_raw"].values)
        raw_t = (
            float(((y_t >= preds_t["q10_raw"].values) & (y_t <= preds_t["q90_raw"].values))[valid_t].mean())
            if valid_t.any()
            else float("nan")
        )
        corr_t = (
            float(((y_t >= preds_t["q10"].values) & (y_t <= preds_t["q90"].values))[valid_t].mean())
            if valid_t.any()
            else float("nan")
        )
        self.coverage_raw = raw_t
        self.coverage_corrected = corr_t
        return {
            "coverage_raw": self.coverage_raw,
            "coverage_corrected": self.coverage_corrected,
            "calib_2024_raw": self.calib_coverage_raw,
            "calib_2024_corrected": self.calib_coverage_corrected,
            "scale": self.scale,
        }

    def feature_importance(self) -> dict[str, float]:
        if 0.5 not in self.models:
            return {}
        imp = self.models[0.5].feature_importances_
        return {c: float(v) for c, v in zip(self.feature_cols, imp)}


@dataclass
class NormalBandModel:
    """Learns normal reach loss quantiles (q10, q50, q90) conditioned on flow, recharge, and season.

    Does NOT anchor on y_now/loss_lag1, so it provides a genuine physical baseline band
    for detecting sustained seepage/loss anomalies and computing excess loss.
    """

    models: dict[float, lgb.LGBMRegressor] = field(default_factory=dict)
    reach_codes: dict[str, int] = field(default_factory=dict)
    feature_cols: list[str] = field(default_factory=lambda: list(NORMAL_FEATURE_COLS))
    scale: float = 1.35

    def prepare(self, df: pd.DataFrame, ref_col: str = "upstream_lag_now") -> pd.DataFrame:
        out = df.copy()
        if ref_col in out.columns and out[ref_col].notna().any():
            out["upstream_ref"] = out[ref_col].fillna(out.get("upstream_now"))
        else:
            out["upstream_ref"] = out.get("upstream_future_deploy", out.get("upstream_now"))
        if not self.reach_codes:
            reaches = sorted(out["reach_id"].astype(str).unique())
            self.reach_codes = {r: i for i, r in enumerate(reaches)}
        out["reach_code"] = out["reach_id"].astype(str).map(self.reach_codes).fillna(-1).astype(int)
        return out

    def fit(self, train: pd.DataFrame) -> "NormalBandModel":
        dedup = train.sort_values("horizon").drop_duplicates(subset=["reach_id", "date"]).copy()
        df = self.prepare(dedup, ref_col="upstream_lag_now")
        need = ["y_now"] + [c for c in self.feature_cols if c != "reach_code"]
        df = df.dropna(subset=need)
        X = df[self.feature_cols]
        y = df["y_now"].values.astype(float)
        for alpha in (0.1, 0.5, 0.9):
            m = lgb.LGBMRegressor(
                objective="quantile",
                alpha=alpha,
                n_estimators=180,
                learning_rate=0.04,
                num_leaves=15,
                min_child_samples=40,
                subsample=0.8,
                colsample_bytree=0.8,
                reg_lambda=2.0,
                random_state=42,
                verbosity=-1,
            )
            m.fit(X, y)
            self.models[alpha] = m
        return self

    def predict(self, df: pd.DataFrame, ref_col: str = "upstream_lag_now") -> pd.DataFrame:
        prepared = self.prepare(df, ref_col=ref_col)
        X = prepared[self.feature_cols]
        q10 = self.models[0.1].predict(X)
        q50 = self.models[0.5].predict(X)
        q90 = self.models[0.9].predict(X)
        q10e, q50e, q90e = _order_quantiles_with_floor(q10, q50, q90, min_half_width=5.0)
        # Apply out-of-sample width factor + gauge uncertainty floor (~7% of flow, min 15 cfs)
        flow_ref = np.abs(prepared["upstream_ref"].fillna(200.0).values.astype(float))
        unc_floor = np.maximum(15.0, 0.08 * flow_ref)
        half_lo = np.maximum(self.scale * (q50e - q10e), unc_floor)
        half_hi = np.maximum(self.scale * (q90e - q50e), unc_floor)
        return pd.DataFrame(
            {
                "normal_q10": q50e - half_lo,
                "normal_q50": q50e,
                "normal_q90": q50e + half_hi,
            },
            index=df.index,
        )
