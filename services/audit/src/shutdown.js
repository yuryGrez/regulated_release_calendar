import logger from './logger.js';

export function registerShutdown(server, pool) {
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ msg: 'shutdown_initiated', signal });
    server.close(async () => {
      try {
        if (pool?.end) await pool.end();
        logger.info({ msg: 'shutdown_complete' });
        process.exit(0);
      } catch (err) {
        logger.error({ msg: 'shutdown_error', error: err.message });
        process.exit(1);
      }
    });
    setTimeout(() => { logger.error({ msg: 'shutdown_timeout' }); process.exit(1); }, 10_000);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',  (err)    => { logger.error({ msg: 'uncaught', error: err.message }); shutdown('uncaughtException'); });
  process.on('unhandledRejection', (reason) => { logger.error({ msg: 'unhandled', reason: String(reason) }); shutdown('unhandledRejection'); });
}
