from datetime import datetime, timedelta, timezone
from statistics import median

from sqlalchemy import select

from app.db.database import IS_SQLITE, SessionLocal
from app.db.models import Station, WeatherReading as WeatherReadingModel
from app.schemas import TimeSeriesRow, WeatherReading

# Width of each aggregation bucket for the network-wide series. The live
# feed publishes roughly every 5-10 minutes per station, so an hourly
# bucket collects one reading from most stations without leaving gaps.
NETWORK_BUCKET = timedelta(hours=1)


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


def _bucket_start(moment: datetime) -> datetime:
    """Floor a timestamp to the start of its NETWORK_BUCKET window."""
    seconds = int(NETWORK_BUCKET.total_seconds())
    epoch_seconds = int(_as_utc(moment).timestamp())
    return datetime.fromtimestamp(epoch_seconds - (epoch_seconds % seconds), tz=timezone.utc)


def list_network_timeseries(
    from_time: datetime | None = None,
    to_time: datetime | None = None,
) -> list[TimeSeriesRow]:
    """One series describing the WHOLE network, not a single station.

    Each bucket reports the MEDIAN reading across every station that
    published in that bucket. The median (rather than the mean) is the
    whole point: the live feed deliberately injects transient +/-9-14 unit
    demo anomalies so the detector has something genuine to catch, and a
    single station mid-injection must not be able to drag a network-wide
    figure to a physically impossible value. With ~60 stations reporting,
    one (or even a handful of) injected outlier(s) moves the median
    barely at all, while a genuine network-wide shift still moves it.

    This exists because the dashboard's "Ambient Network Temperature
    Oscillation" chart previously plotted ONE station's raw trace --
    including that station's own injected demo faults -- under a
    network-wide title. That made the headline chart read an impossible
    "Min: 10.0" for an Indian September whenever the reference station
    happened to be mid-anomaly, and made the title an overclaim.

    Stations flagged `low_confidence` are excluded, matching how the rest
    of the UI already refuses to show their readings: their underlying
    record was marked unreliable at import time, so they must not be
    allowed to move a network-wide number either.
    """
    with SessionLocal() as db:
        trusted = set(
            db.scalars(
                select(Station.station_id).where(
                    (Station.data_quality.is_(None)) | (Station.data_quality != "low_confidence")
                )
            ).all()
        )
        if not trusted:
            return []

        query = select(WeatherReadingModel).where(
            WeatherReadingModel.station_id.in_(trusted)
        )
        if from_time is not None:
            query = query.where(WeatherReadingModel.recorded_at >= _as_db_datetime(from_time))
        if to_time is not None:
            query = query.where(WeatherReadingModel.recorded_at <= _as_db_datetime(to_time))

        readings = db.scalars(query.order_by(WeatherReadingModel.recorded_at)).all()

    buckets: dict[datetime, dict[str, list[float]]] = {}
    for reading in readings:
        slot = buckets.setdefault(
            _bucket_start(reading.recorded_at), {"T": [], "P": [], "RH": []}
        )
        if reading.temperature_c is not None:
            slot["T"].append(reading.temperature_c)
        if reading.pressure_hpa is not None:
            slot["P"].append(reading.pressure_hpa)
        if reading.humidity_pct is not None:
            slot["RH"].append(reading.humidity_pct)

    rows: list[TimeSeriesRow] = []
    for moment in sorted(buckets):
        slot = buckets[moment]
        if not slot["T"] and not slot["P"] and not slot["RH"]:
            continue
        rows.append(
            TimeSeriesRow(
                timestamp=moment,
                T=round(median(slot["T"]), 2) if slot["T"] else None,
                P=round(median(slot["P"]), 2) if slot["P"] else None,
                RH=round(median(slot["RH"]), 2) if slot["RH"] else None,
                # An aggregate of many stations is not itself a reading
                # that can be "flagged" -- per-station flags stay on the
                # per-station series and the alerts page.
                flag=0,
                amp_ratio_P=None,
            )
        )
    return rows


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

