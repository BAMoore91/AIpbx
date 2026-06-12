import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { unauthorized, forbidden } from '../errors.js';
import type { UserRole } from '../types/db.js';

/**
 * Registers `authenticate` and `requireRole` preHandlers.
 *
 * `authenticate` validates the Bearer access token, attaches `request.auth`,
 * and is the single point where tenant scoping originates: every downstream
 * query filters by `request.auth.tenantId`.
 */
async function authPluginImpl(app: FastifyInstance): Promise<void> {
  const authenticate: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const claims = app.ctx.jwt.verifyAccess(token);
      request.auth = {
        userId: claims.sub,
        tenantId: claims.tid,
        role: claims.role,
        email: claims.email,
      };
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  };

  const requireRole =
    (...roles: UserRole[]): preHandlerHookHandler =>
    async (request: FastifyRequest) => {
      const role = request.auth?.role;
      if (!role) throw unauthorized();
      // superadmin always passes
      if (role === 'superadmin') return;
      if (!roles.includes(role)) throw forbidden('Insufficient role');
    };

  app.decorate('authenticate', authenticate);
  app.decorate('requireRole', requireRole);
}

export const authPlugin = fp(authPluginImpl, { name: 'auth-plugin' });
