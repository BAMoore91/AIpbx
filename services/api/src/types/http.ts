import type { UserRole } from './db.js';

/** The authenticated principal attached to every request after auth. */
export interface AuthContext {
  userId: string;
  tenantId: string;
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
  }
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
