"""Monte Carlo downstream shortfall: arrival vs expected arrival."""
from __future__ import annotations

import numpy as np
import pandas as pd


def sample_loss(q10: float, q50: float, q90: float, rng: np.random.Generator, n: int = 1000) -> np.ndarray:
    """Piecewise-uniform sample between quantiles (approx)."""
    u = rng.random(n)
    out = np.empty(n)
    left = u < 0.5
    # map [0,0.5] -> [q10,q50], [0.5,1] -> [q50,q90]
    out[left] = q10 + (u[left] / 0.5) * (q50 - q10)
    out[~left] = q50 + ((u[~left] - 0.5) / 0.5) * (q90 - q50)
    return out


def node_shortfalls(
    forecast_by_reach: pd.DataFrame,
    nodes: list[dict],
    release_cfs: float,
    n_draws: int = 1000,
    seed: int = 42,
) -> list[dict]:
    """forecast_by_reach: rows with reach_id, horizon, q10, q50, q90 for a single as-of date.

    Shortfall over the next 7 days uses mean predicted loss across horizons 1..7 per reach.
    Arrival = release + sum(loss) along upstream reaches (loss is negative).
    Expected arrival uses q50; forecast arrival samples quantiles.
    """
    rng = np.random.default_rng(seed)
    # Aggregate each reach to 7-day mean forecast
    agg = (
        forecast_by_reach.groupby("reach_id")[["q10", "q50", "q90"]]
        .mean()
        .to_dict(orient="index")
    )
    results = []
    for node in nodes:
        ups = node["upstream_reaches"]
        # Expected arrival using medians
        expected_loss_sum = sum(agg[r]["q50"] for r in ups if r in agg)
        expected_arrival = release_cfs + expected_loss_sum

        # Monte Carlo
        draws = np.full(n_draws, release_cfs, dtype=float)
        for r in ups:
            if r not in agg:
                continue
            draws = draws + sample_loss(agg[r]["q10"], agg[r]["q50"], agg[r]["q90"], rng, n_draws)

        # shortfall = expected - forecast (positive when worse than expected)
        shortfall_draws = expected_arrival - draws
        # Also report arrival quantiles
        results.append(
            {
                "node_id": node["id"],
                "name": node["name"],
                "release_cfs": release_cfs,
                "expected_arrival_cfs": float(expected_arrival),
                "arrival_p10": float(np.quantile(draws, 0.1)),
                "arrival_p50": float(np.quantile(draws, 0.5)),
                "arrival_p90": float(np.quantile(draws, 0.9)),
                "shortfall_p10": float(np.quantile(shortfall_draws, 0.1)),
                "shortfall_p50": float(np.quantile(shortfall_draws, 0.5)),
                "shortfall_p90": float(np.quantile(shortfall_draws, 0.9)),
                "upstream_reaches": ups,
                "provenance": "measured",
            }
        )
    return results
