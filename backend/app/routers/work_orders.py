from fastapi import APIRouter, HTTPException, status

from app.schemas import WorkOrder, WorkOrderStatusUpdate
from app.services import work_order_service

router = APIRouter(tags=["work-orders"])


@router.get(
    "/work-orders",
    response_model=list[WorkOrder],
    status_code=status.HTTP_200_OK,
)
def list_work_orders() -> list[WorkOrder]:
    return work_order_service.list_work_orders()


@router.get(
    "/work-orders/{work_order_id}",
    response_model=WorkOrder,
    status_code=status.HTTP_200_OK,
)
def get_work_order(work_order_id: int) -> WorkOrder:
    work_order = work_order_service.get_work_order(work_order_id)
    if work_order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work order '{work_order_id}' was not found.",
        )

    return work_order


@router.post(
    "/alerts/{alert_id}/work-order",
    response_model=WorkOrder,
    status_code=status.HTTP_201_CREATED,
)
def create_work_order_for_alert(alert_id: int) -> WorkOrder:
    try:
        work_order = work_order_service.create_work_order_for_alert(alert_id)
    except work_order_service.WorkOrderAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Alert '{alert_id}' already has a work order.",
        ) from exc

    if work_order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert '{alert_id}' was not found.",
        )

    return work_order


@router.patch(
    "/work-orders/{work_order_id}/status",
    response_model=WorkOrder,
    status_code=status.HTTP_200_OK,
)
def update_work_order_status(
    work_order_id: int,
    payload: WorkOrderStatusUpdate,
) -> WorkOrder:
    work_order = work_order_service.update_work_order_status(
        work_order_id,
        payload.status,
    )
    if work_order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work order '{work_order_id}' was not found.",
        )

    return work_order
