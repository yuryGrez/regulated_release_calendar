/**
 * Graceful shutdown helper — shared by all Node.js services.
 * On SIGTERM/SIGINT: stops accepting new connections, waits for
 * in-flight requests to drain, then exits cleanly.
 */
import logger from './logger.js';

export function registerShutdown(server, pool, extraCleanup) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ msg: 'shutdown_initiated', signal });

    // Stop accepting new connections
    server.close(async () => {
      try {
        if (pool?.end) await pool.end();
        if (extraCleanup) await extraCleanup();
        logger.info({ msg: 'shutdown_complete' });
        process.exit(0);
      } catch (err) {
        logger.error({ msg: 'shutdown_error', error: err.message });
        process.exit(1);
      }
    });

    // Force-kill if drain takes too long
    setTimeout(() => {
      logger.error({ msg: 'shutdown_timeout_forced' });
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error({ msg: 'uncaught_exception', error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ msg: 'unhandled_rejection', reason: String(reason) });
    shutdown('unhandledRejection');
  });
}
