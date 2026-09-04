# SkyGuard AI Backend

FastAPI backend for the SkyGuard AI weather-station anomaly monitoring flow.

Current flow:

```text
Weather reading
-> AnomalyDetector abstraction
-> AnomalyVerdict
-> Alert
-> Work Order
```

The real ML engine is external and is not included in this repository yet. The backend keeps `AnomalyDetector` as the adapter boundary so the real engine can later replace `MockAnomalyDetector` without rewriting the API layer.

## Current Technology

- FastAPI
- SQLAlchemy ORM
- Supabase PostgreSQL through `DATABASE_URL`

SQLite is no longer the default backend database. The old local SQLite file, if present at `backend/skyguard.db`, is not deleted by this migration. SQLite can still be used only when explicitly enabled for local-only development with `SKYGUARD_ALLOW_SQLITE=true`.

## Environment

Create `backend/.env` from the safe example file:

```powershell
Copy-Item .env.example .env
```

Then set the real Supabase connection string locally:

```text
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_SUPABASE_HOST:5432/postgres
```

Do not commit `backend/.env`. It is ignored by `.gitignore`.

## Setup

From the `backend` directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Schema Initialization

The project does not use Alembic yet. For the current beginner-friendly backend, SQLAlchemy creates missing tables from the existing ORM models. This is non-destructive and does not reset existing Supabase data.

FastAPI runs schema initialization at startup. You can also run it explicitly from the `backend` directory:

```powershell
python -m app.db.init_schema
```

## Seed Data

Demo seed data is disabled by default so the shared Supabase database is not silently filled on every startup.

For local demo-only data, set this explicitly before startup:

```text
SKYGUARD_SEED_DEMO_DATA=true
```

The seed function checks whether any station already exists and will not duplicate stations on repeated runs.

## Run

From the `backend` directory:

```powershell
uvicorn app.main:app --reload
```

API docs:

```text
http://127.0.0.1:8000/docs
```

## Required Contract Endpoints

### GET /health

Returns basic backend/network health.

Example response:

```json
{
  "status": "running",
  "station_count": 3,
  "open_alert_count": 1,
  "active_work_order_count": 0
}
```

### GET /stations

Returns station summaries using the target contract shape.

Example station:

```json
{
  "station_id": "AWS_PNQ",
  "name": "Pune",
  "lat": 18.52,
  "lon": 73.86,
  "health": 0.912,
  "status": "MONITOR",
  "degradation": 0.088,
  "trend_per_day": 0.00123,
  "days_to_threshold": 88,
  "high_conf_alerts": 412,
  "alert_rate_pct": 2.35,
  "rate_vs_network": 1.8,
  "last_seen": "2024-12-31T23:00:00"
}
```

Allowed station statuses:

```text
SERVICE NOW
SCHEDULE
MONITOR
OK
```

`days_to_threshold` may be `null`.

### POST /ingest

Runs the current `AnomalyDetector` adapter for one observation and returns the contract verdict. This endpoint does not persist every observation, which keeps ingestion separate from database persistence and future in-memory streaming model state.

Example request:

```json
{
  "station_id": "STATION-001",
  "timestamp": "2024-05-14T15:00:00",
  "T": 34.2,
  "P": 948.1,
  "RH": 62.0,
  "flag": 0,
  "amp_ratio_P": 0.97
}
```

Example response:

```json
{
  "flag": 1,
  "reason": "range",
  "severity": 0.734,
  "confidence": 0.83,
  "degradation": 0.512,
  "evidence": [
    ["temperature_demo_threshold", 46.2],
    ["amp_ratio_P", 0.97]
  ]
}
```

Allowed reasons:

```text
ok
range
step
frozen
missing
drift
degrading
anomaly
unclassified
```

The current response is produced by `MockAnomalyDetector` for local development only. It is not the real ML engine.

### GET /stations/{id}/timeseries?from=&to=

Returns persisted reading rows for one station. `from` and `to` are optional ISO datetime filters.

Example row:

```json
{
  "timestamp": "2024-05-14T15:00:00",
  "T": 34.2,
  "P": 948.1,
  "RH": 62.0,
  "flag": 0,
  "amp_ratio_P": 0.97
}
```

### GET /stations/{id}/alerts

Returns alerts for one station, including verdict evidence needed by an alert detail view.

Example alert:

```json
{
  "id": 1,
  "station_id": "STATION-001",
  "reading_id": 12,
  "anomaly_verdict_id": 7,
  "severity": 0.734,
  "message": "range",
  "status": "open",
  "confidence": 0.83,
  "degradation": 0.512,
  "evidence": [["temperature_demo_threshold", 46.2]],
  "created_at": "2026-09-04T10:00:00",
  "resolved_at": null
}
```

## Existing Useful Endpoints Preserved

- `GET /`
- `GET /health`
- `GET /stations`
- `GET /stations/{station_id}`
- `GET /stations/{station_id}/overview`
- `GET /stations/{station_id}/readings`
- `GET /stations/{station_id}/timeseries`
- `POST /readings`
- `POST /readings/verdict`
- `POST /ingest`
- `GET /alerts`
- `GET /alerts/{alert_id}`
- `PATCH /alerts/{alert_id}/status`
- `GET /stations/{station_id}/alerts`
- `GET /verdicts`
- `GET /verdicts/{verdict_id}`
- `GET /stations/{station_id}/verdicts`
- `GET /work-orders`
- `GET /work-orders/{work_order_id}`
- `POST /alerts/{alert_id}/work-order`
- `PATCH /work-orders/{work_order_id}/status`

## Tests

Tests use `DATABASE_URL` from `backend/.env` and do not hard-code credentials.

From the repository root:

```powershell
python -m unittest discover backend\tests
```
