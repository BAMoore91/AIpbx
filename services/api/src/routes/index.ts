import type { FastifyInstance } from 'fastify';
import type { AriController } from '../ari/controller.js';
import { authRoutes } from './auth.js';
import { userRoutes } from './users.js';
import { registerResourceRoutes } from './resources.js';
import { nestedRoutes } from './nested.js';
import { callRoutes } from './calls.js';
import { mediaRoutes } from './media.js';
import { messageRoutes } from './messages.js';
import { dashboardRoutes } from './dashboard.js';
import { controlRoutes } from './control.js';

/** Mounts all v1 routes under the `/api` prefix. */
export async function registerApiRoutes(
  app: FastifyInstance,
  ari: AriController,
): Promise<void> {
  await app.register(
    async (api) => {
      await authRoutes(api);
      await userRoutes(api);
      registerResourceRoutes(api, ari);
      await nestedRoutes(api);
      await callRoutes(api);
      await mediaRoutes(api);
      await messageRoutes(api);
      await dashboardRoutes(api);
      await controlRoutes(api, ari);
    },
    { prefix: '/api' },
  );
}
