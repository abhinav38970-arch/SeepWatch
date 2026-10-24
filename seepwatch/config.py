from __future__ import annotations

from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "reaches.yaml"
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
ARTIFACTS = ROOT / "artifacts"
DOCS = ROOT / "docs"


def load_config(path: Path | None = None) -> dict[str, Any]:
    import yaml

    p = path or CONFIG_PATH
    text = p.read_text()
    try:
        return yaml.safe_load(text)
    except Exception:
        # Minimal fallback parser if PyYAML is unavailable — but we install pyyaml.
        raise


def ensure_dirs() -> None:
    for d in (DATA_RAW, DATA_PROCESSED, ARTIFACTS):
        d.mkdir(parents=True, exist_ok=True)
