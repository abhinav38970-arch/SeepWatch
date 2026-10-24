# SeepWatch

A **canal-loss forecasting engine** validated on the San Joaquin River Restoration Program (SJRRP) corridor — the one San Joaquin Valley conveyance system with public reach-paired gauges.

Central Valley canals lose water that districts often discover only when a farmer calls. Public data cannot show loss on most irrigation canals. SeepWatch forecasts reach-level unexplained loss and downstream shortfall from any upstream/downstream gauge pair. The measured tier is trained on SJRRP CDEC gauges using the program's own reach-balance formulas. Designed for districts to plug in SCADA pairs; **not yet run on district data**.

## What you get

- Measured reach-balance labels (`Q_down + extras − Q_up(lagged)`)
- LightGBM quantile forecasts (1–7 day) with honest baselines (persistence, SJRRP curve, flow-aware regression)
- Excess-loss anomaly flags and a ditch-rider watchlist
- Monte Carlo downstream shortfall (arrival vs expected arrival)
- Interactive map UI (10-second first screen)
- Pre-registered evaluation rules and pitch scenarios A–D

## Quick start (local)

```bash
# Python 3.11+
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv .venv
source .venv/bin/activate
uv pip install -e .

# Fetch CDEC data, train, export artifacts/bundle.json
seepwatch-pipeline

# API + UI on http://127.0.0.1:43123
# (build frontend first — see below)
seepwatch-api
```

### Frontend

```bash
cd frontend
npm install
npm run build    # outputs frontend/dist, served by the API
# or for hot reload against the API:
npm run dev      # Vite on an uncommon port; proxies /api
```

## Honesty labels

Every number is tagged **measured**, **modeled**, or **synthetic**:

| Layer | Tag |
|---|---|
| Reach-balance loss on SJRRP gauges | measured |
| Loss forecasts / shortfall intervals | modeled |
| Reach 1 | unexplained_loss (holding contracts) |
| Reach 4A | context only (noise floor) |
| Flood-operations days | no forecast |
| Map corridor geometry | schematic |

## Evaluation

Rules are locked in [`docs/EVALUATION_RULES.md`](docs/EVALUATION_RULES.md) **before** the held-out years (2025–2026) are scored. Pitch narratives for scenarios A–D are in [`docs/PITCH_SCENARIOS.md`](docs/PITCH_SCENARIOS.md).

Headline skill uses **deployable mode** (future upstream flow held constant).

## Project layout

```
seepwatch/          Python package (ingest → model → bundle → API)
config/reaches.yaml Config-driven gauge pairs (plug-in point)
docs/               Pre-registered rules + pitch templates
artifacts/          bundle.json, evidence, models
frontend/           Map UI
spike/              Hour-0 data gate scripts
```

## License

MIT — hackathon prototype. Not an operational decision system.
