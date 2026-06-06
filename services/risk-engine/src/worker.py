"""
SQS long-polling consumer for the Risk Engine.

Flow per message:
  1. Parse { release_id, tenant_id, planned_date, jurisdiction }
  2. Idempotency check — skip if score evaluated within last 5 minutes
  3. Fetch regulatory windows from DB
  4. score_release()
  5. Persist risk_scores row (direct DB)
  6. POST to Audit Service  → writes audit_log + S3 WORM
  7. Publish RiskScoreComputed to notifications queue
  8. Delete message from SQS
  On failure: retry up to 3x, then log and move on (SQS DLQ handles poison pills)
"""
import asyncio
import json
import os
import time

import boto3
import httpx
import structlog
from botocore.exceptions import ClientError

from .db import (
    SessionLocal,
    fetch_windows_for_release,
    check_recent_score,
    persist_risk_score,
    fetch_release,
)
from .scoring import score_release
from .models import SQSMessage

logger = structlog.get_logger()

SQS_RELEASES_URL = os.environ.get('SQS_QUEUE_URL_RELEASES', '')
SQS_NOTIF_URL    = os.environ.get('SQS_QUEUE_URL_NOTIFICATIONS', '')
AWS_REGION       = os.environ.get('AWS_REGION', 'eu-west-2')
SQS_ENDPOINT     = os.environ.get('SQS_ENDPOINT')
AUDIT_SVC_URL    = os.environ.get('AUDIT_SVC_URL', 'http://audit-svc:8084')

MAX_RETRIES  = 3
WAIT_SECONDS = 20   # SQS long-poll


def _make_sqs_client():
    kwargs = dict(
        region_name=AWS_REGION,
        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'test'),
        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'test'),
    )
    if SQS_ENDPOINT:
        kwargs['endpoint_url'] = SQS_ENDPOINT
    return boto3.client('sqs', **kwargs)


async def _post_audit(payload: dict) -> None:
    """
    Call Audit Service to record audit entry + trigger S3 WORM write.
    Falls back to a warning log on failure — risk score is already persisted.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f'{AUDIT_SVC_URL}/api/v1/audit', json=payload)
            if resp.status_code not in (200, 201):
                logger.warning('audit_svc_unexpected_status',
                               status=resp.status_code, body=resp.text[:200])
    except Exception as e:
        # Non-fatal: risk score is already persisted; audit service may be temporarily down
        logger.error('audit_svc_call_failed', error=str(e))


async def process_message(msg: dict, sqs) -> None:
    """Parse and evaluate a single SQS message dict."""
    body  = json.loads(msg['Body'])
    event = SQSMessage(**body)

    if event.type != 'ReleaseCreated':
        logger.warning('unknown_event_type', type=event.type)
        return

    async with SessionLocal() as session:
        # Idempotency: skip if recently evaluated
        if await check_recent_score(session, event.release_id):
            logger.info('score_skipped_recent', release_id=event.release_id)
            return

        # Fetch release metadata
        release = await fetch_release(session, event.release_id)
        if release is None:
            logger.warning('release_not_found', release_id=event.release_id)
            return

        from datetime import date as date_cls
        planned_date = date_cls.fromisoformat(event.planned_date)

        # Fetch relevant regulatory windows
        windows = await fetch_windows_for_release(session, event.jurisdiction, planned_date)

        # Score
        result = score_release(planned_date, windows)

        reasons_dicts = [
            {'window_id': r.window_id, 'window_name': r.window_name,
             'type': r.type, 'points': r.points}
            for r in result.reasons
        ]
        windows_evaluated = [
            {'id': w['id'], 'name': w['name'], 'type': w['type'],
             'start_date': str(w['start_date']), 'end_date': str(w['end_date'])}
            for w in windows
        ]

        # Persist risk score (direct DB write — critical path)
        await persist_risk_score(
            session, event.release_id, result.level, result.score, reasons_dicts
        )
        await session.commit()

    logger.info('risk_score_computed',
                release_id=event.release_id,
                level=result.level,
                score=result.score)

    # Call Audit Service (handles audit_log DB write + S3 WORM)
    await _post_audit({
        'release_id':        event.release_id,
        'tenant_id':         event.tenant_id,
        'release_name':      release['name'],
        'planned_date':      event.planned_date,
        'level':             result.level,
        'score':             result.score,
        'reasons':           reasons_dicts,
        'windows_evaluated': windows_evaluated,
    })

    # Publish notification event (fire-and-forget)
    _publish_risk_computed(sqs, event, result.level, result.score, reasons_dicts)


def _publish_risk_computed(sqs, event: SQSMessage, level: str, score: int, reasons: list) -> None:
    if not SQS_NOTIF_URL:
        return
    try:
        sqs.send_message(
            QueueUrl=SQS_NOTIF_URL,
            MessageBody=json.dumps({
                'type':        'RiskScoreComputed',
                'release_id':  event.release_id,
                'tenant_id':   event.tenant_id,
                'planned_date': event.planned_date,
                'jurisdiction': event.jurisdiction,
                'level':       level,
                'score':       score,
                'reasons':     reasons,
            }),
            MessageGroupId=event.tenant_id,
            MessageDeduplicationId=f'{event.release_id}-risk-{int(time.time())}',
        )
    except ClientError as e:
        logger.error('notif_publish_failed', release_id=event.release_id, error=str(e))


async def run_worker() -> None:
    sqs = _make_sqs_client()
    logger.info('risk_engine_worker_started', queue=SQS_RELEASES_URL)

    while True:
        try:
            response = sqs.receive_message(
                QueueUrl=SQS_RELEASES_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=WAIT_SECONDS,
                AttributeNames=['All'],
            )
        except ClientError as e:
            logger.error('sqs_receive_failed', error=str(e))
            await asyncio.sleep(5)
            continue

        messages = response.get('Messages', [])
        for msg in messages:
            receipt = msg['ReceiptHandle']
            attempt = 0
            success = False

            while attempt < MAX_RETRIES and not success:
                attempt += 1
                try:
                    await process_message(msg, sqs)
                    success = True
                except Exception as e:
                    logger.error('message_processing_failed',
                                 attempt=attempt,
                                 message_id=msg.get('MessageId'),
                                 error=str(e))
                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(2 ** attempt)

            if success:
                try:
                    sqs.delete_message(QueueUrl=SQS_RELEASES_URL, ReceiptHandle=receipt)
                except ClientError as e:
                    logger.error('sqs_delete_failed', error=str(e))
            else:
                logger.error('message_exhausted_retries', message_id=msg.get('MessageId'))


if __name__ == '__main__':
    asyncio.run(run_worker())
