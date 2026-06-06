import { jest } from '@jest/globals';

// Mock pg pool
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};
jest.unstable_mockModule('../src/db/pool.js', () => ({
  default: { connect: jest.fn().mockResolvedValue(mockClient) },
}));

// Mock SQS publisher
jest.unstable_mockModule('../src/queue/publisher.js', () => ({
  publishReleaseCreated: jest.fn().mockResolvedValue(undefined),
}));

// Skip auth + set tenant for tests
process.env.NODE_ENV = 'test';
process.env.SKIP_AUTH = 'true';

const { default: app } = await import('../src/index.js');
const request = (await import('node:http')).default;

const TEST_TENANT = '00000000-0000-0000-0000-000000000001';
const TEST_RELEASE_ID = '11111111-1111-1111-1111-111111111111';

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const server = app.listen(0);
    const port = server.address().port;
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': TEST_TENANT,
        'x-test-user': JSON.stringify({ sub: 'user1', tenant_id: TEST_TENANT }),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = request.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        server.close();
        resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
      });
    });
    req.on('error', (e) => { server.close(); reject(e); });
    if (data) req.write(data);
    req.end();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: BEGIN/COMMIT/SET queries return empty, real queries return data
  mockQuery.mockImplementation((sql, _params) => {
    if (typeof sql === 'string' && /BEGIN|COMMIT|ROLLBACK|SET LOCAL/i.test(sql)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

describe('POST /api/v1/releases', () => {
  test('creates a release and returns 201', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // SET LOCAL
      .mockResolvedValueOnce({ rows: [{ id: TEST_RELEASE_ID }], rowCount: 1 })  // INSERT
      .mockResolvedValueOnce({ rows: [{ jurisdiction: 'FCA' }], rowCount: 1 })  // SELECT tenant
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });  // COMMIT

    const res = await httpRequest('POST', '/api/v1/releases', {
      name: 'Payments v2.3',
      planned_date: '2026-07-08',
      owner_id: '22222222-2222-2222-2222-222222222222',
    });

    expect(res.status).toBe(201);
    expect(res.body.release_id).toBe(TEST_RELEASE_ID);
    expect(res.body.status).toBe('pending_evaluation');
  });

  test('returns 400 on missing name', async () => {
    const res = await httpRequest('POST', '/api/v1/releases', {
      planned_date: '2026-07-08',
      owner_id: '22222222-2222-2222-2222-222222222222',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 on invalid date format', async () => {
    const res = await httpRequest('POST', '/api/v1/releases', {
      name: 'Test Release',
      planned_date: '08-07-2026',
      owner_id: '22222222-2222-2222-2222-222222222222',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 on invalid owner_id (not uuid)', async () => {
    const res = await httpRequest('POST', '/api/v1/releases', {
      name: 'Test Release',
      planned_date: '2026-07-08',
      owner_id: 'not-a-uuid',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/releases', () => {
  test('returns list of releases', async () => {
    const mockReleases = [
      { release_id: TEST_RELEASE_ID, name: 'Payments v2.3', planned_date: '2026-07-08', status: 'scheduled', risk_level: 'BLOCKED', risk_score: 82 },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // SET LOCAL
      .mockResolvedValueOnce({ rows: mockReleases, rowCount: 1 });

    const res = await httpRequest('GET', '/api/v1/releases', null);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].release_id).toBe(TEST_RELEASE_ID);
  });

  test('filters by from/to date', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await httpRequest('GET', '/api/v1/releases?from=2026-07-01&to=2026-07-31', null);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns 400 on invalid date in query', async () => {
    const res = await httpRequest('GET', '/api/v1/releases?from=not-a-date', null);
    expect(res.status).toBe(400);
  });
});
