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
    const authzHeader = request.headers.authorization;
    if (!authzHeader?.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token');
    }
    const token = authzHeader.slice('Bearer '.length).trim();
    let claims;
    try {
      claims = app.ctx.jwt.verifyAccess(token);
    } catch {
      throw unauthorized('Invalid or expired token');
    }

    // Superadmins may operate on any tenant by setting X-Tenant-Id; everyone
    // else is locked to their own tenant. This is the single point where the
    // effective tenant (used by every downstream query) is decided.
    const homeTenantId = claims.tid;
    let tenantId = homeTenantId;
    let impersonating = false;
    if (claims.role === 'superadmin') {
      const raw = request.headers['x-tenant-id'];
      const target = Array.isArray(raw) ? raw[0] : raw;
      if (target && /^[0-9a-f-]{36}$/i.test(target) && target !== homeTenantId) {
        tenantId = target;
        impersonating = true;
      }
    }

    request.auth = {
      userId: claims.sub,
      tenantId,
      homeTenantId,
      impersonating,
      role: claims.role,
      email: claims.email,
    };
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

  const requireSuperadmin: preHandlerHookHandler = async (request: FastifyRequest) => {
    if (request.auth?.role !== 'superadmin') throw forbidden('Superadmin only');
  };

  app.decorate('authenticate', authenticate);
  app.decorate('requireRole', requireRole);
  app.decorate('requireSuperadmin', requireSuperadmin);
}

export const authPlugin = fp(authPluginImpl, { name: 'auth-plugin' });
