from collections.abc import Iterator
from datetime import datetime, timezone
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, select
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")

DATABASE_FILE = BACKEND_DIR / "skyguard.db"


def _database_url() -> str:
    configured_url = os.getenv("DATABASE_URL")
    if configured_url:
        if configured_url.startswith("postgres://"):
            return configured_url.replace("postgres://", "postgresql://", 1)
        return configured_url

    allow_sqlite = os.getenv("SKYGUARD_ALLOW_SQLITE", "").lower() in {"1", "true", "yes"}
    if allow_sqlite:
        return f"sqlite:///{DATABASE_FILE.as_posix()}"

    raise RuntimeError(
        "DATABASE_URL is required. Set it in backend/.env for Supabase PostgreSQL. "
        "For explicit local-only SQLite development, set SKYGUARD_ALLOW_SQLITE=true."
    )


SQLALCHEMY_DATABASE_URL = _database_url()
IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite")

engine_args: dict = {"pool_pre_ping": True}
if IS_SQLITE:
    engine_args["connect_args"] = {"check_same_thread": False}

engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    from app.db import models

    Base.metadata.create_all(bind=engine)
    if IS_SQLITE:
        ensure_sqlite_schema()
    if should_seed_demo_data():
        seed_demo_data()


def should_seed_demo_data() -> bool:
    return os.getenv("SKYGUARD_SEED_DEMO_DATA", "").lower() in {"1", "true", "yes"}


def ensure_sqlite_schema() -> None:
    table_columns = {
        "stations": {
            "name": "TEXT",
            "lat": "FLOAT",
            "lon": "FLOAT",
            "health_score": "FLOAT",
            "trend_per_day": "FLOAT",
            "high_conf_alerts": "INTEGER",
            "rate_vs_network": "FLOAT",
        },
        "weather_readings": {
            "flag": "INTEGER NOT NULL DEFAULT 0",
            "amp_ratio_p": "FLOAT DEFAULT 1.0",
        },
        "anomaly_verdicts": {
            "degradation": "FLOAT NOT NULL DEFAULT 0.0",
        },
    }

    with engine.begin() as connection:
        for table_name, columns in table_columns.items():
            existing_columns = {
                row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, column_type in columns.items():
                if column_name not in existing_columns:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    )


def seed_demo_data() -> None:
    from app.db import models

    with SessionLocal() as db:
        if db.scalar(select(models.Station).limit(1)) is not None:
            return

        stations = [
            models.Station(
                station_id="STATION-001",
                name="Station 001",
                lat=18.52,
                lon=73.86,
                health="good",
                status="online",
                health_score=0.912,
                degradation=8.0,
                trend_per_day=0.00123,
                days_to_threshold=45,
                high_conf_alerts=0,
                alert_rate_pct=1.8,
                rate_vs_network=1.0,
                last_seen=datetime(2026, 9, 3, 15, 30, tzinfo=timezone.utc),
            ),
            models.Station(
                station_id="STATION-002",
                name="Station 002",
                lat=22.57,
                lon=88.36,
                health="warning",
                status="degraded",
                health_score=0.585,
                degradation=41.5,
                trend_per_day=0.0024,
                days_to_threshold=12,
                high_conf_alerts=0,
                alert_rate_pct=9.6,
                rate_vs_network=1.8,
                last_seen=datetime(2026, 9, 3, 15, 20, tzinfo=timezone.utc),
            ),
            models.Station(
                station_id="STATION-003",
                name="Station 003",
                lat=23.55,
                lon=87.32,
                health="good",
                status="online",
                health_score=0.848,
                degradation=15.2,
                trend_per_day=0.0015,
                days_to_threshold=31,
                high_conf_alerts=0,
                alert_rate_pct=3.1,
                rate_vs_network=1.2,
                last_seen=datetime(2026, 9, 3, 15, 10, tzinfo=timezone.utc),
            ),
        ]
        db.add_all(stations)
        db.flush()

        db.add_all(
            [
                models.WeatherReading(
                    station_id="STATION-001",
                    recorded_at=datetime(2026, 9, 3, 15, 0, tzinfo=timezone.utc),
                    temperature_c=28.4,
                    humidity_pct=73.0,
                    pressure_hpa=1008.2,
                    wind_speed_mps=3.4,
                    wind_direction_deg=205.0,
                    rainfall_mm=0.0,
                    solar_radiation_wm2=540.0,
                    flag=0,
                    amp_ratio_p=0.97,
                ),
                models.WeatherReading(
                    station_id="STATION-001",
                    recorded_at=datetime(2026, 9, 3, 15, 30, tzinfo=timezone.utc),
                    temperature_c=28.9,
                    humidity_pct=71.5,
                    pressure_hpa=1007.9,
                    wind_speed_mps=3.8,
                    wind_direction_deg=212.0,
                    rainfall_mm=0.0,
                    solar_radiation_wm2=515.0,
                    flag=0,
                    amp_ratio_p=0.98,
                ),
                models.WeatherReading(
                    station_id="STATION-002",
                    recorded_at=datetime(2026, 9, 3, 14, 50, tzinfo=timezone.utc),
                    temperature_c=31.2,
                    humidity_pct=82.0,
                    pressure_hpa=1003.5,
                    wind_speed_mps=5.1,
                    wind_direction_deg=180.0,
                    rainfall_mm=1.4,
                    solar_radiation_wm2=290.0,
                    flag=0,
                    amp_ratio_p=0.95,
                ),
                models.WeatherReading(
                    station_id="STATION-002",
                    recorded_at=datetime(2026, 9, 3, 15, 20, tzinfo=timezone.utc),
                    temperature_c=31.0,
                    humidity_pct=83.2,
                    pressure_hpa=1003.1,
                    wind_speed_mps=5.4,
                    wind_direction_deg=176.0,
                    rainfall_mm=1.8,
                    solar_radiation_wm2=260.0,
                    flag=0,
                    amp_ratio_p=0.94,
                ),
                models.WeatherReading(
                    station_id="STATION-003",
                    recorded_at=datetime(2026, 9, 3, 14, 40, tzinfo=timezone.utc),
                    temperature_c=24.7,
                    humidity_pct=64.5,
                    pressure_hpa=1011.6,
                    wind_speed_mps=2.2,
                    wind_direction_deg=90.0,
                    rainfall_mm=0.0,
                    solar_radiation_wm2=620.0,
                    flag=0,
                    amp_ratio_p=1.01,
                ),
                models.WeatherReading(
                    station_id="STATION-003",
                    recorded_at=datetime(2026, 9, 3, 15, 10, tzinfo=timezone.utc),
                    temperature_c=25.1,
                    humidity_pct=63.8,
                    pressure_hpa=1011.4,
                    wind_speed_mps=2.6,
                    wind_direction_deg=94.0,
                    rainfall_mm=0.0,
                    solar_radiation_wm2=650.0,
                    flag=0,
                    amp_ratio_p=1.0,
                ),
            ]
        )
        db.commit()
