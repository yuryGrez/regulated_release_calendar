/**
 * POST /webhooks/jira
 *
 * Receives Jira version events, validates HMAC-SHA256 signature,
 * looks up the release by jira_version_id, and triggers re-evaluation
 * by patching the planned_date and re-publishing to SQS.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { Router } from 'express';
import pool from '../db/pool.js';
import { setTenantContext } from '../middleware/tenant.js';
import { publishReleaseCreated } from '../queue/publisher.js';
import logger from '../logger.js';

export const webhooksRouter = Router();

const SUPPORTED_EVENTS = new Set(['jira:version_updated', 'jira:version_released']);

// ── HMAC validation middleware ────────────────────────────────────────────────

function validateJiraSignature(req, res, next) {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) {
    // Secret not configured — reject all webhook calls in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: { code: 'MISCONFIGURED', message: 'Webhook secret not set' } });
    }
    logger.warn({ msg: 'JIRA_WEBHOOK_SECRET not set — skipping signature check (dev only)' });
    return next();
  }

  const header = req.headers['x-hub-signature'];
  if (!header?.startsWith('sha256=')) {
    return res.status(401).json({ error: { code: 'MISSING_SIGNATURE', message: 'X-Hub-Signature header required' } });
  }

  const received = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret)
    .update(req.rawBody ?? JSON.stringify(req.body))
    .digest();

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    logger.warn({ msg: 'Jira webhook signature mismatch' });
    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } });
  }

  next();
}

// ── Webhook handler ───────────────────────────────────────────────────────────

webhooksRouter.post('/jira', validateJiraSignature, async (req, res) => {
  const event = req.headers['x-atlassian-event'] ?? req.body?.webhookEvent;

  if (!SUPPORTED_EVENTS.has(event)) {
    logger.info({ msg: 'Unsupported Jira event — ignored', event });
    return res.status(200).json({ status: 'ignored', event });
  }

  const version = req.body?.version;
  if (!version?.id) {
    return res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'version.id required' } });
  }

  const { id: jiraVersionId, name: versionName, releaseDate } = version;

  const client = await pool.connect();
  try {
    // Lookup release by jira_version_id (no tenant context needed for lookup)
    const { rows } = await client.query(
      `SELECT r.id, r.tenant_id, r.planned_date
       FROM releases r
       WHERE r.jira_version_id = $1 AND r.deleted_at IS NULL
       LIMIT 1`,
      [String(jiraVersionId)]
    );

    if (rows.length === 0) {
      logger.info({ msg: 'Jira webhook: no release found for version', jiraVersionId });
      return res.status(200).json({ status: 'no_match', jira_version_id: jiraVersionId });
    }

    const release = rows[0];
    const newDate = releaseDate ?? release.planned_date;

    // Update planned_date if changed
    if (releaseDate && releaseDate !== release.planned_date?.toISOString?.()?.slice(0, 10)) {
      await setTenantContext(client, release.tenant_id);
      await client.query(
        `UPDATE releases SET planned_date = $1, updated_at = now()
         WHERE id = $2`,
        [newDate, release.id]
      );
      logger.info({ msg: 'Jira webhook: updated planned_date', release_id: release.id, new_date: newDate });
    }

    // Fetch tenant jurisdiction for re-evaluation
    const tenantRow = await client.query(
      'SELECT jurisdiction FROM tenants WHERE id = $1',
      [release.tenant_id]
    );
    const jurisdiction = tenantRow.rows[0]?.jurisdiction;

    // Re-publish to SQS → triggers risk re-evaluation
    try {
      await publishReleaseCreated({
        releaseId: release.id,
        tenantId: release.tenant_id,
        plannedDate: newDate,
        jurisdiction,
      });
    } catch (sqsErr) {
      logger.error({ msg: 'Jira webhook: SQS publish failed', release_id: release.id, error: sqsErr.message });
    }

    logger.info({ msg: 'Jira webhook processed', release_id: release.id, event, version_name: versionName });
    return res.status(200).json({ status: 'processed', release_id: release.id });

  } catch (err) {
    logger.error({ msg: 'Jira webhook error', error: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Webhook processing failed' } });
  } finally {
    client.release();
  }
});
