from datetime import datetime

from pydantic import BaseModel, Field


class WeatherReading(BaseModel):
    station_id: str = Field(..., min_length=1, examples=["AWS_PNQ"])
    timestamp: datetime = Field(..., description="Observation timestamp.")
    T: float | None = Field(None, ge=-90.0, le=60.0, examples=[34.2])
    P: float | None = Field(None, ge=800.0, le=1100.0, examples=[948.1])
    RH: float | None = Field(None, ge=0.0, le=100.0, examples=[62.0])
    flag: int = Field(0, ge=0, le=1, examples=[0])
    amp_ratio_P: float | None = Field(None, ge=0.0, examples=[0.97])


class TimeSeriesRow(BaseModel):
    timestamp: datetime
    T: float | None = Field(None, examples=[34.2])
    P: float | None = Field(None, examples=[948.1])
    RH: float | None = Field(None, examples=[62.0])
    flag: int = Field(..., ge=0, le=1, examples=[0])
    amp_ratio_P: float | None = Field(None, examples=[0.97])
