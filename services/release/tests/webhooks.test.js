import { jest } from '@jest/globals';
import { createHmac } from 'crypto';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockQuery   = jest.fn();
const mockRelease = jest.fn();
const mockClient  = { query: mockQuery, release: mockRelease };

jest.unstable_mockModule('../src/db/pool.js', () => ({
  default: { connect: jest.fn().mockResolvedValue(mockClient) },
}));

jest.unstable_mockModule('../src/queue/publisher.js', () => ({
  publishReleaseCreated: jest.fn().mockResolvedValue(undefined),
}));

process.env.NODE_ENV      = 'test';
process.env.SKIP_AUTH     = 'true';
process.env.JIRA_WEBHOOK_SECRET = 'test-secret-1234';

const http = (await import('node:http')).default;
const { default: app } = await import('../src/index.js');
const { publishReleaseCreated } = await import('../src/queue/publisher.js');

const TEST_RELEASE_ID  = '11111111-1111-1111-1111-111111111111';
const TEST_TENANT_ID   = '00000000-0000-0000-0000-000000000001';
const SECRET           = 'test-secret-1234';

function sign(body) {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function req(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data   = body ? JSON.stringify(body) : '';
    const server = app.listen(0);
    const port   = server.address().port;
    const sig    = sign(data);
    const opts   = {
      hostname: 'localhost', port, path, method,
      headers: {
        'Content-Type':         'application/json',
        'X-Hub-Signature':      sig,
        'X-Atlassian-Event':    'jira:version_updated',
        'Content-Length':       Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        server.close();
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch { parsed = {}; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', (e) => { server.close(); reject(e); });
    if (data) r.write(data);
    r.end();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockImplementation((sql) => {
    if (/BEGIN|COMMIT|ROLLBACK|SET LOCAL/i.test(sql)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

describe('POST /webhooks/jira', () => {
  test('rejects request with missing signature', async () => {
    const res = await req('POST', '/webhooks/jira',
      { version: { id: '1', name: 'v1.0', releaseDate: '2026-08-01' } },
      { 'X-Hub-Signature': '' }   // override with empty
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_SIGNATURE');
  });

  test('rejects request with invalid signature', async () => {
    const res = await req('POST', '/webhooks/jira',
      { version: { id: '1', name: 'v1.0', releaseDate: '2026-08-01' } },
      { 'X-Hub-Signature': 'sha256=badhash000000000000000000000000000000000000000000000000000000000' }
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  test('returns 200 ignored for unsupported event type', async () => {
    const res = await req('POST', '/webhooks/jira',
      { version: { id: '1' } },
      { 'X-Atlassian-Event': 'jira:issue_created' }
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
  });

  test('returns 400 when version.id is missing', async () => {
    const res = await req('POST', '/webhooks/jira', { webhookEvent: 'jira:version_updated' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYLOAD');
  });

  test('returns no_match when release not found for version id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });   // lookup returns no release

    const res = await req('POST', '/webhooks/jira', {
      version: { id: '999', name: 'v1.0', releaseDate: '2026-08-01' },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_match');
  });

  test('processes valid webhook, updates release, publishes to SQS', async () => {
    // Lookup returns a matching release
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: TEST_RELEASE_ID, tenant_id: TEST_TENANT_ID,
        planned_date: new Date('2026-07-01'),
      }]})
      // SET LOCAL (tenant context)
      .mockResolvedValueOnce({ rows: [] })
      // UPDATE releases
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // SELECT jurisdiction
      .mockResolvedValueOnce({ rows: [{ jurisdiction: 'FCA' }] });

    const res = await req('POST', '/webhooks/jira', {
      version: { id: '42', name: 'Payments v2.3', releaseDate: '2026-08-01' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.release_id).toBe(TEST_RELEASE_ID);
    expect(publishReleaseCreated).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: TEST_RELEASE_ID, jurisdiction: 'FCA' })
    );
  });
});
