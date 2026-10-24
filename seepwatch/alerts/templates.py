"""Templated alert strings only. No LLM."""
from __future__ import annotations


def reach_alert(reach_id: str, loss_cfs: float, excess_cfs: float, days: int, node: str, a_lo: float, a_hi: float, expected: float) -> str:
    ex = excess_cfs if excess_cfs == excess_cfs else 0.0  # NaN guard
    return (
        f"Reach {reach_id}: forecast loss {loss_cfs:.1f} cfs, "
        f"{ex:.1f} cfs above recent loss over the next {days} days. "
        f"{node} arrival {a_lo:.0f} to {a_hi:.0f} cfs against an expected {expected:.0f} cfs."
    )


def watchlist_alerts(watchlist: list[dict], shortfalls: list[dict], days: int = 7) -> list[str]:
    by_node = {s["node_id"]: s for s in shortfalls}
    alerts = []
    for w in watchlist[:3]:
        # Pick the furthest downstream node that includes this reach
        node = None
        for nid in ("SWA", "SDP", "SJB", "GRF"):
            s = by_node.get(nid)
            if s and w["reach_id"] in s.get("upstream_reaches", []):
                node = s
                break
        if node is None and shortfalls:
            node = shortfalls[-1]
        if node is None:
            continue
        alerts.append(
            reach_alert(
                w["reach_id"],
                w.get("forecast_loss_cfs", 0.0),
                w.get("excess_loss_cfs", 0.0),
                days,
                node["name"],
                node["arrival_p10"],
                node["arrival_p90"],
                node["expected_arrival_cfs"],
            )
        )
    return alerts
