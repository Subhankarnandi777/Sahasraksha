from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas import StationOverview, StationSummary, TimeSeriesRow, WeatherReading
from app.services import reading_service, station_service

router = APIRouter(prefix="/stations", tags=["stations"])


@router.get("", response_model=list[StationSummary], status_code=status.HTTP_200_OK)
def list_stations() -> list[StationSummary]:
    return station_service.list_stations()


@router.get(
    "/{station_id}",
    response_model=StationSummary,
    status_code=status.HTTP_200_OK,
)
def get_station(station_id: str) -> StationSummary:
    station = station_service.get_station(station_id)
    if station is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' was not found.",
        )

    return station


@router.get(
    "/{station_id}/overview",
    response_model=StationOverview,
    status_code=status.HTTP_200_OK,
)
def get_station_overview(station_id: str) -> StationOverview:
    overview = station_service.get_station_overview(station_id)
    if overview is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' was not found.",
        )

    return overview


@router.get(
    "/{station_id}/readings",
    response_model=list[WeatherReading],
    status_code=status.HTTP_200_OK,
)
def list_station_readings(station_id: str) -> list[WeatherReading]:
    if not station_service.station_exists(station_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' was not found.",
        )

    return reading_service.list_readings_for_station(station_id)


@router.get(
    "/{station_id}/timeseries",
    response_model=list[TimeSeriesRow],
    status_code=status.HTTP_200_OK,
)
def list_station_timeseries(
    station_id: str,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
) -> list[TimeSeriesRow]:
    if not station_service.station_exists(station_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' was not found.",
        )

    return reading_service.list_timeseries_for_station(station_id, from_, to)
