from fastapi import APIRouter, HTTPException, status

from app.schemas import AnomalyVerdictRecord
from app.services import station_service, verdict_service

router = APIRouter(tags=["verdicts"])


@router.get(
    "/verdicts",
    response_model=list[AnomalyVerdictRecord],
    status_code=status.HTTP_200_OK,
)
def list_verdicts() -> list[AnomalyVerdictRecord]:
    return verdict_service.list_verdicts()


@router.get(
    "/verdicts/{verdict_id}",
    response_model=AnomalyVerdictRecord,
    status_code=status.HTTP_200_OK,
)
def get_verdict(verdict_id: int) -> AnomalyVerdictRecord:
    verdict = verdict_service.get_verdict(verdict_id)
    if verdict is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Verdict '{verdict_id}' was not found.",
        )

    return verdict


@router.get(
    "/stations/{station_id}/verdicts",
    response_model=list[AnomalyVerdictRecord],
    status_code=status.HTTP_200_OK,
)
def list_station_verdicts(station_id: str) -> list[AnomalyVerdictRecord]:
    if not station_service.station_exists(station_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' was not found.",
        )

    return verdict_service.list_verdicts_for_station(station_id)
