import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { badRequest } from '../errors.js';
import { parse, requireAuth, clientIp } from './helpers.js';
import { requirePermission, effectivePermissions } from '../auth/access.js';
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  CUSTOMIZABLE_SYSTEM_ROLES,
  CUSTOMIZABLE_DEPARTMENT_ROLES,
  systemRolePermissions,
  departmentRolePermissions,
  type Permission,
  type RoleOverride,
} from '../auth/permissions.js';

const SYSTEM_ROLES = ['admin', 'supervisor', 'agent', 'user'] as const;
const DEPT_ROLES = ['owner', 'manager', 'receptionist', 'user'] as const;

function editable(scope: 'system' | 'department', role: string): boolean {
  return scope === 'system'
    ? (CUSTOMIZABLE_SYSTEM_ROLES as string[]).includes(role)
    : (CUSTOMIZABLE_DEPARTMENT_ROLES as string[]).includes(role);
}

/**
 * Role-permission matrix — the customizable access-roles editor. Read shows the
 * effective matrix (defaults + tenant overrides); writes adjust a role's
 * permissions. `admin` (System Owner) and department `owner` are always full
 * and not editable, mirroring 3CX.
 */
export async function rbacRoutes(app: FastifyInstance): Promise<void> {
  const manage = { preHandler: [app.authenticate, requirePermission('roles.manage')] };

  async function loadOverrides(tenantId: string): Promise<RoleOverride[]> {
    const { rows } = await query<{ scope: string; role: string; permission: string; allowed: boolean }>(
      `SELECT scope, role, permission, allowed FROM role_permissions WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows.map((r) => ({
      scope: r.scope === 'system' ? 'system' : 'department',
      role: r.role,
      permission: r.permission as Permission,
      allowed: r.allowed,
    }));
  }

  // The current user's effective permissions — used by the console to gate UI.
  app.get('/access/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = requireAuth(request);
    return reply.send(await effectivePermissions(auth));
  });

  // Full matrix: catalog + per-role effective permission sets + editability.
  app.get('/access/matrix', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const overrides = await loadOverrides(auth.tenantId);
    const system: Record<string, { permissions: Permission[]; editable: boolean }> = {};
    for (const r of SYSTEM_ROLES) {
      system[r] = { permissions: [...systemRolePermissions(r, overrides)], editable: editable('system', r) };
    }
    const department: Record<string, { permissions: Permission[]; editable: boolean }> = {};
    for (const r of DEPT_ROLES) {
      department[r] = { permissions: [...departmentRolePermissions(r, overrides)], editable: editable('department', r) };
    }
    return reply.send({ catalog: PERMISSIONS, system, department });
  });

  // Replace a role's permission set (records explicit allow/deny overrides).
  app.put('/access/matrix/:scope/:role', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const { scope, role } = request.params as { scope: string; role: string };
    if (scope !== 'system' && scope !== 'department') throw badRequest('scope must be system|department');
    if (!editable(scope, role)) throw badRequest(`Role "${role}" is not customizable`);
    const Body = z.object({ permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])) });
    const { permissions } = parse(Body, request.body);
    const desired = new Set(permissions);

    // Persist an explicit allowed flag for every catalog permission so the
    // stored decision is unambiguous regardless of future default changes.
    for (const p of ALL_PERMISSIONS) {
      await query(
        `INSERT INTO role_permissions (tenant_id, scope, role, permission, allowed)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, scope, role, permission)
         DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()`,
        [auth.tenantId, scope, role, p, desired.has(p)],
      );
    }
    await audit(auth, {
      action: 'rbac.role.update',
      entity: 'role',
      entityId: `${scope}:${role}`,
      metadata: { permissions },
      ip: clientIp(request),
    });
    return reply.send({ scope, role, permissions });
  });

  // Reset a role to its in-code defaults (drop overrides).
  app.delete('/access/matrix/:scope/:role', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const { scope, role } = request.params as { scope: string; role: string };
    if (scope !== 'system' && scope !== 'department') throw badRequest('scope must be system|department');
    await query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND scope = $2 AND role = $3`, [auth.tenantId, scope, role]);
    await audit(auth, { action: 'rbac.role.reset', entity: 'role', entityId: `${scope}:${role}`, ip: clientIp(request) });
    return reply.code(204).send();
  });
}
