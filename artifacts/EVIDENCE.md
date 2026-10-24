# SeepWatch evidence

- asof: `2026-10-19`
- pitch_scenario: **B** (`mixed_by_regime`)
- skill vs best baseline (persistence): **0.009**
- skill vs SJRRP curve: **0.504**
- skill vs flow-aware regression: **0.491**
- held-out 80% interval coverage (raw / calibrated): `0.747` / `0.747` (scale `1.00`)
- train/test rows: 46254 / 9801

## Per-horizon skill (deployable)

| h | vs persistence | vs SJRRP | vs flow-aware |
|---|---|---|---|
| 1 | -0.209 | 0.690✓ | 0.682✓ |
| 2 | -0.036 | 0.581✓ | 0.570✓ |
| 3 | 0.005 | 0.510✓ | 0.497✓ |
| 4 | 0.045 | 0.468✓ | 0.455✓ |
| 5 | 0.077✓ | 0.448✓ | 0.433✓ |
| 6 | 0.089✓ | 0.426✓ | 0.411✓ |
| 7 | 0.089✓ | 0.404✓ | 0.386✓ |
