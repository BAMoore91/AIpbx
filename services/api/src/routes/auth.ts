import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, requireAuth, clientIp } from './helpers.js';
import { audit } from '../audit.js';
import { notFound } from '../errors.js';
import type { UserRole } from '../types/db.js';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
  tenantSlug: z.string().optional(),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });
const LogoutSchema = z.object({ refreshToken: z.string().min(1) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const body = parse(LoginSchema, request.body);
    const result = await app.ctx.auth.login({
      ...body,
      userAgent: request.headers['user-agent'],
      ip: clientIp(request),
    });
    await audit(
      {
        userId: result.user.id,
        tenantId: result.user.tenantId,
        homeTenantId: result.user.tenantId,
        impersonating: false,
        role: result.user.role as UserRole,
        email: result.user.email,
      },
      { action: 'auth.login', entity: 'user', entityId: result.user.id, ip: clientIp(request) },
    );
    return reply.send(result);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = parse(RefreshSchema, request.body);
    const result = await app.ctx.auth.refresh(
      refreshToken,
      request.headers['user-agent'],
      clientIp(request),
    );
    return reply.send(result);
  });

  app.post('/auth/logout', async (request, reply) => {
    const { refreshToken } = parse(LogoutSchema, request.body);
    await app.ctx.auth.logout(refreshToken);
    return reply.code(204).send();
  });

  app.get(
    '/auth/me',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const me = await app.ctx.auth.me(auth.userId);
      if (!me) throw notFound('User not found');
      return reply.send(me);
    },
  );
}
