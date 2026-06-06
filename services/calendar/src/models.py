from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, field_validator


JURISDICTIONS = {'FCA', 'PRA', 'APRA', 'EBA', 'DORA'}
WINDOW_TYPES = {'BLACKOUT', 'FREEZE', 'AUDIT_PROXIMITY'}


class RegulatoryWindowCreate(BaseModel):
    jurisdiction: str
    type: str
    name: str
    start_date: date
    end_date: date
    source_url: Optional[str] = None

    @field_validator('jurisdiction')
    @classmethod
    def validate_jurisdiction(cls, v: str) -> str:
        if v not in JURISDICTIONS:
            raise ValueError(f'jurisdiction must be one of {JURISDICTIONS}')
        return v

    @field_validator('type')
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in WINDOW_TYPES:
            raise ValueError(f'type must be one of {WINDOW_TYPES}')
        return v

    @field_validator('end_date')
    @classmethod
    def validate_date_range(cls, v: date, info) -> date:
        start = info.data.get('start_date')
        if start and v < start:
            raise ValueError('end_date must be >= start_date')
        return v


class RegulatoryWindowOut(BaseModel):
    id: str
    jurisdiction: str
    type: str
    name: str
    start_date: date
    end_date: date
    source_url: Optional[str]
    is_manual: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ErrorResponse(BaseModel):
    error: dict
