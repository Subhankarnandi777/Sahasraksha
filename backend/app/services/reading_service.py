from datetime import datetime, timezone

from sqlalchemy import select

from app.db.database import IS_SQLITE, SessionLocal
from app.db.models import WeatherReading as WeatherReadingModel
from app.schemas import TimeSeriesRow, WeatherReading


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value


def _as_db_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc) if not IS_SQLITE else value

    utc_value = value.astimezone(timezone.utc)
    return utc_value.replace(tzinfo=None) if IS_SQLITE else utc_value


def _to_weather_reading(reading: WeatherReadingModel) -> WeatherReading:
    return WeatherReading(
        station_id=reading.station_id,
        timestamp=_as_utc(reading.recorded_at),
        T=reading.temperature_c,
        P=reading.pressure_hpa,
        RH=reading.humidity_pct,
        flag=reading.flag,
        amp_ratio_P=reading.amp_ratio_p,
    )


def _to_timeseries_row(reading: WeatherReadingModel) -> TimeSeriesRow:
    return TimeSeriesRow(
        timestamp=_as_utc(reading.recorded_at),
        T=reading.temperature_c,
        P=reading.pressure_hpa,
        RH=reading.humidity_pct,
        flag=reading.flag,
        amp_ratio_P=reading.amp_ratio_p,
    )


def list_readings_for_station(station_id: str) -> list[WeatherReading]:
    with SessionLocal() as db:
        readings = db.scalars(
            select(WeatherReadingModel)
            .where(WeatherReadingModel.station_id == station_id)
            .order_by(WeatherReadingModel.recorded_at)
        ).all()
        return [_to_weather_reading(reading) for reading in readings]


def list_timeseries_for_station(
    station_id: str,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
) -> list[TimeSeriesRow]:
    with SessionLocal() as db:
        query = select(WeatherReadingModel).where(WeatherReadingModel.station_id == station_id)
        if from_time is not None:
            query = query.where(WeatherReadingModel.recorded_at >= _as_db_datetime(from_time))
        if to_time is not None:
            query = query.where(WeatherReadingModel.recorded_at <= _as_db_datetime(to_time))

        readings = db.scalars(query.order_by(WeatherReadingModel.recorded_at)).all()
        return [_to_timeseries_row(reading) for reading in readings]


def add_reading(reading: WeatherReading) -> WeatherReading:
    with SessionLocal() as db:
        db_reading = WeatherReadingModel(
            station_id=reading.station_id,
            recorded_at=_as_db_datetime(reading.timestamp),
            temperature_c=reading.T,
            humidity_pct=reading.RH,
            pressure_hpa=reading.P,
            flag=reading.flag,
            amp_ratio_p=reading.amp_ratio_P,
        )
        db.add(db_reading)
        db.commit()
        db.refresh(db_reading)
        return _to_weather_reading(db_reading)

