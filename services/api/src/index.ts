import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { initDb, closeDb } from './db.js';
import { initRedis, closeRedis } from './redis.js';
import { buildContext } from './context.js';
import { buildApp } from './app.js';
import { AriController } from './ari/controller.js';
import { EventBus } from './events.js';
import { WsHub } from './ws/hub.js';

/**
 * Service entrypoint. Boots config → datastores → context → ARI → HTTP+WS, then
 * listens. Handles SIGINT/SIGTERM for graceful shutdown.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ env: config.nodeEnv, port: config.apiPort }, 'starting AIpbx API');

  // Datastores (lazy connect; no DB required to import modules).
  initDb(config.databaseUrl);
  initRedis(config.redisUrl);

  // Shared singletons.
  const ctx = buildContext(config);
  const events = new EventBus(ctx.webhooks);

  // ARI controller (Stasis routing + call control). Non-fatal if Asterisk is
  // unreachable: the API still serves CRUD.
  const ari = new AriController(ctx, events);
  await ari.start();

  // HTTP app + WebSocket hub share one HTTP server.
  const app = await buildApp(ctx, ari);
  const wsHub = new WsHub(ctx.jwt);

  await app.listen({ host: '0.0.0.0', port: config.apiPort });
  wsHub.attach(app.server);
  wsHub.startRedisBridge();
  logger.info({ port: config.apiPort }, 'AIpbx API listening (HTTP + /ws)');

  // Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      wsHub.close();
      await ari.stop();
      await app.close();
      await closeRedis();
      await closeDb();
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => logger.fatal({ err }, 'uncaughtException'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal boot error');
  process.exit(1);
});
