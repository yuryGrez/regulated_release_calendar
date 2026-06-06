import express from 'express';
import { auditRouter } from './routes/audit.js';
import { tenantMiddleware } from './middleware/auth.js';
import { registerShutdown } from './shutdown.js';
import pool from './db/pool.js';
import logger from './logger.js';

const app = express();
app.use(express.json());
app.use(tenantMiddleware);
app.use('/api/v1/audit', auditRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Global error handler — ensures consistent { error: { code, message } } ──
app.use((err, _req, res, _next) => {
  logger.error({ msg: 'unhandled_express_error', error: err.message });
  res.status(err.status ?? 500).json({
    error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Unexpected error' },
  });
});

const port = process.env.AUDIT_SVC_PORT || 8084;
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => logger.info({ msg: 'Audit service started', port }));
  registerShutdown(server, pool);
}

export default app;
