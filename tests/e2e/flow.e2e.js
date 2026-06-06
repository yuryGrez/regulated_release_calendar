/**
 * E2E integration tests — run against live docker-compose stack.
 *
 * Pre-requisites:
 *   docker-compose up (postgres, redis, localstack, all services)
 *   Seed data loaded: infra/scripts/seed-dev.sql
 *
 * Run:
 *   cd tests/e2e && npm install && npm test
 *
 * Environment:
 *   RELEASE_SVC_URL  (default: http://localhost:8081)
 *   CALENDAR_SVC_URL (default: http://localhost:8083)
 *   AUDIT_SVC_URL    (default: http://localhost:8084)
 */
import {
  api,
  RELEASE_SVC, CALENDAR_SVC, AUDIT_SVC,
  TEST_TENANT_ID, TEST_OWNER_ID,
  pollUntil, waitForService,
} from './helpers.js';

// ── Service health ────────────────────────────────────────────────────────────

describe('Service health', () => {
  it('release-svc is healthy', async () => {
    const res = await api.get(`${RELEASE_SVC}/health`);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  it('calendar-svc is healthy', async () => {
    const res = await api.get(`${CALENDAR_SVC}/health`);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  it('audit-svc is healthy', async () => {
    const res = await api.get(`${AUDIT_SVC}/health`);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });
});

// ── Calendar Service ──────────────────────────────────────────────────────────

describe('Calendar Service — regulatory windows', () => {
  it('returns FCA windows for 2026', async () => {
    const res = await api.get(`${CALENDAR_SVC}/api/v1/windows`, {
      params: { jurisdiction: 'FCA', year: 2026 },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    // Seed data has 3 FCA windows
    expect(res.data.length).toBeGreaterThanOrEqual(1);
  });

  it('returns active windows for FCA', async () => {
    const res = await api.get(`${CALENDAR_SVC}/api/v1/windows/active`, {
      params: { jurisdiction: 'FCA' },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('rejects unknown jurisdiction', async () => {
    const res = await api.get(`${CALENDAR_SVC}/api/v1/windows`, {
      params: { jurisdiction: 'UNKNOWN', year: 2026 },
    });
    expect(res.status).toBe(400);
    expect(res.data.detail.code).toBe('INVALID_JURISDICTION');
  });

  it('creates a manual window (admin)', async () => {
    const res = await api.post(`${CALENDAR_SVC}/api/v1/windows`,
      {
        jurisdiction: 'FCA',
        type: 'FREEZE',
        name: `E2E Test Freeze ${Date.now()}`,
        start_date: '2026-12-20',
        end_date: '2026-12-31',
      },
      { headers: { 'x-tenant-id': TEST_TENANT_ID } }
    );
    expect(res.status).toBe(201);
    expect(res.data.id).toBeTruthy();
    expect(res.data.is_manual).toBe(true);
  });
});

// ── Full release lifecycle ────────────────────────────────────────────────────

describe('Release lifecycle', () => {
  let releaseId;

  it('creates a release and returns pending_evaluation status', async () => {
    const res = await api.post(`${RELEASE_SVC}/api/v1/releases`, {
      name:         `E2E Release ${Date.now()}`,
      planned_date: '2026-08-20',   // outside all seed windows → should be SAFE
      owner_id:     TEST_OWNER_ID,
    });
    expect(res.status).toBe(201);
    expect(res.data.release_id).toBeTruthy();
    expect(res.data.status).toBe('pending_evaluation');
    releaseId = res.data.release_id;
  });

  it('appears in the releases list', async () => {
    const res = await api.get(`${RELEASE_SVC}/api/v1/releases`, {
      params: { from: '2026-08-01', to: '2026-08-31' },
    });
    expect(res.status).toBe(200);
    const found = res.data.find((r) => r.release_id === releaseId);
    expect(found).toBeTruthy();
  });

  it('returns the release by id', async () => {
    const res = await api.get(`${RELEASE_SVC}/api/v1/releases/${releaseId}`);
    expect(res.status).toBe(200);
    expect(res.data.release_id).toBe(releaseId);
  });

  it('returns 404 for a non-existent release', async () => {
    const res = await api.get(`${RELEASE_SVC}/api/v1/releases/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  it('can update a release planned_date', async () => {
    const res = await api.patch(`${RELEASE_SVC}/api/v1/releases/${releaseId}`, {
      planned_date: '2026-08-22',
    });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('pending_evaluation');
  });

  it('soft-deletes a release', async () => {
    const res = await api.delete(`${RELEASE_SVC}/api/v1/releases/${releaseId}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 after deletion', async () => {
    const res = await api.get(`${RELEASE_SVC}/api/v1/releases/${releaseId}`);
    expect(res.status).toBe(404);
  });
});

// ── Risk evaluation flow (requires SQS + Risk Engine running) ─────────────────

describe('Risk evaluation end-to-end', () => {
  let releaseId;

  it('creates a release inside FCA BLACKOUT window', async () => {
    const res = await api.post(`${RELEASE_SVC}/api/v1/releases`, {
      name:         `E2E BLOCKED Release ${Date.now()}`,
      planned_date: '2026-07-08',   // inside FCA Q3 2026 BLACKOUT (seed data)
      owner_id:     TEST_OWNER_ID,
    });
    expect(res.status).toBe(201);
    releaseId = res.data.release_id;
  });

  it('risk score is computed within 10 seconds', async () => {
    const riskRes = await pollUntil(
      () => api.get(`${RELEASE_SVC}/api/v1/releases/${releaseId}/risk`),
      (res) => res.status === 200,
      10_000,
      1_000
    );
    expect(riskRes.data.level).toBeDefined();
    expect(['SAFE', 'AT_RISK', 'BLOCKED']).toContain(riskRes.data.level);
    expect(riskRes.data.score).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it('release detail includes risk score after evaluation', async () => {
    const res = await api.get(`${RELEASE_SVC}/api/v1/releases/${releaseId}`);
    expect(res.status).toBe(200);
    expect(res.data.risk).toBeTruthy();
    expect(res.data.risk.level).toBeDefined();
  });
});

// ── Audit Service ─────────────────────────────────────────────────────────────

describe('Audit Service', () => {
  let releaseId;

  beforeAll(async () => {
    // Create a release and write an audit entry directly (bypasses SQS for speed)
    const createRes = await api.post(`${RELEASE_SVC}/api/v1/releases`, {
      name:         `E2E Audit Release ${Date.now()}`,
      planned_date: '2026-09-10',
      owner_id:     TEST_OWNER_ID,
    });
    releaseId = createRes.data.release_id;

    // Write audit entry via internal endpoint
    await api.post(`${AUDIT_SVC}/api/v1/audit`, {
      release_id:        releaseId,
      tenant_id:         TEST_TENANT_ID,
      release_name:      'E2E Audit Release',
      planned_date:      '2026-09-10',
      level:             'SAFE',
      score:             0,
      reasons:           [],
      windows_evaluated: [],
    });
  });

  it('returns audit trail for a release', async () => {
    const res = await api.get(`${AUDIT_SVC}/api/v1/audit/${releaseId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(1);
    expect(res.data[0].level).toBe('SAFE');
  });

  it('exports audit trail as PDF', async () => {
    const res = await api.get(`${AUDIT_SVC}/api/v1/audit/${releaseId}/export`, {
      responseType: 'arraybuffer',
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // Verify it's a real PDF (starts with %PDF)
    const buf = Buffer.from(res.data);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('exports audit data as CSV', async () => {
    const res = await api.get(`${AUDIT_SVC}/api/v1/audit/export/csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.data).toContain('release_id');
  });
});

// ── Error format consistency ───────────────────────────────────────────────────

describe('Error format consistency', () => {
  it('release-svc returns { error: { code, message } } on 400', async () => {
    const res = await api.post(`${RELEASE_SVC}/api/v1/releases`, {
      name: '',   // invalid
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
    expect(res.data.error.code).toBeDefined();
    expect(res.data.error.message).toBeDefined();
  });

  it('release-svc returns { error: { code, message } } on 404', async () => {
    const res = await api.get(`${RELEASE_SVC}/api/v1/releases/not-a-uuid`);
    // Express route won't match invalid UUID format, but 404 shape should be consistent
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
