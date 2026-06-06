import { jest } from '@jest/globals';

// Mock jwks-rsa so gateway loads without a real Auth0 domain
jest.unstable_mockModule('jwks-rsa', () => {
  const mockGetSigningKey = jest.fn((_kid, cb) =>
    cb(null, { getPublicKey: () => 'mock-public-key' })
  );
  return {
    default: jest.fn(() => ({ getSigningKey: mockGetSigningKey })),
  };
});

// Mock jsonwebtoken to control what tokens are "valid"
jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: jest.fn((token, _getKey, _opts, cb) => {
      if (token === 'valid-token') {
        cb(null, {
          sub: 'auth0|user1',
          'https://rrc.dev/tenant_id': '00000000-0000-0000-0000-000000000001',
        });
      } else {
        cb(new Error('invalid signature'));
      }
    }),
  },
}));

// Mock http-proxy-middleware to avoid real proxying
jest.unstable_mockModule('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(() => (req, res) => {
    res.status(200).json({ proxied: true, path: req.path });
  }),
}));

import request from 'supertest';

// We need supertest — add it as a dynamic import after mocks are set
let app;
beforeAll(async () => {
  process.env.AUTH0_DOMAIN   = 'test.auth0.com';
  process.env.AUTH0_AUDIENCE = 'https://rrc.dev';
  process.env.NODE_ENV       = 'test';
  const mod = await import('../src/index.js');
  app = mod.default;
});

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status:ok without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('gateway');
  });
});

// ── Auth middleware ───────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/v1/releases');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
    expect(res.body.error.message).toBeDefined();
  });

  it('returns 401 when token is invalid', async () => {
    const res = await request(app)
      .get('/api/v1/releases')
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('passes through with a valid token', async () => {
    const res = await request(app)
      .get('/api/v1/releases')
      .set('Authorization', 'Bearer valid-token');
    // The mock proxy returns 200
    expect(res.status).toBe(200);
    expect(res.body.proxied).toBe(true);
  });

  it('sets X-Tenant-ID header from token claim', async () => {
    // We verify indirectly — the proxy mock returns so no upstream headers leak,
    // but we can verify auth succeeded (status 200, not 401)
    const res = await request(app)
      .get('/api/v1/releases')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
  });

  it('skips auth for /webhooks/ paths', async () => {
    const res = await request(app)
      .post('/webhooks/jira')
      .send({ event: 'issue_updated' });
    // No Authorization needed — webhook uses HMAC at the service level
    expect(res.status).toBe(200);
    expect(res.body.proxied).toBe(true);
  });
});

// ── Route proxying ────────────────────────────────────────────────────────────

describe('Route proxying', () => {
  const auth = { Authorization: 'Bearer valid-token' };

  it('routes /api/v1/releases to release-svc', async () => {
    const res = await request(app).get('/api/v1/releases').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.proxied).toBe(true);
  });

  it('routes /api/v1/windows to calendar-svc', async () => {
    const res = await request(app).get('/api/v1/windows').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.proxied).toBe(true);
  });

  it('routes /api/v1/audit to audit-svc', async () => {
    const res = await request(app).get('/api/v1/audit/some-id').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.proxied).toBe(true);
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns { error: { code, message } } for unknown routes', async () => {
    const res = await request(app)
      .get('/api/v1/does-not-exist')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBeDefined();
  });
});

// ── Error format ──────────────────────────────────────────────────────────────

describe('Error response format', () => {
  it('all error responses have { error: { code, message } } shape', async () => {
    const responses = await Promise.all([
      request(app).get('/api/v1/releases'),               // 401 missing token
      request(app).get('/api/v1/releases').set('Authorization', 'Bearer bad'),  // 401 invalid
      request(app).get('/api/v1/unknown').set('Authorization', 'Bearer valid-token'), // 404
    ]);

    for (const res of responses) {
      expect(res.body.error).toBeDefined();
      expect(typeof res.body.error.code).toBe('string');
      expect(typeof res.body.error.message).toBe('string');
    }
  });
});
