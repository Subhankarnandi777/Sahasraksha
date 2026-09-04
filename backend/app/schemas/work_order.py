from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class WorkOrderPriority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class WorkOrderStatus(str, Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class WorkOrder(BaseModel):
    id: int = Field(..., examples=[1])
    station_id: str = Field(..., min_length=1, examples=["STATION-001"])
    alert_id: int = Field(..., examples=[1])
    priority: WorkOrderPriority = Field(..., examples=[WorkOrderPriority.MEDIUM])
    recommended_action: str = Field(
        ...,
        min_length=1,
        examples=["Inspect station sensors and confirm alert condition."],
    )
    status: WorkOrderStatus = Field(..., examples=[WorkOrderStatus.OPEN])
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class WorkOrderStatusUpdate(BaseModel):
    status: WorkOrderStatus = Field(..., examples=[WorkOrderStatus.IN_PROGRESS])
