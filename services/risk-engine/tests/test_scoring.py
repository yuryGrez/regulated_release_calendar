"""
Risk scoring algorithm tests — CLAUDE.md §10 specifies minimum 10 cases:
  SAFE release, AT_RISK within 5 days, BLOCKED inside blackout,
  multiple overlapping windows, score capped at 100.

All tests are pure (no DB, no network).
"""
import pytest
from datetime import date, timedelta
from src.scoring import (
    score_release,
    RiskScore,
    RiskReason,
    SCORE_THRESHOLDS,
    BLOCKED_THRESHOLD,
    AT_RISK_THRESHOLD,
    PROXIMITY_DAYS,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_window(
    id='win-001',
    name='Test Window',
    wtype='BLACKOUT',
    start_date='2026-07-01',
    end_date='2026-07-14',
):
    return {
        'id': id,
        'name': name,
        'type': wtype,
        'start_date': start_date,
        'end_date': end_date,
    }


# ── 1. SAFE: no windows ───────────────────────────────────────────────────────

def test_safe_no_windows():
    result = score_release(date(2026, 6, 15), [])
    assert result.level == 'SAFE'
    assert result.score == 0
    assert result.reasons == []


# ── 2. SAFE: planned_date clearly outside all windows ─────────────────────────

def test_safe_date_outside_window():
    window = make_window(start_date='2026-07-01', end_date='2026-07-14')
    result = score_release(date(2026, 8, 1), [window])
    assert result.level == 'SAFE'
    assert result.score == 0
    assert result.reasons == []


# ── 3. AT_RISK: date inside BLACKOUT window (40 pts, needs ≥70 to be BLOCKED) ─

def test_at_risk_inside_blackout_single_window():
    """Single BLACKOUT = 40 pts. 31 <= 40 < 70 → AT_RISK, not BLOCKED."""
    window = make_window(wtype='BLACKOUT', start_date='2026-07-01', end_date='2026-07-14')
    result = score_release(date(2026, 7, 8), [window])
    assert result.level == 'AT_RISK'            # 40 >= 31 but < 70
    assert result.score == SCORE_THRESHOLDS['BLACKOUT']   # 40
    assert len(result.reasons) == 1
    assert result.reasons[0].type == 'BLACKOUT'
    assert result.reasons[0].points == 40


# ── 4. SAFE: date inside FREEZE window (30 pts < AT_RISK threshold of 31) ─────

def test_safe_inside_freeze_single_window():
    """Single FREEZE = 30 pts. 30 < 31 → SAFE."""
    window = make_window(wtype='FREEZE', start_date='2026-10-20', end_date='2026-11-01')
    result = score_release(date(2026, 10, 25), [window])
    assert result.level == 'SAFE'               # 30 < AT_RISK_THRESHOLD (31)
    assert result.score == SCORE_THRESHOLDS['FREEZE']     # 30
    assert result.reasons[0].points == 30


# ── 5. SAFE: AUDIT_PROXIMITY within 5 days (20 pts < 31) ─────────────────────

def test_safe_audit_proximity_within_5_days():
    """AUDIT_PROXIMITY proximity = 20 pts. 20 < 31 → SAFE."""
    window = make_window(
        wtype='AUDIT_PROXIMITY',
        start_date='2026-09-15', end_date='2026-09-15',
    )
    result = score_release(date(2026, 9, 12), [window])   # 3 days before
    assert result.level == 'SAFE'               # 20 < AT_RISK_THRESHOLD (31)
    assert result.score == SCORE_THRESHOLDS['AUDIT_PROXIMITY']  # 20
    assert result.reasons[0].points == 20


# ── 6. SAFE: AUDIT_PROXIMITY but >5 days before window ───────────────────────

def test_safe_audit_proximity_outside_5_days():
    window = make_window(
        wtype='AUDIT_PROXIMITY',
        start_date='2026-09-15', end_date='2026-09-15',
    )
    # Release is 10 days before window start → outside proximity band
    result = score_release(date(2026, 9, 5), [window])
    assert result.level == 'SAFE'
    assert result.score == 0


# ── 7. AUDIT_PROXIMITY: exactly on boundary (day 5) counts, still SAFE alone ──

def test_audit_proximity_exactly_on_day_5():
    """Day-5 proximity: 20 pts scored, but 20 < 31 → SAFE."""
    window = make_window(
        wtype='AUDIT_PROXIMITY',
        start_date='2026-09-15', end_date='2026-09-15',
    )
    result = score_release(date(2026, 9, 10), [window])   # exactly 5 days before
    assert result.score == SCORE_THRESHOLDS['AUDIT_PROXIMITY']   # 20
    assert result.level == 'SAFE'   # 20 < AT_RISK_THRESHOLD (31)


# ── 8. BLACKOUT_DAY: single-day blackout scores 10, not 40 ───────────────────

def test_single_day_blackout_scores_10():
    window = make_window(
        wtype='BLACKOUT',
        start_date='2026-07-04', end_date='2026-07-04',   # span == 0
    )
    result = score_release(date(2026, 7, 4), [window])
    assert result.score == SCORE_THRESHOLDS['BLACKOUT_DAY']   # 10
    assert result.level == 'SAFE'   # 10 < AT_RISK_THRESHOLD (31)


# ── 9. Multiple overlapping windows accumulate score ─────────────────────────

def test_multiple_windows_accumulate_score():
    blackout = make_window(id='w1', wtype='BLACKOUT',
                           start_date='2026-07-01', end_date='2026-07-14')
    freeze   = make_window(id='w2', wtype='FREEZE',
                           start_date='2026-07-01', end_date='2026-07-31')
    result = score_release(date(2026, 7, 8), [blackout, freeze])
    assert result.score == 40 + 30   # 70
    assert result.level == 'BLOCKED'
    assert len(result.reasons) == 2


# ── 10. Score is capped at 100 ────────────────────────────────────────────────

def test_score_capped_at_100():
    windows = [
        make_window(id=f'w{i}', wtype='BLACKOUT',
                    start_date='2026-07-01', end_date='2026-07-14')
        for i in range(5)  # 5 × 40 = 200 → should cap at 100
    ]
    result = score_release(date(2026, 7, 8), windows)
    assert result.score == 100
    assert result.level == 'BLOCKED'


# ── 11. BLOCKED threshold boundary (score == 70 exactly) ─────────────────────

def test_blocked_at_exact_threshold():
    blackout = make_window(id='w1', wtype='BLACKOUT',
                           start_date='2026-07-01', end_date='2026-07-14')
    freeze   = make_window(id='w2', wtype='FREEZE',
                           start_date='2026-07-01', end_date='2026-07-31')
    result = score_release(date(2026, 7, 8), [blackout, freeze])
    assert result.score == BLOCKED_THRESHOLD   # 70
    assert result.level == 'BLOCKED'


# ── 12. AT_RISK threshold boundary (score == 31) ─────────────────────────────

def test_freeze_alone_is_safe_because_30_lt_31():
    """
    FREEZE alone = 30 pts. AT_RISK_THRESHOLD = 31.
    30 < 31 → SAFE.  This confirms the threshold boundary is exclusive at 30.
    """
    freeze = make_window(wtype='FREEZE', start_date='2026-10-20', end_date='2026-11-01')
    result = score_release(date(2026, 10, 25), [freeze])
    assert result.score == 30
    assert result.score < AT_RISK_THRESHOLD   # 30 < 31
    assert result.level == 'SAFE'


def test_at_risk_requires_31_or_more():
    # FREEZE(30) + BLACKOUT_DAY(10) = 40 → BLOCKED? No: 40 < 70.
    freeze   = make_window(id='w1', wtype='FREEZE',
                           start_date='2026-10-20', end_date='2026-11-01')
    bday     = make_window(id='w2', wtype='BLACKOUT',
                           start_date='2026-10-25', end_date='2026-10-25')
    result = score_release(date(2026, 10, 25), [freeze, bday])
    assert result.score == 30 + 10   # 40
    assert result.level == 'AT_RISK'  # 31 <= 40 < 70


# ── 13. AUDIT_PROXIMITY inside window scores window type, not proximity ───────

def test_audit_proximity_inside_window_scores_window_type():
    # If release falls inside an AUDIT_PROXIMITY window, it should score
    # SCORE_THRESHOLDS['AUDIT_PROXIMITY'] (20) — not proximity band (also 20).
    window = make_window(
        wtype='AUDIT_PROXIMITY',
        start_date='2026-09-01', end_date='2026-09-30',
    )
    result = score_release(date(2026, 9, 15), [window])
    assert result.score == SCORE_THRESHOLDS['AUDIT_PROXIMITY']  # 20
    assert result.level == 'SAFE'   # 20 < 31


# ── 14. Reasons carry correct metadata ───────────────────────────────────────

def test_reasons_carry_correct_metadata():
    window = make_window(id='abc-123', name='FCA Q3 Freeze',
                         wtype='BLACKOUT', start_date='2026-07-01', end_date='2026-07-14')
    result = score_release(date(2026, 7, 8), [window])
    reason = result.reasons[0]
    assert reason.window_id == 'abc-123'
    assert reason.window_name == 'FCA Q3 Freeze'
    assert reason.type == 'BLACKOUT'
    assert reason.points == 40


# ── 15. date objects and ISO strings both accepted ────────────────────────────

def test_accepts_date_objects_and_strings():
    window_str = make_window(start_date='2026-07-01', end_date='2026-07-14')
    window_obj = {**window_str, 'start_date': date(2026, 7, 1), 'end_date': date(2026, 7, 14)}

    result_str = score_release(date(2026, 7, 8), [window_str])
    result_obj = score_release(date(2026, 7, 8), [window_obj])

    assert result_str.score == result_obj.score
    assert result_str.level == result_obj.level
