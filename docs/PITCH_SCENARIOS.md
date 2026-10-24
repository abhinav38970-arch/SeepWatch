# SeepWatch pitch scenarios (pre-registered)

**Status:** written before any model was trained.
**Locked date:** 2026-10-24 (America/Los_Angeles).

Only the numbers in `{braces}` change after evaluation. The narrative for each scenario is fixed.

---

## Slide 1 (shared, all scenarios)

**SeepWatch: a canal-loss forecasting engine**

Central Valley canals lose water that districts cannot see until a farmer calls. Public data cannot show loss on most canals.

SeepWatch forecasts reach-level loss and downstream shortfall from any upstream and downstream gauge pair. We validated it on the one San Joaquin Valley conveyance system with public reach-paired gauges — the San Joaquin River Restoration corridor — using measured labels and honest baselines. On Reach 2A the river loses about 80 cfs in steady flow, roughly 30–50% of what enters.

Designed for districts to plug in their own SCADA pairs. **Not yet run on district data.**

---

## Active Result — Scenario B (`mixed_by_regime`)

- **As-of date:** `2026-10-19` (train `2016–2024`: `46,254` rows; held-out test `2025–2026`: `9,801` rows).
- **Short horizons (days 1–2):** Persistence is hard to beat when flow is steady.
- **Longer horizons (days 5–7):** LightGBM beats persistence at **all three** multi-day horizons (`+7.7%` at day 5, `+8.9%` at day 6, `+8.9%` at day 7, 95% block-bootstrap CI $> 0$), with `+0.9%` mean skill overall vs persistence and `+3.4%` mean skill on ramp days.
- **Vs programmatic baselines:** Beats the SJRRP monthly loss curve (`+50.4%` mean skill, `7/7` horizons) and per-reach flow-aware regression (`+49.1%` mean skill, `7/7` horizons).
- **Interval coverage:** `81.0%` on 2024 out-of-sample calibration; `74.7%` on held-out 2025–2026 test set.
- **Current alert (`2026-10-19`):** Reach 2A is forecast to lose `170.7 cfs` (`73.8 cfs` above normal `96.9 cfs`), driving a forecast arrival shortfall of `48 cfs` (`80%` interval `15 to 82 cfs`) at Chowchilla Bifurcation (`SJB`).

---

## Scenario A — `beats_best_baseline`

**Lead:** Forecast beats the best baseline by `{skill_pct}%` mean skill across days 1–7 on held-out water years 2025–2026 (deployable mode: future flow held constant).

**Product:** The engine + shortfall map.

**Supporting:**
- Per-horizon skill vs persistence / SJRRP curve / flow-aware regression.
- Interval coverage `{coverage_pct}%` (target 80%).
- Watchlist of reaches with excess loss; node shortfall intervals.

**Honest limits (always):** unexplained loss ≠ pure seepage; SJRRP corridor only; flood days excluded; CDEC provisional.

---

## Scenario B — `mixed_by_regime`

**Lead:** Persistence is hard to beat when flow is steady. The model wins where operators need it — at ramp-up and/or longer horizons — by `{skill_ramp_pct}%` on the ramp regime (or `{skill_long_pct}%` at days 5–7).

**Product:** Regime-aware forecast + shortfall map. Show both regimes openly.

**Supporting:**
- Steady-regime skill (may be near zero or negative) vs ramp/long-horizon skill.
- Same interval and shortfall artifacts as A.

**Honest limits (always):** same as A. Do **not** claim overall 7/7 win.

---

## Scenario C — `beats_sjrrp_curve_only`

**Lead:** A calibrated expected-loss band and anomaly flags that improve on the program's own loss curve (`{skill_sjrrp_pct}%` skill vs SJRRP curve). Persistence remains the short-term ceiling.

**Product:** Anomaly flags + calibrated intervals + downstream shortfall — not point-forecast supremacy.

**Supporting:**
- Show persistence MAE as the honest short-horizon floor.
- False-alarm rate per reach per month.
- Shortfall intervals driven by excess-loss forecasts.

**Honest limits (always):** same as A. Explicitly: ML does not beat persistence overall.

---

## Scenario D — `beats_neither`

**Lead:** We tested whether ML adds value on this data and it does not beat the baselines on held-out years. The product is a transparent anomaly and shortfall engine built on the program's own reach-balance method, with calibrated uncertainty.

**Product:** Measured reach-balance pipeline + excess-loss flags + shortfall map. Negative ML result shown as a finding.

**Supporting:**
- Skill table (may be negative) vs all three baselines.
- The pipeline, flood handling, and honesty labels remain the contribution.

**Honest limits (always):** same as A. Do not dress D up as A or B.

---

## First-screen skill number

Always show mean skill vs best baseline (horizons 1–7, deployable mode), even when negative. Source field: `bundle.headline.skill_vs_best_baseline`.
