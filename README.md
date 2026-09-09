SkyGuard AI 🌦️

AI-Powered Weather Station Monitoring & Anomaly Detection System

SkyGuard AI is a weather-station monitoring platform designed to detect abnormal sensor behavior, monitor station health, identify potential degradation, and provide operators with a centralized dashboard for viewing weather data and alerts.

The system connects three major layers:

┌─────────────────────┐
│   Weather Stations  │
│  Sensor Readings    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│     Web Backend     │
│      FastAPI        │
│                     │
│  • REST APIs        │
│  • Database         │
│  • Station data     │
│  • Readings         │
│  • Alerts           │
│  • ML integration   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    ML / Anomaly     │
│     Detection       │
│                     │
│  Detect abnormal    │
│  sensor behavior    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      Frontend       │
│   Web Dashboard     │
│                     │
│  • Station map      │
│  • Station health   │
│  • Alerts           │
│  • History          │
│  • Live data        │
│  • Work orders      │
└─────────────────────┘

---

📌 Table of Contents

- "Project Overview" (#-project-overview)
- "Main Features" (#-main-features)
- "System Architecture" (#-system-architecture)
- "Repository Structure" (#-repository-structure)
- "Technology Stack" (#-technology-stack)
- "Prerequisites" (#-prerequisites)
- "Getting Started" (#-getting-started)
- "Running the Backend" (#-running-the-backend)
- "Running the Frontend" (#-running-the-frontend)
- "Backend API" (#-backend-api)
- "Database" (#-database)
- "Anomaly Detection" (#-anomaly-detection)
- "How the System Works" (#-how-the-system-works)
- "Development Workflow" (#-development-workflow)
- "Current Status" (#-current-status)
- "Future Work" (#-future-work)
- "Troubleshooting" (#-troubleshooting)
- "Contributing" (#-contributing)

---

🌦️ Project Overview

Weather stations continuously collect environmental measurements such as:

- Temperature
- Humidity
- Atmospheric pressure
- Wind speed
- Wind direction
- Rainfall
- Solar radiation

A healthy weather station should produce readings that are consistent with expected environmental behavior.

However, sensors can experience problems such as:

- Abnormal readings
- Sensor degradation
- Sudden changes
- Communication issues
- Repeated anomalous measurements
- Potential hardware failure

SkyGuard AI is designed to help operators identify these problems early.

The system collects station readings, stores them, analyzes them using an anomaly-detection system, generates alerts when required, and exposes the information through APIs for the frontend dashboard.

---

✨ Main Features

Station Monitoring

The system maintains information about individual weather stations, including:

- Station ID
- Health
- Status
- Degradation
- Estimated days to threshold
- Alert rate
- Last-seen timestamp

Stations can be monitored individually or collectively through the dashboard.

Weather Readings

The backend stores weather readings received from stations.

A reading can contain:

- Temperature
- Humidity
- Pressure
- Wind speed
- Wind direction
- Rainfall
- Solar radiation
- Timestamp
- Station ID

Anomaly Detection

Each weather reading can be passed through an anomaly-detection service.

The detector produces a verdict containing information such as:

- Whether the reading is anomalous
- Reason for the anomaly
- Severity
- Confidence
- Supporting evidence

The architecture separates the anomaly detector from the rest of the application so that the temporary detector can later be replaced by the actual ML model.

Alerts

When an anomalous reading is detected, the backend can create an alert associated with the relevant station and reading.

Alerts can contain:

- Station
- Severity
- Reason
- Message
- Creation time
- Status
- Resolution information

Dashboard

The frontend is intended to provide an operator-facing dashboard for:

- Monitoring stations
- Viewing station health
- Viewing weather data
- Viewing anomalies
- Viewing alerts
- Exploring historical data
- Monitoring live information
- Managing maintenance/work-order information

---

🏗️ System Architecture

SkyGuard AI follows a layered architecture.

                     Weather Station
                           │
                           │ Sensor Data
                           ▼
                    ┌───────────────┐
                    │    Backend    │
                    │    FastAPI    │
                    └───────┬───────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
                 ▼                     ▼
          ┌─────────────┐      ┌───────────────┐
          │  Database   │      │ ML Detector   │
          │   SQLite    │      │               │
          └─────────────┘      └───────┬───────┘
                                       │
                                       │ Verdict
                                       ▼
                                ┌─────────────┐
                                │   Alerts    │
                                └──────┬──────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │    Frontend     │
                              │    Dashboard    │
                              └─────────────────┘

Responsibility of each layer

Frontend

The frontend is responsible for the user interface.

It should:

- Display station information
- Display readings
- Display anomaly results
- Display alerts
- Display historical information
- Provide operator interactions

The frontend should communicate with the backend through APIs rather than accessing the database directly.

Backend

The backend is responsible for application logic and data access.

It currently provides:

- FastAPI application
- REST endpoints
- Station management
- Weather-reading management
- Database access
- Anomaly-detector interface
- Verdict persistence
- Alert generation

Database

The database stores application data.

The development implementation currently uses:

SQLite + SQLAlchemy

The database stores information such as:

- Stations
- Weather readings
- Anomaly verdicts
- Alerts

ML Layer

The anomaly-detection component analyzes weather readings and determines whether they are anomalous.

The backend is intentionally designed so that the actual ML implementation can be integrated later without requiring major changes to the frontend API.

---

📁 Repository Structure

The repository is organized into two primary application directories:

skyguard_ai/
│
├── backend/
│
├── frontend/
│
└── .gitignore

Backend Structure

The backend currently follows a layered FastAPI structure similar to:

backend/
│
├── README.md
├── requirements.txt
├── skyguard.db
│
└── app/
    │
    ├── __init__.py
    ├── main.py
    │
    ├── db/
    │   ├── __init__.py
    │   ├── database.py
    │   └── models.py
    │
    ├── routers/
    │   ├── __init__.py
    │   ├── stations.py
    │   └── readings.py
    │
    ├── schemas/
    │   ├── __init__.py
    │   ├── station.py
    │   ├── reading.py
    │   └── verdict.py
    │
    └── services/
        ├── __init__.py
        ├── station_service.py
        ├── reading_service.py
        └── anomaly_detector.py

«The exact frontend structure depends on the frontend implementation used by the team.»

---

🛠️ Technology Stack

Backend

- Python
- FastAPI
- Uvicorn
- SQLAlchemy
- SQLite
- Pydantic

Frontend

The frontend is maintained separately from the backend and communicates with the backend API.

Machine Learning

The anomaly-detection component is designed to be integrated with the backend through a dedicated detector/service interface.

---

📋 Prerequisites

Before running SkyGuard AI, install:

- Python 3.10+ recommended
- Node.js and npm for the frontend
- Git

Check installations:

python --version
node --version
npm --version
git --version

---

🚀 Getting Started

Clone the repository:

git clone <REPOSITORY_URL>
cd skyguard_ai

The project contains separate frontend and backend applications.

You normally run them independently.

---

🔧 Running the Backend

Navigate to the backend:

cd backend

1. Create a virtual environment

Windows

python -m venv .venv
.venv\Scripts\activate

macOS / Linux

python3 -m venv .venv
source .venv/bin/activate

2. Install dependencies

pip install -r requirements.txt

3. Start the API server

From the "backend" directory:

uvicorn app.main:app --reload

The API should then be available at:

http://127.0.0.1:8000

4. Check the backend

Open:

http://127.0.0.1:8000/health

A successful response should look similar to:

{
  "status": "running"
}

---

📖 Backend API Documentation

FastAPI automatically provides interactive API documentation.

After starting the backend, open:

http://127.0.0.1:8000/docs

This provides an interactive Swagger interface where developers can:

- View available endpoints
- Inspect request/response schemas
- Send test requests
- Test the API without the frontend

Alternative documentation:

http://127.0.0.1:8000/redoc

---

🔌 Backend API

The current backend provides endpoints for stations, readings, and anomaly verdicts.

Health

"GET /health"

Checks whether the backend is running.

Example:

curl http://127.0.0.1:8000/health

---

Stations

"GET /stations"

Returns available weather stations.

"GET /stations/{station_id}"

Returns information about a specific station.

Example:

GET /stations/ST001

---

Weather Readings

"GET /stations/{station_id}/readings"

Returns readings belonging to a station.

Example:

GET /stations/ST001/readings

"POST /readings"

Adds a weather reading to the database.

The reading should identify the station and contain the available sensor measurements.

---

🤖 Anomaly Verdict API

"POST /readings/verdict"

Runs a weather reading through the configured anomaly detector.

The result contains information such as:

{
  "flag": true,
  "reason": "Anomalous reading detected",
  "severity": "medium",
  "confidence": 0.7,
  "evidence": {
    "detector": "temporary_mock_detector"
  }
}

The exact response depends on the configured detector.

---

🗄️ Database

The current development database is:

SQLite

The database file is located inside the backend:

backend/skyguard.db

SQLAlchemy is used as the database abstraction layer.

The backend currently contains models for:

- Stations
- Weather readings
- Anomaly verdicts
- Alerts

The database is initialized when the FastAPI application starts.

For development, demo station/readings data may be seeded when the database is empty.

---

🧠 Anomaly Detection Architecture

The anomaly-detection system is intentionally isolated from the API layer.

Conceptually:

Weather Reading
      │
      ▼
AnomalyDetector
      │
      ▼
AnomalyVerdict
      │
      ├── Normal
      │
      └── Anomalous
              │
              ▼
            Alert

The backend currently contains a temporary mock detector.

This mock detector is only intended to allow the backend to be developed and tested before the real ML model is available.

It is not the final anomaly-detection algorithm.

When the actual ML model becomes available, the integration should replace the detector implementation while preserving the backend API contract as much as possible.

---

🖥️ Running the Frontend

The frontend should be run separately from the backend.

Navigate to the frontend directory:

cd frontend

Install frontend dependencies:

npm install

Then start the development server using the project's configured development script:

npm run dev

If the frontend project uses a different script, check:

frontend/package.json

for the available scripts.

The frontend should then display the SkyGuard dashboard.

---

🔗 Frontend ↔ Backend Communication

The frontend should communicate with the backend through HTTP API requests.

The general flow is:

Frontend
   │
   │ HTTP Request
   ▼
FastAPI Backend
   │
   ├── Service Layer
   │
   ├── Database
   │
   └── ML Detector
   │
   ▼
JSON Response
   │
   ▼
Frontend

The frontend should not communicate directly with:

- SQLite
- SQLAlchemy
- Backend service classes
- ML model files

Instead, it should use the backend's API endpoints.

---

🔄 How the System Works

A typical weather-reading workflow is:

Step 1 — Station produces data

A weather station produces sensor measurements.

Temperature
Humidity
Pressure
Wind
Rainfall
Solar Radiation

Step 2 — Backend receives the reading

The reading is sent to:

POST /readings

The backend validates and stores the reading.

Step 3 — Anomaly analysis

The reading can be sent through:

POST /readings/verdict

The anomaly detector analyzes the reading.

Step 4 — Verdict is generated

The detector returns:

Flag
Reason
Severity
Confidence
Evidence

Step 5 — Alert generation

If the verdict identifies an anomaly, the backend can create an alert.

Step 6 — Frontend displays the result

The frontend retrieves the relevant information from the backend and presents it to the operator.

---

👨‍💻 Development Workflow

When working on SkyGuard AI, developers should generally follow this process:

1. Pull latest changes
        ↓
2. Create/update your feature
        ↓
3. Run backend/frontend locally
        ↓
4. Test your changes
        ↓
5. Check API integration
        ↓
6. Commit changes
        ↓
7. Push to Git

Before pushing changes:

git status

Review the files being committed and make sure temporary files, virtual environments, caches, and secrets are not included.

---

🧪 Testing the Backend Manually

The easiest way to test the backend during development is through FastAPI's Swagger interface:

http://127.0.0.1:8000/docs

Recommended basic checks:

1. Health

GET /health

2. Stations

GET /stations

3. Individual station

GET /stations/{station_id}

4. Station readings

GET /stations/{station_id}/readings

5. Add reading

POST /readings

6. Generate anomaly verdict

POST /readings/verdict

---

⚠️ Current Development Limitations

This project is still under active development.

Some parts are currently temporary or incomplete.

Backend

The backend currently uses SQLite for development.

For a production deployment, the database architecture may need to be changed depending on deployment requirements.

ML Model

The current anomaly detector is a temporary mock implementation until the actual validated ML model is available for integration.

Frontend Integration

The frontend and backend API contracts may continue to evolve as the dashboard is connected to real backend data.

Live Data

Real-time/live-stream functionality may require additional infrastructure such as WebSockets or another streaming mechanism.

Authentication

Authentication and authorization are not currently part of the basic development setup.

---

🗺️ Current Project Status

Component| Status
Project structure| ✅ Implemented
Backend foundation| ✅ Implemented
FastAPI server| ✅ Implemented
Station API| ✅ Implemented
Weather readings API| ✅ Implemented
SQLite database| ✅ Implemented
SQLAlchemy models| ✅ Implemented
Mock anomaly detector| ✅ Implemented
ML architecture/interface| ✅ Prepared
Real ML model integration| ⏳ Pending model
Alert persistence/API| 🔄 In development
Historical dashboard| 🔄 In development
Live data| 🔄 In development
Work-order system| 🔄 In development
Production deployment| ⏳ Future

---

🔮 Future Work

The intended development direction includes:

1. Complete persistent anomaly verdicts and alerts.
2. Connect the actual ML/anomaly-detection model.
3. Finalize the frontend ↔ backend API contract.
4. Add historical data APIs.
5. Add complete alert-management functionality.
6. Add maintenance/work-order functionality.
7. Add live data/WebSocket support where required.
8. Add automated backend tests.
9. Add authentication and authorization if required.
10. Prepare the application for production deployment.

---

🐛 Troubleshooting

Backend does not start

Make sure the virtual environment is activated:

Windows

.venv\Scripts\activate

Then reinstall dependencies:

pip install -r requirements.txt

Start the server again:

uvicorn app.main:app --reload

---

"uvicorn" is not recognized

Activate the virtual environment or run:

python -m uvicorn app.main:app --reload

---

Frontend cannot connect to backend

Make sure the backend is running first:

http://127.0.0.1:8000

Then check the frontend's configured API/base URL.

Also verify that the requested backend endpoint exists in:

http://127.0.0.1:8000/docs

---

Database problems

For local development, the SQLite database is:

backend/skyguard.db

If the database becomes corrupted during development, stop the backend before replacing or recreating the local database.

Do not delete the database in a production environment without first understanding the consequences for stored data.

---

🤝 Contributing

When contributing to SkyGuard AI:

1. Understand which layer your change belongs to.
2. Keep frontend and backend responsibilities separated.
3. Do not access the database directly from the frontend.
4. Keep ML-specific logic inside the ML/detector layer.
5. Avoid putting business logic directly into API route handlers when it belongs in a service.
6. Test changes locally before pushing.
7. Do not commit secrets, credentials, virtual environments, caches, or unnecessary generated files.
8. Keep API request and response formats documented when they change.

---

📄 Project Structure at a Glance

skyguard_ai/
│
├── backend/
│   │
│   ├── app/
│   │   ├── db/
│   │   ├── routers/
│   │   ├── schemas/
│   │   └── services/
│   │
│   ├── requirements.txt
│   ├── README.md
│   └── skyguard.db
│
├── frontend/
│   └── ...
│
└── .gitignore

---

🎯 Project Goal

SkyGuard AI aims to provide a single platform for monitoring weather stations and identifying potential sensor problems before they become larger operational issues.

The long-term system brings together:

Weather Data → Backend → ML Analysis → Alerts → Dashboard → Operator Action

The backend acts as the bridge between raw weather-station data, the anomaly-detection system, persistent application data, and the frontend dashboard.

---

👥 Team Development

SkyGuard AI is developed as a collaborative project with separate responsibilities across:

- Frontend development
- Backend/API development
- Machine-learning/anomaly-detection development
- Integration and testing

Changes should be made within the appropriate project layer while maintaining a clear API boundary between the frontend, backend, and ML components.

---

SkyGuard AI — Monitor smarter. Detect earlier. Maintain reliably.```

Then visit `http://localhost:8000`.
# SkyGuard AI Frontend

SkyGuard AI is an intelligent weather station monitoring dashboard.

## Features

- Dashboard monitoring
- Weather station management
- Network monitoring
- Sensor diagnostics
- AI anomaly alerts
- Maintenance management
- Live sensor simulation
- Temperature charts
- Responsive UI

## Technologies

- HTML5
- CSS3
- JavaScript
- Chart.js

## Project Structure

SkyGuard-AI-Frontend/

- index.html
- pages/
- css/
- js/
- assets/

## How to Run

1. Open the project in VS Code.
2. Install Live Server.
3. Right-click index.html.
4. Select "Open with Live Server".
5. Login using any username and password.

## Future Backend

The frontend can be connected to a Flask backend.

The backend can provide:

- Sensor data
- Station status
- AI anomaly scores
- Alerts
- Diagnostics
- Maintenance information
