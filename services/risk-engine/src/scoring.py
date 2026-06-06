"""
Risk scoring algorithm — exact implementation per CLAUDE.md §7.2.

Scoring thresholds:
  BLACKOUT          → 40 pts  (multi-day window)
  FREEZE            → 30 pts
  AUDIT_PROXIMITY   → 20 pts  (only if within PROXIMITY_DAYS of window boundary)
  BLACKOUT_DAY      → 10 pts  (single-day blackout)

Classification:
  score >= 70  → BLOCKED
  score >= 31  → AT_RISK
  else         → SAFE
"""
from dataclasses import dataclass, field
from datetime import date
from typing import List


SCORE_THRESHOLDS = {
    'BLACKOUT': 40,
    'FREEZE': 30,
    'AUDIT_PROXIMITY': 20,   # only if within PROXIMITY_DAYS
    'BLACKOUT_DAY': 10,      # single-day blackout
}
PROXIMITY_DAYS = 5
BLOCKED_THRESHOLD = 70
AT_RISK_THRESHOLD = 31


@dataclass
class RiskReason:
    window_id: str
    window_name: str
    type: str
    points: int


@dataclass
class RiskScore:
    level: str          # SAFE | AT_RISK | BLOCKED
    score: int          # 0-100
    reasons: List[RiskReason] = field(default_factory=list)


def score_release(planned_date: date, windows: List[dict]) -> RiskScore:
    """
    Score a release against a set of regulatory windows.

    Args:
        planned_date: The release's planned deployment date.
        windows: List of regulatory_windows DB records (dicts with keys:
                 id, type, name, start_date, end_date).
                 Should be pre-filtered to a ±7-day band around planned_date
                 but the algorithm is safe with any window set.

    Returns:
        RiskScore with level, score (0-100), and contributing reasons.
    """
    score = 0
    reasons: List[RiskReason] = []

    for w in windows:
        start = date.fromisoformat(w['start_date']) if isinstance(w['start_date'], str) else w['start_date']
        end   = date.fromisoformat(w['end_date'])   if isinstance(w['end_date'], str)   else w['end_date']

        days_to_start = (start - planned_date).days   # positive = window starts in future
        days_to_end   = (planned_date - end).days      # positive = window ended in past

        points = 0

        if start <= planned_date <= end:
            # planned_date falls inside the window
            window_span = (end - start).days
            wtype = 'BLACKOUT_DAY' if window_span == 0 else w['type']
            points = SCORE_THRESHOLDS.get(wtype, 0)

        elif 0 < days_to_start <= PROXIMITY_DAYS and w['type'] == 'AUDIT_PROXIMITY':
            # Release is within PROXIMITY_DAYS *before* an AUDIT_PROXIMITY window starts
            points = SCORE_THRESHOLDS['AUDIT_PROXIMITY']

        if points > 0:
            score += points
            reasons.append(RiskReason(
                window_id=w['id'],
                window_name=w['name'],
                type=w['type'],
                points=points,
            ))

    score = min(score, 100)
    level = (
        'BLOCKED'  if score >= BLOCKED_THRESHOLD else
        'AT_RISK'  if score >= AT_RISK_THRESHOLD else
        'SAFE'
    )

    return RiskScore(level=level, score=score, reasons=reasons)
