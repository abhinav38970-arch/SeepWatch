"""Templated alert strings only. No LLM."""
from __future__ import annotations

REACH_IMMEDIATE_NODE = {
    "R1": "GRF",
    "R2A": "SJB",
    "R2B3": "SDP",
    "R4A": "SWA",
}


def reach_alert(
    reach_id: str,
    loss_cfs: float,
    normal_loss_cfs: float,
    excess_cfs: float,
    days: int,
    node: str,
    a_lo: float,
    a_hi: float,
    expected: float,
) -> str:
    ex = excess_cfs if excess_cfs == excess_cfs else 0.0
    if loss_cfs > 0:
        loss_phrase = f"net gain +{loss_cfs:.1f} cfs (normal {normal_loss_cfs:.1f} cfs, no excess seepage loss)"
    else:
        loss_mag = abs(loss_cfs)
        norm_mag = abs(min(0.0, normal_loss_cfs))
        if ex >= 1.0:
            loss_phrase = f"forecast loss {loss_mag:.1f} cfs ({ex:.1f} cfs above normal {norm_mag:.1f} cfs)"
        elif ex <= -1.0:
            loss_phrase = f"forecast loss {loss_mag:.1f} cfs ({abs(ex):.1f} cfs below normal {norm_mag:.1f} cfs)"
        else:
            loss_phrase = f"forecast loss {loss_mag:.1f} cfs (near normal {norm_mag:.1f} cfs)"
    return (
        f"Reach {reach_id}: {loss_phrase} over the next {days} days. "
        f"{node} arrival {a_lo:.0f} to {a_hi:.0f} cfs against an expected {expected:.0f} cfs."
    )


def watchlist_alerts(watchlist: list[dict], shortfalls: list[dict], days: int = 7) -> list[str]:
    by_node = {s["node_id"]: s for s in shortfalls}
    alerts = []
    for w in watchlist[:3]:
        rid = w["reach_id"]
        target_nid = REACH_IMMEDIATE_NODE.get(rid)
        node = by_node.get(target_nid) if target_nid else None
        if node is None:
            for nid in ("GRF", "SJB", "SDP", "SWA"):
                s = by_node.get(nid)
                if s and rid in s.get("upstream_reaches", []):
                    node = s
                    break
        if node is None and shortfalls:
            node = shortfalls[-1]
        if node is None:
            continue
        alerts.append(
            reach_alert(
                rid,
                float(w.get("forecast_loss_cfs", 0.0)),
                float(w.get("normal_loss_cfs", w.get("forecast_loss_cfs", 0.0))),
                float(w.get("excess_loss_cfs", 0.0)),
                days,
                node["name"],
                node["arrival_p10"],
                node["arrival_p90"],
                node["expected_arrival_cfs"],
            )
        )
    return alerts
