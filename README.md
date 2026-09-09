# Sahasraksha

Sahasraksha is a weather-station monitoring application for inspecting station health, telemetry, anomalies, alerts, and network status. The repository contains a Vite/React dashboard, a FastAPI service backed by SQLAlchemy and Supabase PostgreSQL, and a streaming anomaly-detection implementation that processes temperature, pressure, and relative-humidity observations.

The main goal is to turn station observations into explainable verdicts and operational station state, then present that information through a map and station-monitoring dashboard.

## System Overview

```text
Station telemetry / CSV replay
            |
            v
       FastAPI backend
            |
            v
 Streaming anomaly detector
            |
            v
 Verdicts, alerts, and station state
            |
            v
 Supabase PostgreSQL <----> React dashboard
```

At runtime, the backend accepts an observation through `/ingest` or `/readings/verdict`. The streaming detector keeps constant-size state per station and returns a verdict containing a flag, reason, severity, confidence, degradation, and evidence. The backend persists readings, verdicts, alerts, and updated station summaries. The React application requests those summaries and related station data and renders the dashboard, network map, station detail, pressure heartbeat, and alerts views.

The CSV replay tool imports station metadata and replays chronological observations through the same streaming detector and persistence services. Replay is explicit; it is not run automatically when the API starts.

## Key Features

### Currently implemented

- Vite/React single-page dashboard with routes for dashboard, network, stations, station detail, pressure heartbeat, and alerts.
- OpenStreetMap tiles rendered with Leaflet and React Leaflet.
- Station markers based on backend coordinates and backend status values.
- Network map modes for health, temperature, pressure, and reporting data.
- Station summary data, latest compact telemetry, time series, verdicts, and alert evidence.
- FastAPI endpoints for health, stations, readings, ingestion, alerts, verdicts, and work orders.
- SQLAlchemy persistence with Supabase PostgreSQL configured through `DATABASE_URL`.
- Streaming anomaly detection with per-station in-memory state.
- CSV station import and chronological replay from `data/`.
- Optional Supabase Auth integration for the React login and sign-up screens.
- Focused backend tests for the adapter, station state updates, API contract, and CSV replay.

### Planned or future work

- A formal database migration workflow; the backend currently initializes missing tables through SQLAlchemy metadata and does not use Alembic.
- Production deployment configuration and operational observability are not included in this repository.
- The frontend currently has no application-level API authentication flow; Supabase Auth is optional and configured independently of the FastAPI API calls.

## Architecture

### Frontend

`frontend/` contains the primary application. React pages consume the shared API client in `frontend/src/services/api.js`. `useSahasrakshaData.js` loads network health, stations, alerts, selected-station time series, and selected-station verdicts. Components such as `MapPanel`, `StationCard`, `AlertCard`, and `TelemetryCard` present the returned data.

The frontend does not calculate station health or anomaly status. It displays backend-provided health, degradation, status, telemetry, data quality, and timestamps.

### Backend

`backend/app/` contains the FastAPI application, Pydantic schemas, SQLAlchemy models, routers, and services. Routers validate HTTP input and delegate persistence and business logic to services. The station service converts database station rows into the public station-summary contract.

### Database

The backend uses SQLAlchemy with PostgreSQL as the normal configured database. In the project deployment setup this is Supabase PostgreSQL. A SQLite fallback exists only when `SKYGUARD_ALLOW_SQLITE=true` is explicitly enabled for local-only development.

### ML and anomaly detection

`ml/skyguard/stream.py` provides the online detector used by the backend adapter. `backend/app/services/anomaly_detector.py` creates one streaming detector state per station, maps the detector result into the API verdict schema, and preserves evidence pairs such as spatial, CUSUM, and tide signals. The `MockAnomalyDetector` remains available for tests or fallback scenarios, but the normal adapter is the streaming implementation.

### Data replay

`backend/app/tools/csv_replay.py` invokes `backend/app/services/csv_replay_service.py`. The service reads station coordinates from `data/skyguard_station_coords.csv`, reads observations from `data/skyguard_big_export.csv`, checks chronological order per station, skips configured low-confidence stations, evaluates usable rows, and persists the latest replay verdict for each station.

