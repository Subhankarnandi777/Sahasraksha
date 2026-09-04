from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Station(Base):
    __tablename__ = "stations"

    station_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    health: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    degradation: Mapped[float] = mapped_column(Float, nullable=False)
    trend_per_day: Mapped[float | None] = mapped_column(Float, nullable=True)
    days_to_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    high_conf_alerts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alert_rate_pct: Mapped[float] = mapped_column(Float, nullable=False)
    rate_vs_network: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    readings: Mapped[list["WeatherReading"]] = relationship(
        back_populates="station",
        cascade="all, delete-orphan",
    )
    anomaly_verdicts: Mapped[list["AnomalyVerdict"]] = relationship(
        back_populates="station",
        cascade="all, delete-orphan",
    )
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="station",
        cascade="all, delete-orphan",
    )
    work_orders: Mapped[list["WorkOrder"]] = relationship(
        back_populates="station",
        cascade="all, delete-orphan",
    )


class WeatherReading(Base):
    __tablename__ = "weather_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.station_id"),
        nullable=False,
        index=True,
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_hpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_direction_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rainfall_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    solar_radiation_wm2: Mapped[float | None] = mapped_column(Float, nullable=True)
    flag: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amp_ratio_p: Mapped[float | None] = mapped_column(Float, nullable=True, default=1.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    station: Mapped[Station] = relationship(back_populates="readings")
    anomaly_verdicts: Mapped[list["AnomalyVerdict"]] = relationship(
        back_populates="reading",
        cascade="all, delete-orphan",
    )


class AnomalyVerdict(Base):
    __tablename__ = "anomaly_verdicts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.station_id"),
        nullable=False,
        index=True,
    )
    reading_id: Mapped[int] = mapped_column(
        ForeignKey("weather_readings.id"),
        nullable=False,
        index=True,
    )
    reading_signature: Mapped[str] = mapped_column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )
    flag: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    degradation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    evidence: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    station: Mapped[Station] = relationship(back_populates="anomaly_verdicts")
    reading: Mapped[WeatherReading] = relationship(back_populates="anomaly_verdicts")
    alert: Mapped["Alert | None"] = relationship(
        back_populates="anomaly_verdict",
        cascade="all, delete-orphan",
        uselist=False,
    )


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.station_id"),
        nullable=False,
        index=True,
    )
    reading_id: Mapped[int] = mapped_column(
        ForeignKey("weather_readings.id"),
        nullable=False,
        index=True,
    )
    anomaly_verdict_id: Mapped[int] = mapped_column(
        ForeignKey("anomaly_verdicts.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    severity: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    station: Mapped[Station] = relationship(back_populates="alerts")
    reading: Mapped[WeatherReading] = relationship()
    anomaly_verdict: Mapped[AnomalyVerdict] = relationship(back_populates="alert")
    work_order: Mapped["WorkOrder | None"] = relationship(
        back_populates="alert",
        cascade="all, delete-orphan",
        uselist=False,
    )


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.station_id"),
        nullable=False,
        index=True,
    )
    alert_id: Mapped[int] = mapped_column(
        ForeignKey("alerts.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    priority: Mapped[str] = mapped_column(String, nullable=False)
    recommended_action: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    station: Mapped[Station] = relationship(back_populates="work_orders")
    alert: Mapped[Alert] = relationship(back_populates="work_order")
