import { Router } from 'express';
import pool from '../db/pool.js';
import { setTenantContext } from '../middleware/tenant.js';
import { publishReleaseCreated } from '../queue/publisher.js';
import { createReleaseSchema, updateReleaseSchema, listReleasesSchema } from '../validators/release.js';
import logger from '../logger.js';

export const releasesRouter = Router();

// POST /api/v1/releases
releasesRouter.post('/', async (req, res) => {
  const parsed = createReleaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues } });
  }

  const { name, planned_date, owner_id, jira_version_id } = parsed.data;
  const tenantId = req.tenantId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);

    const { rows } = await client.query(
      `INSERT INTO releases (tenant_id, name, planned_date, owner_id, jira_version_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenantId, name, planned_date, owner_id, jira_version_id || null]
    );

    const releaseId = rows[0].id;

    // Fetch tenant jurisdiction for SQS message
    const tenantRow = await client.query('SELECT jurisdiction FROM tenants WHERE id = $1', [tenantId]);
    const jurisdiction = tenantRow.rows[0]?.jurisdiction;

    await client.query('COMMIT');

    // Publish to SQS (non-blocking — failure logged but doesn't fail the request)
    try {
      await publishReleaseCreated({ releaseId, tenantId, plannedDate: planned_date, jurisdiction });
    } catch (sqsErr) {
      logger.error({ msg: 'SQS publish failed', release_id: releaseId, tenant_id: tenantId, err: sqsErr.message });
    }

    logger.info({ msg: 'Release created', release_id: releaseId, tenant_id: tenantId });
    return res.status(201).json({ release_id: releaseId, status: 'pending_evaluation' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ msg: 'Create release failed', tenant_id: tenantId, err: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create release' } });
  } finally {
    client.release();
  }
});

// GET /api/v1/releases
releasesRouter.get('/', async (req, res) => {
  const parsed = listReleasesSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues } });
  }

  const { from, to } = parsed.data;
  const tenantId = req.tenantId;
  const client = await pool.connect();

  try {
    await setTenantContext(client, tenantId);

    let query = `
      SELECT r.id AS release_id, r.name, r.planned_date, r.status,
             lrs.level AS risk_level, lrs.score AS risk_score
      FROM releases r
      LEFT JOIN latest_risk_scores lrs ON lrs.release_id = r.id
      WHERE r.tenant_id = $1 AND r.deleted_at IS NULL
    `;
    const params = [tenantId];

    if (from) {
      params.push(from);
      query += ` AND r.planned_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND r.planned_date <= $${params.length}`;
    }

    query += ' ORDER BY r.planned_date ASC';

    const { rows } = await client.query(query, params);
    return res.json(rows);
  } catch (err) {
    logger.error({ msg: 'List releases failed', tenant_id: tenantId, err: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list releases' } });
  } finally {
    client.release();
  }
});

// GET /api/v1/releases/:id
releasesRouter.get('/:id', async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();

  try {
    await setTenantContext(client, tenantId);

    const { rows } = await client.query(
      `SELECT r.id AS release_id, r.name, r.planned_date, r.status,
              r.jira_version_id, r.created_at, r.updated_at,
              lrs.level, lrs.score, lrs.reasons, lrs.evaluated_at
       FROM releases r
       LEFT JOIN latest_risk_scores lrs ON lrs.release_id = r.id
       WHERE r.id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL`,
      [req.params.id, tenantId]
    );

    if (!rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Release not found' } });

    const row = rows[0];
    return res.json({
      release_id: row.release_id,
      name: row.name,
      planned_date: row.planned_date,
      status: row.status,
      jira_version_id: row.jira_version_id,
      risk: row.level ? { level: row.level, score: row.score, reasons: row.reasons, evaluated_at: row.evaluated_at } : null,
    });
  } catch (err) {
    logger.error({ msg: 'Get release failed', release_id: req.params.id, tenant_id: tenantId, err: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get release' } });
  } finally {
    client.release();
  }
});

// PATCH /api/v1/releases/:id
releasesRouter.patch('/:id', async (req, res) => {
  const parsed = updateReleaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues } });
  }

  const tenantId = req.tenantId;
  const { planned_date, status } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);

    const setClauses = [];
    const params = [];

    if (planned_date) { params.push(planned_date); setClauses.push(`planned_date = $${params.length}`); }
    if (status)       { params.push(status);       setClauses.push(`status = $${params.length}`); }
    params.push(new Date().toISOString()); setClauses.push(`updated_at = $${params.length}`);
    params.push(req.params.id);
    params.push(tenantId);

    const { rows } = await client.query(
      `UPDATE releases SET ${setClauses.join(', ')}
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length} AND deleted_at IS NULL
       RETURNING id, planned_date`,
      params
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Release not found' } });
    }

    const tenantRow = await client.query('SELECT jurisdiction FROM tenants WHERE id = $1', [tenantId]);
    const jurisdiction = tenantRow.rows[0]?.jurisdiction;

    await client.query('COMMIT');

    try {
      await publishReleaseCreated({
        releaseId: rows[0].id,
        tenantId,
        plannedDate: rows[0].planned_date,
        jurisdiction,
      });
    } catch (sqsErr) {
      logger.error({ msg: 'SQS re-publish failed', release_id: rows[0].id, err: sqsErr.message });
    }

    return res.json({ release_id: rows[0].id, status: 'pending_evaluation' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ msg: 'Update release failed', release_id: req.params.id, err: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update release' } });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/releases/:id
releasesRouter.delete('/:id', async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);

    const { rowCount } = await client.query(
      `UPDATE releases SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [req.params.id, tenantId]
    );

    await client.query('COMMIT');

    if (rowCount === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Release not found' } });
    return res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ msg: 'Delete release failed', release_id: req.params.id, err: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete release' } });
  } finally {
    client.release();
  }
});

// GET /api/v1/releases/:id/risk
releasesRouter.get('/:id/risk', async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();

  try {
    await setTenantContext(client, tenantId);

    const { rows } = await client.query(
      `SELECT lrs.level, lrs.score, lrs.reasons, lrs.evaluated_at
       FROM latest_risk_scores lrs
       JOIN releases r ON r.id = lrs.release_id
       WHERE lrs.release_id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL`,
      [req.params.id, tenantId]
    );

    if (!rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Risk score not yet available' } });
    return res.json(rows[0]);
  } catch (err) {
    logger.error({ msg: 'Get risk failed', release_id: req.params.id, err: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get risk score' } });
  } finally {
    client.release();
  }
});
