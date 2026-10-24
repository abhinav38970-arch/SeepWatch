"""Minimal read-only FastAPI over the exported bundle."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from seepwatch.config import ARTIFACTS, ROOT

BUNDLE_PATH = ARTIFACTS / "bundle.json"
FRONTEND_DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="SeepWatch API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load() -> dict:
    if not BUNDLE_PATH.exists():
        raise HTTPException(503, "bundle.json missing — run seepwatch-pipeline first")
    return json.loads(BUNDLE_PATH.read_text())


@app.get("/api/health")
def health():
    return {"ok": True, "bundle": BUNDLE_PATH.exists()}


@app.get("/api/bundle")
def get_bundle():
    return _load()


@app.get("/api/reach/{reach_id}")
def get_reach(reach_id: str):
    b = _load()
    fc = b.get("reach_forecasts", {}).get(reach_id)
    color = next((r for r in b.get("reach_colors", []) if r["id"] == reach_id), None)
    if color is None and fc is None:
        raise HTTPException(404, f"reach {reach_id} not found")
    timeline = b.get("timeline", []) if reach_id == "R2A" else []
    return {
        "reach_id": reach_id,
        "color": color,
        "forecast": fc,
        "timeline": timeline,
        "provenance": b.get("provenance"),
    }


@app.get("/api/node/{node_id}")
def get_node(node_id: str):
    b = _load()
    node = next((n for n in b.get("nodes_shortfall", []) if n["node_id"] == node_id), None)
    if node is None:
        raise HTTPException(404, f"node {node_id} not found")
    return node


@app.get("/api/evidence")
def get_evidence():
    b = _load()
    return {
        "pitch_scenario": b.get("pitch_scenario"),
        "pitch_key": b.get("pitch_key"),
        "headline": b.get("headline"),
        "evidence": b.get("evidence"),
        "provenance": b.get("provenance"),
        "gate": b.get("gate"),
    }


# Mount UI after API routes when dist exists (import-time for `uvicorn seepwatch.api.server:app`)
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=43123, reload=False)


if __name__ == "__main__":
    main()
