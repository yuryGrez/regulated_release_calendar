import express from 'express';
import { runWorker } from './worker.js';
import logger from './logger.js';

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const port = process.env.NOTIF_SVC_PORT || 8085;
app.listen(port, () => logger.info({ msg: 'Notification service started', port }));

// Start SQS consumer
runWorker().catch((err) => {
  logger.error({ msg: 'Worker crashed', error: err.message });
  process.exit(1);
});
