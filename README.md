<div align="center">🌦️ SkyGuard AI

Intelligent Weather Station Monitoring & Anomaly Detection

Turning environmental telemetry into actionable operational intelligence.

<br/>""Python" (https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)" (https://www.python.org/)
""FastAPI" (https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)" (https://fastapi.tiangolo.com/)
""React" (https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)" (https://react.dev/)
""SQLAlchemy" (https://img.shields.io/badge/SQLAlchemy-D71F00?style=for-the-badge&logo=sqlalchemy&logoColor=white)" (https://www.sqlalchemy.org/)
""SQLite" (https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)" (https://www.sqlite.org/)
""AI/ML" (https://img.shields.io/badge/AI%2FML-Anomaly%20Detection-B784F7?style=for-the-badge)" (#-intelligence-engine)

<br/>" Overview " (#-overview) •
" Architecture " (#-architecture) •
" Features " (#-core-capabilities) •
" AI Engine " (#-intelligence-engine) •
" API " (#-api) •
" Setup " (#-getting-started)

</div>---

✦ Overview

SkyGuard AI is a full-stack environmental monitoring platform designed to collect, analyze, and operationalize weather-station telemetry.

Instead of presenting sensor measurements as isolated numbers, SkyGuard AI creates a unified monitoring layer where station health, environmental telemetry, anomaly detection, and operational alerts work together.

The platform is built around a modular architecture that separates the frontend, backend, data layer, and AI inference layer, allowing each component to evolve independently.

The core idea

   ENVIRONMENTAL TELEMETRY
             │
             ▼
   ┌─────────────────────┐
   │    DATA INGESTION   │
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────┐
   │   WEATHER ANALYSIS  │
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────┐
   │   AI ANOMALY ENGINE  │
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────┐
   │ VERDICT + CONFIDENCE│
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────┐
   │   ALERT / INSIGHT   │
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────┐
   │ OPERATOR DASHBOARD  │
   └─────────────────────┘

---

✦ Why SkyGuard?

Weather infrastructure generates continuous streams of environmental data.

The challenge isn't simply collecting the data.

The challenge is understanding:

«Is the station behaving normally?»

«Is a reading actually abnormal?»

«How severe is the anomaly?»

«How confident is the detection?»

«Does an operator need to intervene?»

SkyGuard AI is designed to answer these questions through a combination of structured telemetry, station-health monitoring, machine-learning inference, and alert management.

---

✦ Core Capabilities

<table>
<tr>
<td width="50%">🛰️ Station Intelligence

Monitor the operational state of weather stations through:

- Station health
- Operational status
- Degradation indicators
- Days-to-threshold
- Alert rate
- Last-seen information

</td>
<td width="50%">🌡️ Environmental Telemetry

Capture multi-dimensional weather readings including:

- Temperature
- Humidity
- Atmospheric pressure
- Wind speed
- Wind direction
- Rainfall
- Solar radiation
- Timestamped observations

</td>
</tr><tr>
<td width="50%">🧠 AI Anomaly Detection

Analyze weather readings through a dedicated anomaly-detection layer capable of producing:

- Anomaly classification
- Severity
- Confidence
- Reasoning
- Supporting evidence

</td>
<td width="50%">🚨 Operational Alerts

Convert anomalous observations into actionable events associated with:

- Source station
- Source reading
- Detection verdict
- Severity
- Operational context

</td>
</tr>
</table>---

✦ Architecture

SkyGuard AI follows a layered architecture designed around separation of concerns and independent component evolution.

                         ┌───────────────────────┐
                         │   WEATHER STATIONS    │
                         │                       │
                         │  Environmental Data   │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │      FASTAPI API      │
                         │                       │
                         │  Validation           │
                         │  Routing              │
                         │  Business Logic       │
                         └───────────┬───────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
                   ▼                 ▼                 ▼
          ┌────────────────┐ ┌────────────────┐ ┌───────────────┐
          │   DATA LAYER   │ │   AI ENGINE    │ │ ALERT ENGINE  │
          │                │ │                │ │               │
          │ SQLAlchemy ORM │ │ Anomaly Model  │ │ Alert Logic   │
          │ SQLite         │ │ Verdict Engine │ │ Event State   │
          └───────┬────────┘ └───────┬────────┘ └───────┬───────┘
                  │                  │                  │
                  └──────────────────┼──────────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   OPERATOR DASHBOARD  │
                         │                       │
                         │ Stations              │
                         │ Weather               │
                         │ Anomalies             │
                         │ Alerts                │
                         └───────────────────────┘

Architectural philosophy

Frontend

Responsible for visualization, interaction, monitoring workflows, and operator experience.

Backend

Acts as the central application layer connecting the dashboard, database, and AI services.

Database

Provides persistent storage for stations, readings, anomaly verdicts, and alerts.

AI Layer

Encapsulates anomaly-detection logic behind a service interface, allowing the underlying model to evolve independently.

---

✦ Intelligence Engine

The AI layer is intentionally isolated from the application core.

This means the backend doesn't need to know whether anomaly detection is powered by a statistical method, classical machine learning, deep learning, or a hybrid approach.

                  WEATHER READING
                         │
                         ▼
                ┌─────────────────┐
                │ Feature / Signal│
                │     Analysis    │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │    ANOMALY      │
                │    DETECTOR     │
                └────────┬────────┘
                         │
                         ▼
             ┌────────────────────────┐
             │     ANOMALY VERDICT    │
             │                        │
             │  Flag                  │
             │  Severity              │
             │  Confidence            │
             │  Reason                │
             │  Evidence              │
             └────────────┬───────────┘
                          │
                    ┌─────┴─────┐
                    │           │
                  NORMAL      ANOMALY
                                │
                                ▼
                         ┌─────────────┐
                         │    ALERT    │
                         └─────────────┘

Verdict structure

Signal| Purpose
Anomaly Flag| Determines whether the observation is abnormal
Severity| Indicates operational impact
Confidence| Represents model certainty
Reason| Explains why the observation was flagged
Evidence| Provides supporting signals for the verdict

The current development environment includes a mock detector for API integration and system testing.

The production architecture is intentionally prepared for replacing it with the validated anomaly-detection model without restructuring the application.

---

✦ Multivariate Weather Intelligence

Weather behavior is inherently multi-dimensional.

A temperature reading that appears unusual in isolation may be completely normal when considered alongside humidity, pressure, wind, and solar radiation.

SkyGuard therefore treats telemetry as a structured environmental signal:

 Temperature ──────┐
 Humidity ─────────┤
 Pressure ─────────┤
 Wind Speed ───────┤
 Wind Direction ───┼──────► AI ENGINE
 Rainfall ─────────┤
 Solar Radiation ──┤
 Timestamp ────────┘

This architecture provides a foundation for future:

- Multivariate anomaly detection
- Historical baselines
- Time-series analysis
- Forecast deviation detection
- Sensor drift detection
- Station degradation prediction

---

✦ Dashboard

The SkyGuard dashboard is designed as the operational interface for the entire monitoring ecosystem.

Monitoring surfaces

┌───────────────────────────────────────────────────────┐
│                    SKYGUARD AI                        │
├───────────────────────────────────────────────────────┤
│                                                       │
│  STATION HEALTH        WEATHER TELEMETRY             │
│  ───────────────        ─────────────────             │
│  ● Operational         Temperature                   │
│  ● Monitoring          Humidity                      │
│  ● Degraded            Pressure                      │
│                         Wind                          │
│                                                       │
├───────────────────────────────────────────────────────┤
│                                                       │
│  AI INSIGHTS             ALERT CENTER                │
│  ───────────             ───────────                 │
│  Anomalies               Active Events               │
│  Confidence              Severity                    │
│  Evidence                Station                     │
│                                                       │
└───────────────────────────────────────────────────────┘

«Dashboard screenshots can be added here as the frontend reaches its finalized UI state.»

---

✦ API

SkyGuard exposes a RESTful API through FastAPI.

Health

GET /health

Stations

GET /stations
GET /stations/{station_id}

Weather readings

GET /stations/{station_id}/readings
POST /readings

Anomaly analysis

POST /readings/verdict

Alerts

GET /alerts
GET /stations/{station_id}/alerts

---

API Documentation

FastAPI provides interactive API documentation automatically.

Swagger UI

http://127.0.0.1:8000/docs

ReDoc

http://127.0.0.1:8000/redoc

The documentation provides interactive endpoint exploration, request schemas, response models, and API testing.

---

✦ Data Architecture

The current development environment uses SQLite + SQLAlchemy.

                     ┌──────────────┐
                     │   STATION    │
                     └──────┬───────┘
                            │
                 ┌──────────┼──────────┐
                 │          │          │
                 ▼          ▼          ▼
             READINGS    VERDICTS    ALERTS
                 │          │          │
                 └──────────┼──────────┘
                            ▼
                     OPERATIONAL DATA

Persistent entities

Entity| Purpose
"Station"| Weather station metadata and health
"Reading"| Environmental sensor observations
"Verdict"| AI anomaly-analysis results
"Alert"| Operational events generated from anomalies

---

✦ Technology Stack

<div align="center">Frontend

"React" (https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
"JavaScript" (https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
"TypeScript" (https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)

Backend

"Python" (https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
"FastAPI" (https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
"Pydantic" (https://img.shields.io/badge/Pydantic-E92063?style=flat-square)

Data

"SQLite" (https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
"SQLAlchemy" (https://img.shields.io/badge/SQLAlchemy-D71F00?style=flat-square&logo=sqlalchemy&logoColor=white)

AI / ML

"Machine Learning" (https://img.shields.io/badge/Machine%20Learning-Anomaly%20Detection-B784F7?style=flat-square)
"Python ML" (https://img.shields.io/badge/Python%20ML-3776AB?style=flat-square&logo=python&logoColor=white)

Development

"Git" (https://img.shields.io/badge/Git-F05032?style=flat-square&logo=git&logoColor=white)
"GitHub" (https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)
"REST API" (https://img.shields.io/badge/REST-API-FF6B35?style=flat-square)

</div>---

✦ Project Structure

skyguard_ai/
│
├── backend/
│   ├── app/
│   │   ├── db/
│   │   │   ├── database.py
│   │   │   └── models.py
│   │   │
│   │   ├── routers/
│   │   │   ├── stations.py
│   │   │   └── readings.py
│   │   │
│   │   ├── schemas/
│   │   │   ├── station.py
│   │   │   ├── reading.py
│   │   │   └── verdict.py
│   │   │
│   │   └── services/
│   │       ├── station_service.py
│   │       ├── reading_service.py
│   │       └── anomaly_detector.py
│   │
│   ├── requirements.txt
│   └── skyguard.db
│
├── frontend/
│   └── ...
│
├── docs/
│   └── screenshots/
│
├── .gitignore
└── README.md

---

✦ Getting Started

Prerequisites

- Python 3.10+
- Node.js
- npm
- Git

---

Backend

cd backend

Create a virtual environment:

Windows

python -m venv .venv
.venv\Scripts\activate

macOS / Linux

python3 -m venv .venv
source .venv/bin/activate

Install dependencies:

pip install -r requirements.txt

Start the development server:

uvicorn app.main:app --reload

Backend:

http://127.0.0.1:8000

Health check:

http://127.0.0.1:8000/health

---

Frontend

Open a second terminal:

cd frontend
npm install
npm run dev

The development server will provide the local frontend URL.

The frontend communicates with SkyGuard through the backend API and does not directly access the database.

---

✦ Development Lifecycle

     SENSOR DATA
          │
          ▼
    API INGESTION
          │
          ▼
     VALIDATION
          │
          ▼
      PERSISTENCE
          │
          ▼
    AI ANALYSIS
          │
          ▼
   ┌──────┴──────┐
   │             │
 NORMAL       ANOMALY
                 │
                 ▼
               ALERT
                 │
                 ▼
             DASHBOARD

The architecture keeps ingestion, persistence, inference, and presentation loosely coupled so individual components can be developed and tested independently.

---

✦ Engineering Highlights

🧩 Pluggable AI Architecture

The anomaly detector is exposed through a dedicated service interface, allowing the underlying ML implementation to be replaced without rewriting the API or database layers.

🔐 Separation of Responsibilities

Routers, schemas, services, persistence, and AI inference are maintained as independent application concerns.

📡 API-First Communication

The frontend interacts with the platform through REST APIs rather than accessing persistence layers directly.

📊 Structured Operational Data

Weather telemetry, station health, anomaly verdicts, and alerts are represented as persistent entities rather than transient dashboard information.

🚀 Designed for Evolution

The current development stack provides a lightweight environment while leaving room for production database migration, real-time ingestion, authentication, observability, and cloud deployment.

---

✦ Roadmap

Intelligence

- [ ] Integrate validated anomaly-detection model
- [ ] Multivariate anomaly detection
- [ ] Historical baseline modeling
- [ ] Sensor drift detection
- [ ] Explainable anomaly evidence
- [ ] Confidence calibration

Monitoring

- [ ] Real-time telemetry
- [ ] Historical weather analytics
- [ ] Station reliability scoring
- [ ] Advanced station health monitoring
- [ ] Trend analysis

Operations

- [ ] Persistent anomaly verdict workflow
- [ ] Complete alert lifecycle
- [ ] Alert acknowledgement
- [ ] Maintenance management
- [ ] Work-order management

Platform

- [ ] Automated backend testing
- [ ] Authentication
- [ ] Role-based access control
- [ ] PostgreSQL production deployment
- [ ] Cloud deployment
- [ ] Logging & observability
- [ ] Production monitoring

---

✦ Vision

SkyGuard AI is being built toward a broader environmental intelligence platform.

The goal is not simply to display:

«“Temperature: 31°C”»

The goal is to understand the operational meaning behind the telemetry:

                    ┌────────────────────┐
                    │  WHAT IS HAPPENING? │
                    └──────────┬─────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │   IS IT ABNORMAL?  │
                    └──────────┬─────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │  WHY IS IT WRONG?  │
                    └──────────┬─────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │ HOW CONFIDENT ARE  │
                    │     WE ABOUT IT?   │
                    └──────────┬─────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │   WHAT SHOULD THE  │
                    │ OPERATOR DO NEXT?  │
                    └────────────────────┘

SkyGuard AI aims to bridge that gap between raw environmental data and operational decision-making.

---

✦ Team

SkyGuard AI is developed as a collaborative engineering project spanning:

┌─────────────────┐
│    FRONTEND     │
│                 │
│ Dashboard       │
│ Visualization   │
│ UX / Operations │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     BACKEND     │
│                 │
│ APIs            │
│ Services        │
│ Persistence     │
└────────┬────────┘
         │
         ├──────────────────┐
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│   DATA LAYER    │  │    AI / ML      │
│                 │  │                 │
│ SQLite          │  │ Anomaly Engine  │
│ SQLAlchemy      │  │ ML Inference    │
└─────────────────┘  └─────────────────┘

Each layer is independently maintainable while contributing to one unified monitoring platform.

---

<div align="center">🌦️ SkyGuard AI

Observe. Detect. Understand. Act.

From environmental telemetry to operational intelligence.

<br/>"Status" (https://img.shields.io/badge/Project-Active%20Development-B784F7?style=for-the-badge)

</div>
