import { jest } from '@jest/globals';

// ── Mock dependencies ─────────────────────────────────────────────────────────
const mockQuery   = jest.fn();
const mockRelease = jest.fn();
const mockClient  = { query: mockQuery, release: mockRelease };

jest.unstable_mockModule('../src/db/pool.js', () => ({
  default: { query: mockQuery, connect: jest.fn().mockResolvedValue(mockClient) },
}));

jest.unstable_mockModule('../src/s3/worm.js', () => ({
  writeAuditWorm: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../src/export/pdf.js', () => ({
  generateAuditPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
}));

jest.unstable_mockModule('../src/export/csv.js', () => ({
  generateAuditCsv: jest.fn().mockResolvedValue('id,release_id\nabc,def\n'),
}));

process.env.NODE_ENV = 'test';

const http = (await import('node:http')).default;
const { default: app } = await import('../src/index.js');

const TEST_RELEASE_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TENANT_ID  = '00000000-0000-0000-0000-000000000001';

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const server = app.listen(0);
    const port   = server.address().port;
    const opts = {
      hostname: 'localhost', port, path, method,
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id':  TEST_TENANT_ID,
        ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        server.close();
        const raw = Buffer.concat(chunks);
        let parsed;
        try { parsed = JSON.parse(raw.toString()); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    r.on('error', (e) => { server.close(); reject(e); });
    if (data) r.write(data);
    r.end();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── GET /api/v1/audit/:release_id ─────────────────────────────────────────────

describe('GET /api/v1/audit/:release_id', () => {
  test('returns audit entries for a release', async () => {
    const entries = [
      {
        id: 'aaa', release_id: TEST_RELEASE_ID, tenant_id: TEST_TENANT_ID,
        release_name: 'Payments v2.3', planned_date: '2026-07-08',
        level: 'BLOCKED', score: 70, reasons: [], windows_evaluated: [],
        timestamp: '2026-06-01T10:00:00Z',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: entries });

    const res = await req('GET', `/api/v1/audit/${TEST_RELEASE_ID}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].level).toBe('BLOCKED');
  });

  test('returns empty array when no entries exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await req('GET', `/api/v1/audit/${TEST_RELEASE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── GET /api/v1/audit/:release_id/export (PDF) ────────────────────────────────

describe('GET /api/v1/audit/:release_id/export', () => {
  test('returns PDF with correct headers', async () => {
    const entries = [{
      id: 'aaa', release_id: TEST_RELEASE_ID, tenant_id: TEST_TENANT_ID,
      release_name: 'Payments v2.3', planned_date: '2026-07-08',
      level: 'BLOCKED', score: 70, reasons: [], windows_evaluated: [],
      timestamp: '2026-06-01T10:00:00Z',
    }];
    const release = [{
      release_id: TEST_RELEASE_ID, name: 'Payments v2.3',
      planned_date: '2026-07-08', status: 'scheduled',
    }];

    // First query = audit entries, second = release metadata
    mockQuery
      .mockResolvedValueOnce({ rows: entries })
      .mockResolvedValueOnce({ rows: release });

    const res = await req('GET', `/api/v1/audit/${TEST_RELEASE_ID}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(`audit-${TEST_RELEASE_ID}.pdf`);
  });

  test('returns 404 when no audit entries exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await req('GET', `/api/v1/audit/${TEST_RELEASE_ID}/export`);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/v1/audit (internal) ─────────────────────────────────────────────

describe('POST /api/v1/audit', () => {
  test('creates an audit entry and returns 201', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'new-audit-id', timestamp: '2026-06-01T10:00:00Z' }],
    });

    const res = await req('POST', '/api/v1/audit', {
      release_id:        TEST_RELEASE_ID,
      tenant_id:         TEST_TENANT_ID,
      release_name:      'Payments v2.3',
      planned_date:      '2026-07-08',
      level:             'BLOCKED',
      score:             70,
      reasons:           [{ window_id: 'w1', window_name: 'FCA Freeze', type: 'BLACKOUT', points: 40 }],
      windows_evaluated: [],
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new-audit-id');
  });

  test('returns 400 when required fields are missing', async () => {
    const res = await req('POST', '/api/v1/audit', { release_id: TEST_RELEASE_ID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── GET /api/v1/audit/export/csv ──────────────────────────────────────────────

describe('GET /api/v1/audit/export/csv', () => {
  test('returns CSV with correct headers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await req('GET', '/api/v1/audit/export/csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});
