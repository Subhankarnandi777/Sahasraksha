from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.database import init_db
from app.routers import alerts, chat, demo, ingest, readings, stations, verdicts, work_orders
from app.services import alert_service, keepalive_service, station_service, work_order_service


app = FastAPI(
    title="Sahasraksha Backend",
    description="Backend API foundation for weather-station anomaly detection.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://sahasraksha-iota.vercel.app", "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stations.router)
app.include_router(readings.router)
app.include_router(ingest.router)
app.include_router(alerts.router)
app.include_router(work_orders.router)
app.include_router(verdicts.router)
app.include_router(demo.router)
app.include_router(chat.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    keepalive_service.start_keepalive()


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Sahasraksha backend"}


@app.get("/health")
def read_health() -> dict[str, int | str]:
    # A health/liveness check has to be cheap and O(1)-ish regardless of how
    # much data the network has accumulated. The previous version loaded
    # and converted every station, every alert (each also triggering a
    # lazy-loaded verdict query) and every work order just to compute three
    # counts -- it got slower every day the keepalive service added rows,
    # and could hang the whole dashboard since the frontend loads /health
    # and /stations together and blocks on both. These are plain SQL
    # COUNT(*) queries instead.
    return {
        "status": "running",
        "station_count": station_service.count_stations(),
        "open_alert_count": alert_service.count_open_alerts(),
        "active_work_order_count": work_order_service.count_active_work_orders(),
        "stations_with_open_work_orders": work_order_service.count_stations_with_active_work_orders(),
    }
