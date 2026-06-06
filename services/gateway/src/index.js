/**
 * MVP API Gateway — Express reverse proxy.
 * Validates JWT, injects X-Tenant-ID, rate-limits, and routes to upstream services.
 *
 * Routes:
 *   /api/v1/releases/*  → release-svc:8081
 *   /api/v1/windows/*   → calendar-svc:8083
 *   /api/v1/audit/*     → audit-svc:8084
 *   /webhooks/*         → release-svc:8081  (bypasses auth — HMAC protected)
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './auth.js';
import logger from './logger.js';

const app = express();

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info({
    msg:       'gateway_request',
    method:    req.method,
    path:      req.path,
    tenant_id: req.headers['x-tenant-id'] ?? 'unauthenticated',
  });
  next();
});

// ── Rate limiting: 100 req/min per tenant (keyed on X-Tenant-ID post-auth) ───
const limiter = rateLimit({
  windowMs:        60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.headers['x-tenant-id'] ?? req.ip,
  handler: (_req, res) => res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down' },
  }),
});

// ── JWT validation ────────────────────────────────────────────────────────────
app.use(authMiddleware);
app.use(limiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

// ── Upstream targets ──────────────────────────────────────────────────────────
const RELEASE_SVC  = process.env.RELEASE_SVC_URL  || 'http://release-svc:8081';
const CALENDAR_SVC = process.env.CALENDAR_SVC_URL || 'http://calendar-svc:8083';
const AUDIT_SVC    = process.env.AUDIT_SVC_URL    || 'http://audit-svc:8084';

function proxy(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    on: {
      error: (err, _req, res) => {
        logger.error({ msg: 'proxy_error', target, error: err.message });
        if (!res.headersSent) {
          res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Upstream service unavailable' } });
        }
      },
    },
  });
}

app.use('/api/v1/releases', proxy(RELEASE_SVC));
app.use('/api/v1/windows',  proxy(CALENDAR_SVC));
app.use('/api/v1/audit',    proxy(AUDIT_SVC));
app.use('/webhooks',        proxy(RELEASE_SVC));   // HMAC-protected, no JWT needed

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({
  error: { code: 'NOT_FOUND', message: 'Route not found' },
}));

// ── Start ─────────────────────────────────────────────────────────────────────
const port = process.env.GATEWAY_PORT || 8080;
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => logger.info({ msg: 'Gateway started', port }));
}

export default app;
