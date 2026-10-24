"""Monte Carlo downstream shortfall: forecast arrival vs expected normal arrival."""
from __future__ import annotations

import numpy as np
import pandas as pd

Z90 = 1.2815515655446004


def sample_loss(
    q10: float,
    q50: float,
    q90: float,
    rng: np.random.Generator,
    n: int = 2000,
) -> np.ndarray:
    """Split-normal sample matching (q10, q50, q90) at the 10th, 50th, and 90th percentiles."""
    z = rng.standard_normal(n)
    sigma_l = max(0.5, (q50 - q10) / Z90)
    sigma_r = max(0.5, (q90 - q50) / Z90)
    return np.where(z < 0.0, q50 + z * sigma_l, q50 + z * sigma_r)


def node_shortfalls(
    forecast_by_reach: pd.DataFrame,
    nodes: list[dict],
    release_cfs: float,
    r4a_context_loss: dict | None = None,
    n_draws: int = 2000,
    seed: int = 42,
) -> list[dict]:
    """Compute arrival and shortfall intervals for each downstream node.

    - `expected_arrival_cfs`: release minus normal expected conveyance loss (normal_q50)
      on upstream reaches.
    - `forecast_arrival`: Monte Carlo draws using forecast quantiles (q10, q50, q90)
      on upstream reaches.
    - `shortfall`: `expected_arrival_cfs - forecast_arrival` (positive when forecast arrival
      is lower than normal expected arrival due to excess upstream loss).
    """
    rng = np.random.default_rng(seed)
    cols = ["q10", "q50", "q90"]
    if "normal_q50" in forecast_by_reach.columns:
        cols.append("normal_q50")
    agg = (
        forecast_by_reach.groupby("reach_id")[cols]
        .mean()
        .to_dict(orient="index")
    )
    if r4a_context_loss and "R4A" not in agg:
        agg["R4A"] = r4a_context_loss

    # Draw once per reach so all downstream nodes share the same Monte Carlo sample paths
    reach_draws: dict[str, np.ndarray] = {}
    reach_expected_loss: dict[str, float] = {}
    for rid, vals in agg.items():
        # Clamp net gains (> 0) to 0 conveyance loss so unmodeled tributary/pool inflows
        # do not artificially inflate Friant-release arrival
        q10_loss = min(0.0, float(vals["q10"]))
        q50_loss = min(0.0, float(vals["q50"]))
        q90_loss = min(0.0, float(vals["q90"]))
        norm_q50 = min(0.0, float(vals.get("normal_q50", vals["q50"])))
        raw_draws = sample_loss(q10_loss, q50_loss, q90_loss, rng, n_draws)
        reach_draws[rid] = np.minimum(0.0, raw_draws)
        reach_expected_loss[rid] = norm_q50

    results = []
    for node in nodes:
        ups = node["upstream_reaches"]
        expected_loss_sum = sum(reach_expected_loss.get(r, 0.0) for r in ups)
        expected_arrival = max(0.0, release_cfs + expected_loss_sum)

        draws = np.full(n_draws, release_cfs, dtype=float)
        for r in ups:
            if r in reach_draws:
                draws = draws + reach_draws[r]
        draws = np.maximum(0.0, draws)

        shortfall_draws = expected_arrival - draws
        prov = "measured_plus_context" if "R4A" in ups else "measured"
        results.append(
            {
                "node_id": node["id"],
                "name": node["name"],
                "release_cfs": float(release_cfs),
                "expected_arrival_cfs": float(expected_arrival),
                "arrival_p10": float(np.quantile(draws, 0.1)),
                "arrival_p50": float(np.quantile(draws, 0.5)),
                "arrival_p90": float(np.quantile(draws, 0.9)),
                "shortfall_p10": float(np.quantile(shortfall_draws, 0.1)),
                "shortfall_p50": float(np.quantile(shortfall_draws, 0.5)),
                "shortfall_p90": float(np.quantile(shortfall_draws, 0.9)),
                "upstream_reaches": ups,
                "provenance": prov,
            }
        )
    return results
