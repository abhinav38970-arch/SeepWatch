"""CDEC CSV ingest with raw file caching."""
from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import httpx
import pandas as pd

from seepwatch.config import DATA_RAW

log = logging.getLogger(__name__)

CDEC_CSV = "https://cdec.water.ca.gov/dynamicapp/req/CSVDataServlet"


def _cache_path(station: str, sensor: int, duration: str, start: str, end: str) -> Path:
    name = f"{station}_{sensor}_{duration}_{start}_{end}.csv".replace(":", "")
    return DATA_RAW / "cdec" / name


def _is_valid_cdec_csv(raw: str) -> bool:
    if not raw or not raw.strip():
        return False
    first_line = raw.splitlines()[0]
    return "STATION_ID" in first_line and "VALUE" in first_line


def fetch_series(
    station: str,
    sensor: int,
    duration: str,
    start: str = "2009-01-01",
    end: str | None = None,
    force: bool = False,
) -> pd.DataFrame:
    """Fetch one CDEC series. Returns columns: station, sensor, duration, ts, value, art, flag."""
    end = end or date.today().isoformat()
    path = _cache_path(station, sensor, duration, start, end)
    path.parent.mkdir(parents=True, exist_ok=True)

    raw = ""
    if path.exists() and not force and path.stat().st_size > 100:
        cached = path.read_text()
        if _is_valid_cdec_csv(cached):
            log.info("cache hit %s", path.name)
            raw = cached

    if not raw:
        params = {
            "Stations": station,
            "SensorNums": str(sensor),
            "dur_code": duration,
            "Start": start,
            "End": end,
        }
        log.info("fetching CDEC %s", params)
        with httpx.Client(timeout=180.0) as client:
            r = client.get(CDEC_CSV, params=params)
            r.raise_for_status()
            raw = r.text
        if _is_valid_cdec_csv(raw):
            path.write_text(raw)

    if not _is_valid_cdec_csv(raw):
        log.warning("empty or unexpected response for %s sensor %s", station, sensor)
        return pd.DataFrame(columns=["station", "sensor", "duration", "ts", "value", "art", "flag"])

    df = pd.read_csv(path if path.exists() else pd.io.common.StringIO(raw))
    df["ts"] = pd.to_datetime(df["DATE TIME"], format="%Y%m%d %H%M", errors="coerce")
    val_str = df["VALUE"].astype(str).str.strip()
    # CDEC codes: BRT = Below Rating Table (~0 cfs), ART = Above Rating Table (extreme flood)
    df["art"] = val_str == "ART"
    val_clean = val_str.where(val_str != "BRT", "0.0")
    df["value"] = pd.to_numeric(val_clean, errors="coerce")
    df["flag"] = df.get("DATA_FLAG", "").astype(str)
    df["duration"] = duration
    out = df.rename(columns={"STATION_ID": "station", "SENSOR_NUMBER": "sensor"})[
        ["station", "sensor", "duration", "ts", "value", "art", "flag"]
    ].dropna(subset=["ts"])
    return out.sort_values("ts").reset_index(drop=True)


def fetch_all_gauges(
    cfg: dict,
    start: str = "2009-01-01",
    end: str | None = None,
    force: bool = False,
) -> dict[str, pd.DataFrame]:
    series: dict[str, pd.DataFrame] = {}
    for key, g in cfg["gauges"].items():
        series[key] = fetch_series(
            station=g["cdec_id"],
            sensor=int(g["sensor"]),
            duration=g["duration"],
            start=start,
            end=end,
            force=force,
        )
    return series
