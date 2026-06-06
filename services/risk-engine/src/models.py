from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class SQSMessage(BaseModel):
    type: str
    release_id: str
    tenant_id: str
    planned_date: str          # YYYY-MM-DD
    jurisdiction: str


class RiskReasonOut(BaseModel):
    window_id: str
    window_name: str
    type: str
    points: int


class RiskScoreOut(BaseModel):
    level: str
    score: int
    reasons: list[RiskReasonOut]
    evaluated_at: Optional[datetime] = None


class ReleaseEvaluateRequest(BaseModel):
    release_id: str
    planned_date: date
    jurisdiction: str