## Repository Structure

```text
Sahasraksha/
├── backend/
│   ├── app/
│   │   ├── db/              SQLAlchemy database setup and models
│   │   ├── routers/         FastAPI route modules
│   │   ├── schemas/         Pydantic request and response schemas
│   │   ├── services/        API, persistence, detector, and replay logic
│   │   └── tools/           Explicit command-line tools
│   ├── tests/               Backend unittest modules
│   ├── requirements.txt
│   └── README.md
├── data/                    Station coordinates and telemetry CSV files
├── frontend/
│   ├── src/
│   │   ├── auth/            React authentication context
│   │   ├── components/      Shared React UI components
│   │   ├── pages/            React route views
│   │   └── services/        API, data-loading, and Supabase clients
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
├── ml/
│   ├── skyguard/            Batch, streaming, validation, and analysis modules
│   ├── notebooks/           Research and reproducibility notebook
│   ├── docs/                ML/API contract documentation
│   └── requirements.txt
├── assets/                  Assets for the legacy static frontend
├── css/                     Stylesheets for the legacy static frontend
├── js/                      Scripts for the legacy static frontend
├── pages/                   HTML pages for the legacy static frontend
├── Header.html              Shared legacy frontend header
├── index.html               Legacy static frontend entry page
└── README.md
```

The root-level HTML/CSS/JavaScript application predates the Vite/React application. The supported development path for the current application is `frontend/`.

## Prerequisites

The repository does not pin exact Python or Node.js versions in a version manager file. Use a currently supported Python 3 release and a Node.js release compatible with Vite 7 and React 19, together with npm.

For the backend, access to the configured PostgreSQL database is required for the normal setup. A local SQLite database is available only through the explicit opt-in described below.

## Installation

Clone the repository and enter it:

```powershell
git clone <repository-url>
cd Sahasraksha
```

Set up the backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set a real `DATABASE_URL`. Do not commit that file.

Set up the React frontend in a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
```

Set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `frontend/.env.local`. Supabase Auth variables are optional for development, but they are required if the login and sign-up screens are expected to authenticate users.

## Running the Backend

From `backend/`, with the virtual environment active:

```powershell
uvicorn app.main:app --reload
```

The API listens at `http://127.0.0.1:8000`. FastAPI's interactive documentation is available at `http://127.0.0.1:8000/docs`, and the OpenAPI schema is available at `http://127.0.0.1:8000/openapi.json`.

Verify the service with:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

On startup, the backend creates missing ORM tables. It does not automatically seed demo data unless `SKYGUARD_SEED_DEMO_DATA=true` is set.

## Running the Frontend

From `frontend/`:

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`. The development script binds Vite to `127.0.0.1`.

The default API base URL is `http://127.0.0.1:8000`. Override it with `VITE_API_BASE_URL` in `frontend/.env.local` when the backend runs elsewhere.

The production build can be checked with:

```powershell
npm run build
```

## Frontend and Backend Communication

The shared frontend client is `frontend/src/services/api.js`. It uses `VITE_API_BASE_URL`, defaulting to `http://127.0.0.1:8000`, and sends JSON requests to FastAPI. The data hook loads network-wide data once and loads time series and verdicts for the selected station.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Backend and network summary |
| GET | `/stations` | Station summaries, status, coordinates, and latest compact telemetry |
| GET | `/stations/{station_id}` | One station summary |
| GET | `/stations/{station_id}/timeseries` | Persisted station telemetry, optionally filtered with `from` and `to` |
| GET | `/stations/{station_id}/alerts` | Alerts and evidence for one station |
| GET | `/stations/{station_id}/verdicts` | Persisted verdicts for one station |
| POST | `/ingest` | Evaluate one observation and persist the result for a known station |

The backend also exposes global alert, verdict, reading, and work-order routes described by the generated FastAPI documentation.

## Backend API

### `GET /health`

Returns `status`, `station_count`, `open_alert_count`, and `active_work_order_count`.

### `GET /stations`

