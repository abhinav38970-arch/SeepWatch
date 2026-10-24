# SeepWatch pre-registered evaluation rules

**Status:** locked before any held-out year is scored.
**Locked date:** 2026-10-24 (America/Los_Angeles).

These rules are fixed. Numbers may change; the decision procedure may not.

## 1. Data window and exclusions

- Training window: 2016-01-01 through 2024-12-31.
- Held-out test years: 2025-01-01 through the latest available date.
- Flood-operations days are excluded from training, scoring, and forecasts.
  - Flood flag: `CBP > 5 cfs` OR upstream flow `> 1600 cfs`.
- Days with fewer than 20 hourly gauge values (when deriving daily means) are treated as missing.
- Reach 4A is shown as context only and is **not** scored.

## 2. Reach set

| Reach ID | Upstream | Downstream | Lag (days) | Extra terms | Role |
|---|---|---|---|---|---|
| R1 | MIL | GRF | 3 | none | Modeled, labeled **unexplained loss** |
| R2A | GRF | SJB | 1 | +CBP on downstream side | **Primary** |
| R2B3 | SJB | SDP | 1 | none | Secondary |
| R4A | SDP | SWA | 1 | none | Context only (noise floor) |

Label formula: `loss_cfs = downstream(t) + extra_inflows(t) - upstream(t - lag)`.

Sign convention: negative = net loss (downstream lower than lagged upstream). Forecasts and scores use `loss_cfs` as signed. Anomaly "excess loss" uses the magnitude of loss beyond expected (more negative than expected).

## 3. Evaluation modes

### Deployable mode (headline)
- Future upstream flow is held at its value on the forecast date.
- Headline skill number and pitch scenario come from this mode.

### What-if mode
- The upstream flow path that actually occurred is supplied.
- Skill is compared against the **flow-aware baseline**, not only persistence.

## 4. Skill metric

For each horizon `h ∈ {1,2,3,4,5,6,7}`:

```
skill(h) = 1 - MAE_model(h) / MAE_baseline(h)
```

- MAE is mean absolute error of predicted `loss_cfs` vs observed `loss_cfs`.
- Uncertainty: block bootstrap across calendar weeks (Monday-bounded), 500 resamples.
- A model **beats** a baseline at horizon `h` only if the 95% CI lower bound of `skill(h)` is strictly greater than 0.
- Overall **beats** a baseline means beating it at **4 or more of 7** horizons.

## 5. Baselines (all required)

1. **Persistence:** `ŷ(t+h) = y(t)`.
2. **SJRRP loss curve:** empirical P50 of `loss_cfs / upstream` by calendar month, applied to the mode's upstream flow.
3. **Flow-aware regression:** ordinary least squares of `loss_cfs` on `[upstream, upstream², sin_doy, cos_doy]` fit on training years only.

"Best baseline" for scenario selection means the baseline with the lowest MAE on the held-out set in deployable mode, aggregated across horizons 1–7.

## 6. Regimes

- **Ramp:** upstream flow changed by more than 50% over the previous 7 days
  (`|Q(t)/Q(t-7) - 1| > 0.5`), with upstream ≥ 50 cfs on at least one of those days.
- **Steady:** everything else (non-flood).

The resume-after-dry regime is dropped (no resume events after 2016).

If the held-out years contain fewer than **20 ramp days** with valid labels, the regime claim is dropped and the scenario uses conservative wording (no "wins at ramp-up" claim).

## 7. Interval honesty

- LightGBM quantile heads at 10 / 50 / 90.
- Report empirical coverage of the central 80% interval (`q10`–`q90`) on held-out days.
- If coverage is outside `[0.70, 0.90]`, apply a simple scale correction around the median and report both raw and corrected coverage.

## 8. Pitch scenario decision tree

Selected mechanically from deployable-mode results; exported as `pitch_scenario`:

```
if model beats best_baseline overall:
    A  # "beats best baseline"
elif ramp days >= 20 and model beats best_baseline on ramp regime (4+/7 horizons)
     and NOT overall:
    B  # "mixed by regime"
elif model beats SJRRP curve overall
     and NOT beats persistence overall
     and NOT beats flow-aware overall:
    C  # "beats SJRRP curve only"
else:
    D  # "beats neither" (or insufficient evidence)
```

Special case for B: if the model beats the best baseline overall on horizons {5,6,7} (≥2 of 3) but not overall, also allow B with wording focused on longer horizons.

The first-screen skill number is the mean skill vs the best baseline across horizons 1–7 in deployable mode (may be negative).

## 9. Anomaly validation

- Flag when forecast/observed excess loss (more negative than predicted median) exceeds the q90 residual band for N consecutive days (N tuned on training/validation only, default 2).
- Known gauge outages and flood operations **must not** be flagged as seepage.
- Synthetic breach injection is labeled `synthetic` and is Should-tier.

## 10. Shortfall definition (MVP)

`shortfall = expected_arrival - forecast_arrival`

where `expected_arrival` uses the model's median loss on upstream reaches under the same release scenario, and `forecast_arrival` samples the quantile forecasts. Report median and 80% interval.
