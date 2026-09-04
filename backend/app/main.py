from fastapi import FastAPI

from app.db.database import init_db
from app.routers import alerts, ingest, readings, stations, verdicts, work_orders
from app.services import alert_service, station_service, work_order_service

app = FastAPI(
    title="SkyGuard AI Backend",
    description="Backend API foundation for weather-station anomaly detection.",
    version="0.1.0",
)

app.include_router(stations.router)
app.include_router(readings.router)
app.include_router(ingest.router)
app.include_router(alerts.router)
app.include_router(work_orders.router)
app.include_router(verdicts.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "SkyGuard AI backend"}


@app.get("/health")
def read_health() -> dict[str, int | str]:
    stations = station_service.list_stations()
    alerts = alert_service.list_alerts()
    work_orders = work_order_service.list_work_orders()
    return {
        "status": "running",
        "station_count": len(stations),
        "open_alert_count": sum(1 for alert in alerts if alert.status.value == "open"),
        "active_work_order_count": sum(
            1 for work_order in work_orders if work_order.status.value != "COMPLETED"
        ),
    }
