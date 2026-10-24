"""Export the first-screen bundle JSON."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    # Check bool BEFORE int because bool is a subclass of int in Python!
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.floating, float)):
        x = float(obj)
        return None if not np.isfinite(x) else x
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d")
    if obj is None:
        return None
    return obj


def write_bundle(path: Path, bundle: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_json_safe(bundle), indent=2))


def build_geometry(cfg: dict) -> dict:
    coords = cfg.get("geometry", {}).get("corridor", [])
    reaches = []
    # Corridor vertices:
    # 0: MIL, 4: GRF, 7: SJB, 9: SDP, 11: SWA.
    # Slice end is inclusive of downstream node index (so b = node_idx + 1)
    # to ensure continuous connected reach LineStrings with zero gaps.
    splits = {
        "R1": (0, 5),
        "R2A": (4, 8),
        "R2B3": (7, 10),
        "R4A": (9, 12),
    }
    for r in cfg["reaches"]:
        a, b = splits.get(r["id"], (0, len(coords)))
        seg = coords[a:b] if b <= len(coords) else coords[a:]
        if len(seg) < 2 and coords:
            seg = coords[:2]
        reaches.append(
            {
                "id": r["id"],
                "name": r["name"],
                "coordinates": seg,
                "forecast": bool(r["forecast"]),
                "label": r["label"],
            }
        )
    nodes = []
    for n in cfg["nodes"]:
        g = cfg["gauges"][n["gauge"]]
        nodes.append(
            {
                "id": n["id"],
                "name": n["name"],
                "lon": float(g["lon"]),
                "lat": float(g["lat"]),
            }
        )
    return {"reaches": reaches, "nodes": nodes, "provenance": "schematic"}
