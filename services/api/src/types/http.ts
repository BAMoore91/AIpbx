import type { UserRole } from './db.js';

/** The authenticated principal attached to every request after auth. */
export interface AuthContext {
  userId: string;
  /**
   * The tenant this request operates on. For most users this equals
   * `homeTenantId`. A superadmin may target another tenant via the
   * `X-Tenant-Id` header, in which case `tenantId` is the targeted tenant and
   * `homeTenantId` stays the superadmin's own tenant.
   */
  tenantId: string;
  /** The tenant the authenticated user actually belongs to. */
  homeTenantId: string;
  /** True when a superadmin is acting on a tenant other than their own. */
  impersonating: boolean;
  role: UserRole;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only on routes behind the auth decorator. */
    auth?: AuthContext;
  }
  interface FastifyInstance {
    authenticate: import('fastify').preHandlerHookHandler;
    requireRole: (
      ...roles: UserRole[]
    ) => import('fastify').preHandlerHookHandler;
    /** Allow only platform superadmins (tenant management, cross-tenant ops). */
    requireSuperadmin: import('fastify').preHandlerHookHandler;
  }
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