Returns an array of station summaries. Each summary includes `station_id`, `name`, `lat`, `lon`, `health`, `status`, `degradation`, `trend_per_day`, `days_to_threshold`, alert metrics, `last_seen`, `data_quality`, and `latest_temperature`, `latest_pressure`, and `latest_humidity`. Missing health or telemetry values are represented as `null` where the schema permits it. `status` is one of `SERVICE NOW`, `SCHEDULE`, `MONITOR`, or `OK`.

### `GET /stations/{station_id}/timeseries`

Returns persisted rows containing `timestamp`, `T`, `P`, `RH`, `flag`, and `amp_ratio_P`. Optional ISO datetime query parameters are `from` and `to`.

### `GET /stations/{station_id}/alerts`

Returns alert records with severity, message, status, confidence, degradation, evidence, and timestamps.

### `POST /ingest`

Accepts a JSON weather reading:

```json
{
  "station_id": "AWS_PNQ",
  "timestamp": "2024-05-14T15:00:00Z",
  "T": 34.2,
  "P": 948.1,
  "RH": 62.0,
  "flag": 0,
  "amp_ratio_P": 0.97
}
```

The response is a verdict with `flag`, `reason`, `severity`, `confidence`, `degradation`, and an evidence-pair list. A known station's reading, verdict, alert when flagged, and station summary state are persisted. Unknown station observations still receive a detector verdict but are not attached to a station row.

For exact request and response validation, use `/docs` or inspect `backend/app/schemas/`.

## Database

The normal database is PostgreSQL configured through `backend/.env` using `DATABASE_URL`. The ORM models are in `backend/app/db/models.py`.

The main entities are:

- `stations`: station identity, coordinates, current health/status, degradation, and summary metrics.
- `weather_readings`: timestamped T/P/RH observations and related sensor fields.
- `anomaly_verdicts`: detector results, confidence, degradation, evidence, and reading linkage.
- `alerts`: flagged verdicts and their open/resolved state.
- `work_orders`: operational actions linked to alerts.

Station identifiers are string primary keys. Reading, verdict, alert, and work-order records reference stations through foreign keys. The backend defines indexes on primary keys and the principal foreign-key columns. The current table setup is created through SQLAlchemy metadata; schema migrations are not yet part of the repository.

The API queries station summaries and latest readings in a compact form, while time-series endpoints return all matching rows unless callers provide date filters. For large historical datasets, use date filters and ensure the database deployment has appropriate operational indexes and capacity.

## ML and Anomaly Detection

The online detector consumes `T`, `P`, and `RH` observations one at a time. Its state is held in memory per station, so separate stations do not share streaming statistics. The backend adapter converts raw detector output into the stable verdict contract and normalizes evidence keys for the API.

The detector includes physics/range checks, step and frozen-value checks, residual and spatial evidence, pressure tide behavior, and CUSUM-style drift state. The batch/research modules and notebook are maintained separately from the request-time adapter.

The in-memory stream state is lost when the FastAPI process restarts. Persisted station summaries, readings, verdicts, and alerts remain in PostgreSQL, but reconstructing detector history requires replaying suitable historical observations.

## CSV Replay

Run replay explicitly from the `backend/` directory after configuring the database:

```powershell
python -m app.tools.csv_replay
```

Useful options:

```powershell
python -m app.tools.csv_replay --stations-only
python -m app.tools.csv_replay --max-observations 1000
python -m app.tools.csv_replay --coords ..\data\skyguard_station_coords.csv --observations ..\data\skyguard_big_export.csv
```

The default inputs are `data/skyguard_station_coords.csv` and `data/skyguard_big_export.csv`. Replay expects observations to be chronological for each station. Coordinate metadata identifies low-confidence stations; those stations remain importable but are skipped for meaningful scoring.

## Environment Variables and Configuration

### Backend: `backend/.env`

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes for normal operation | PostgreSQL connection string, normally the Supabase database |
| `SKYGUARD_ALLOW_SQLITE` | No | Explicitly enables the local SQLite fallback when set to `true`, `1`, or `yes` |
| `SKYGUARD_SEED_DEMO_DATA` | No | Explicitly enables demo seed data when set to `true`, `1`, or `yes` |

