import { stringify } from 'csv-stringify';

/**
 * Stream audit_log rows as CSV.
 * @param {object[]} rows   audit_log records
 * @returns {Promise<string>} CSV string
 */
export async function generateAuditCsv(rows) {
  return new Promise((resolve, reject) => {
    const records = rows.map((r) => ({
      id:               r.id,
      release_id:       r.release_id,
      tenant_id:        r.tenant_id,
      release_name:     r.release_name,
      planned_date:     r.planned_date,
      level:            r.level,
      score:            r.score,
      reasons_count:    Array.isArray(r.reasons) ? r.reasons.length : 0,
      windows_count:    Array.isArray(r.windows_evaluated) ? r.windows_evaluated.length : 0,
      timestamp:        r.timestamp,
    }));

    stringify(records, { header: true }, (err, output) => {
      if (err) reject(err);
      else resolve(output);
    });
  });
}
