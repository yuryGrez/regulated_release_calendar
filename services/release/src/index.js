import express from 'express';
import { releasesRouter } from './routes/releases.js';
import { webhooksRouter } from './routes/webhooks.js';
import { authMiddleware } from './middleware/auth.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { registerShutdown } from './shutdown.js';
import pool from './db/pool.js';
import logger from './logger.js';

const app = express();

// Capture raw body for HMAC verification before JSON parsing
app.use((req, _res, next) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => { req.rawBody = data; });
  next();
});
app.use(express.json());

// Webhooks bypass auth — Jira signs with HMAC instead
app.use('/webhooks', webhooksRouter);

app.use(authMiddleware);
app.use(tenantMiddleware);
app.use('/api/v1/releases', releasesRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── 404 catch-all ──────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({
  error: { code: 'NOT_FOUND', message: 'Route not found' },
}));

// ── Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ msg: 'unhandled_express_error', error: err.message });
  res.status(err.status ?? 500).json({
    error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Unexpected error' },
  });
});

const port = process.env.RELEASE_SVC_PORT || 8081;
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => logger.info({ msg: 'Release service started', port }));
  registerShutdown(server, pool);
}

export default app;