Use `backend/.env.example` as the safe template. Never place passwords or service credentials in source files.

### Frontend: `frontend/.env.local`

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | No | FastAPI base URL; defaults to `http://127.0.0.1:8000` |
| `VITE_SUPABASE_URL` | For Supabase Auth | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | For Supabase Auth | Public Supabase anonymous key |

The frontend Supabase client is used for authentication only. The database remains accessed by the backend.

## Development Workflow

1. Pull the latest changes.
2. Create a feature branch.
3. Make a focused change in the appropriate component.
4. Run `python -m unittest discover backend\tests` for backend changes.
5. Run `npm run build` from `frontend/` for frontend changes.
6. Start both services and verify the affected workflow against the local API.
7. Review the diff and run `git diff --check`.
8. Commit the change and open a pull request according to the team workflow.

## Git and Repository Rules

Do not commit:

- `backend/.env` or `frontend/.env.local`.
- `backend/.venv/` or `node_modules/`.
- Frontend `dist/` and `.vite/` output.
- Python caches and compiled files.
- The local `backend/skyguard.db` fallback database.
- Local editor or operating-system files.

The root `.gitignore` and `frontend/.gitignore` are the repository's ignore files. Confirm repository tracking status before adding new datasets.

## Troubleshooting

### Backend will not start

Confirm the virtual environment is active, dependencies are installed, and `backend/.env` contains a valid `DATABASE_URL`. If PostgreSQL is intentionally unavailable for local-only work, enable `SKYGUARD_ALLOW_SQLITE=true`; do not use that fallback for shared data.

### Frontend cannot reach the API

Check that FastAPI is running on port 8000 and that `frontend/.env.local` points `VITE_API_BASE_URL` to the same origin. Restart Vite after changing environment variables.

### Authentication screens report missing configuration

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `frontend/.env.local`. Without them, the UI can render the authentication screens but cannot perform Supabase Auth operations.

### Port already in use

Stop the process using the port or start the relevant service with a different port. If the frontend API base URL changes, update `VITE_API_BASE_URL` accordingly.

### CORS errors

The current FastAPI application enables broad development CORS for browser access. If deployment hardens this configuration, add the frontend origin explicitly and keep the frontend API base URL aligned with the deployed backend.

### CSV replay fails

Run it from `backend/` with the backend virtual environment active. Check that both CSV paths exist, that station identifiers match, that timestamps are chronological per station, and that the configured database is reachable.

## Current Project Status

### Completed

- React dashboard and station-monitoring screens.
- FastAPI API and SQLAlchemy persistence layer.
- Supabase PostgreSQL configuration path.
- Streaming detector adapter and per-station state.
- CSV station import and replay tooling.
- Backend contract, adapter, station-state, and replay tests.
- Network map telemetry modes and backend-provided station summaries.

### In progress

- The repository still contains the older static frontend alongside the current React application, so documentation and maintenance should continue to distinguish the two.
- Database schema migrations, deployment automation, and production operations are not yet represented by repository tooling.

### Planned

- A formal migration process and production deployment configuration.
- Broader operational testing around process restart, malformed ingestion, high-volume replay, and database failure handling.

## Team Responsibilities

- Frontend work belongs primarily in `frontend/src/`: presentation, route views, API consumption, loading/error states, and authentication UI.
- Backend work belongs primarily in `backend/app/`: request validation, API routes, persistence, station state, alert behavior, and replay orchestration.
- ML work belongs primarily in `ml/skyguard/`: detector algorithms, streaming state, feature logic, validation, and reproducibility materials. The backend adapter is the boundary between the detector and API contracts.

Changes that cross these boundaries should include contract-focused tests and an explanation of any changed request or response shape.

## Contributing

Use a feature branch and keep changes scoped to one concern. Update the relevant tests and documentation with behavior changes. Before opening a pull request, run the backend test command, the frontend production build, and `git diff --check`. Never include secrets, local databases, virtual environments, dependency directories, or generated build output.

## License

No license has currently been specified in the repository.

## Final Notes

Keep this README current whenever API endpoints, setup commands, dependencies, environment variables, architecture, or major features change. Documentation is part of the integration contract for the team.
