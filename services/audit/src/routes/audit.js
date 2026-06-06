import { Router } from 'express';
import pool from '../db/pool.js';
import { generateAuditPdf } from '../export/pdf.js';
import { generateAuditCsv } from '../export/csv.js';
import { writeAuditWorm } from '../s3/worm.js';
import logger from '../logger.js';

export const auditRouter = Router();

// ── GET /api/v1/audit/:release_id ─────────────────────────────────────────────
auditRouter.get('/:release_id', async (req, res) => {
  const { release_id } = req.params;
  const tenantId = req.headers['x-tenant-id'];

  try {
    const { rows } = await pool.query(
      `SELECT id, release_id, tenant_id, release_name, planned_date,
              level, score, reasons, windows_evaluated,
              timestamp::text AS timestamp
       FROM audit_log
       WHERE release_id = $1
         ${tenantId ? 'AND tenant_id = $2' : ''}
       ORDER BY timestamp DESC`,
      tenantId ? [release_id, tenantId] : [release_id]
    );

    return res.json(rows);
  } catch (err) {
    logger.error({ msg: 'audit_list_failed', release_id, error: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit log' } });
  }
});

// ── GET /api/v1/audit/:release_id/export  (PDF) ───────────────────────────────
auditRouter.get('/:release_id/export', async (req, res) => {
  const { release_id } = req.params;
  const tenantId = req.headers['x-tenant-id'];

  try {
    // Fetch all audit entries for this release
    const { rows: entries } = await pool.query(
      `SELECT id, release_id, tenant_id, release_name, planned_date,
              level, score, reasons, windows_evaluated,
              timestamp::text AS timestamp
       FROM audit_log
       WHERE release_id = $1
         ${tenantId ? 'AND tenant_id = $2' : ''}
       ORDER BY timestamp DESC`,
      tenantId ? [release_id, tenantId] : [release_id]
    );

    if (entries.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No audit entries found' } });
    }

    // Fetch release metadata for the cover page
    const { rows: releaseRows } = await pool.query(
      `SELECT id AS release_id, name, planned_date::text AS planned_date, status
       FROM releases WHERE id = $1`,
      [release_id]
    );
    const release = releaseRows[0] ?? { release_id, name: 'Unknown Release', planned_date: null };

    const pdfBuffer = await generateAuditPdf(release, entries);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${release_id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);

  } catch (err) {
    logger.error({ msg: 'pdf_export_failed', release_id, error: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'PDF generation failed' } });
  }
});

// ── GET /api/v1/audit/export/csv?from=&to=  (admin bulk export) ───────────────
auditRouter.get('/export/csv', async (req, res) => {
  const { from, to } = req.query;
  const tenantId = req.headers['x-tenant-id'];

  try {
    let query = `
      SELECT id, release_id, tenant_id, release_name, planned_date,
             level, score, reasons, windows_evaluated,
             timestamp::text AS timestamp
      FROM audit_log WHERE 1=1
    `;
    const params = [];

    if (tenantId) { params.push(tenantId); query += ` AND tenant_id = $${params.length}`; }
    if (from)     { params.push(from);     query += ` AND timestamp >= $${params.length}`; }
    if (to)       { params.push(to);       query += ` AND timestamp <= $${params.length}`; }
    query += ' ORDER BY timestamp DESC';

    const { rows } = await pool.query(query, params);
    const csv = await generateAuditCsv(rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
    return res.send(csv);

  } catch (err) {
    logger.error({ msg: 'csv_export_failed', error: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'CSV export failed' } });
  }
});

// ── Internal: POST /api/v1/audit  (called by Risk Engine worker) ──────────────
// This endpoint is internal — called from within the Docker network only.
// The Risk Engine could write directly to the DB, but using an endpoint keeps
// audit logic centralised and makes the WORM write easy to add here.
auditRouter.post('/', async (req, res) => {
  const {
    release_id, tenant_id, release_name, planned_date,
    level, score, reasons, windows_evaluated,
  } = req.body;

  if (!release_id || !tenant_id || !level) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'release_id, tenant_id, level required' } });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO audit_log
         (id, release_id, tenant_id, release_name, planned_date,
          level, score, reasons, windows_evaluated, timestamp)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now())
       RETURNING id, timestamp::text AS timestamp`,
      [
        release_id, tenant_id, release_name ?? 'Unknown', planned_date,
        level, score ?? 0,
        JSON.stringify(reasons ?? []),
        JSON.stringify(windows_evaluated ?? []),
      ]
    );

    const record = { ...req.body, id: rows[0].id, timestamp: rows[0].timestamp };

    // Fire-and-forget WORM write
    writeAuditWorm(record);

    logger.info({ msg: 'audit_entry_created', id: rows[0].id, release_id, level });
    return res.status(201).json({ id: rows[0].id });

  } catch (err) {
    logger.error({ msg: 'audit_write_failed', release_id, error: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Audit write failed' } });
  }
});
