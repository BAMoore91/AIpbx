import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { AppError } from './errors.js';
import { authPlugin } from './auth/plugin.js';
import { registerApiRoutes } from './routes/index.js';
import type { AppContext } from './context.js';
import type { AriController } from './ari/controller.js';

/**
 * Build (but do not start) the Fastify instance. The HTTP server is created so
 * the WS hub can attach to the same listener.
 */
export async function buildApp(
  ctx: AppContext,
  ari: AriController,
): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.decorate('ctx', ctx);

  await app.register(cors, {
    origin: ctx.config.corsOrigins.length ? ctx.config.corsOrigins : true,
    credentials: true,
  });
  await app.register(authPlugin);

  // Health checks (unauthenticated).
  app.get('/healthz', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  await registerApiRoutes(app, ari);

  // Centralized error mapping → stable JSON shape.
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'Validation failed', details: err.flatten() },
      });
    }
    // Fastify validation / unknown.
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error({ err }, 'unhandled error');
    return reply.code(status).send({
      error: { code: status >= 500 ? 'internal_error' : 'request_error', message: status >= 500 ? 'Internal server error' : err.message },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
  });

  return app;
}
