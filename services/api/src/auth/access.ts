import type { preHandlerHookHandler } from 'fastify';
import { query } from '../db.js';
import { forbidden } from '../errors.js';
import { requireAuth } from '../routes/helpers.js';
import type { AuthContext } from '../types/http.js';
import {
  systemRolePermissions,
  departmentRolePermissions,
  type Permission,
  type RoleOverride,
} from './permissions.js';

/** Load a tenant's role-permission overrides. */
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

/** The user's role in each department they belong to (within the tenant). */
async function userDepartmentRoles(
  userId: string,
  tenantId: string,
): Promise<Array<{ departmentId: string; role: string }>> {
  const { rows } = await query<{ department_id: string; role: string }>(
    `SELECT dm.department_id, dm.role
       FROM department_members dm
       JOIN departments d ON d.id = dm.department_id
      WHERE dm.user_id = $1 AND d.tenant_id = $2`,
    [userId, tenantId],
  );
  return rows.map((r) => ({ departmentId: r.department_id, role: r.role }));
}

export interface EffectivePermissions {
  superadmin: boolean;
  systemRole: string;
  /** Tenant-wide permissions granted by the system role. */
  global: Permission[];
  /** Permissions granted within specific departments (deptId → permissions). */
  byDepartment: Record<string, Permission[]>;
}

/** Compute everything the UI needs to gate features. */
export async function effectivePermissions(auth: AuthContext): Promise<EffectivePermissions> {
  if (auth.role === 'superadmin') {
    const all = systemRolePermissions('superadmin');
    return { superadmin: true, systemRole: 'superadmin', global: [...all], byDepartment: {} };
  }
  const overrides = await loadOverrides(auth.tenantId);
  const global = systemRolePermissions(auth.role, overrides);
  const deptRoles = await userDepartmentRoles(auth.userId, auth.tenantId);
  const byDepartment: Record<string, Permission[]> = {};
  for (const { departmentId, role } of deptRoles) {
    byDepartment[departmentId] = [...departmentRolePermissions(role, overrides)];
  }
  return { superadmin: false, systemRole: auth.role, global: [...global], byDepartment };
}

/**
 * Can this principal perform `permission`? If `departmentId` is given, a
 * matching department role also satisfies the check; otherwise only the
 * tenant-wide system role counts.
 */
export async function can(
  auth: AuthContext,
  permission: Permission,
  departmentId?: string | null,
): Promise<boolean> {
  if (auth.role === 'superadmin') return true;
  const overrides = await loadOverrides(auth.tenantId);
  if (systemRolePermissions(auth.role, overrides).has(permission)) return true;
  if (departmentId) {
    const deptRoles = await userDepartmentRoles(auth.userId, auth.tenantId);
    const here = deptRoles.find((d) => d.departmentId === departmentId);
    if (here && departmentRolePermissions(here.role, overrides).has(permission)) return true;
  }
  return false;
}

/**
 * For list endpoints: which departments' rows may this principal see for
 * `permission`? Returns 'all' when the system role grants it tenant-wide, else
 * the set of department ids where a department role grants it.
 */
export async function visibleDepartments(
  auth: AuthContext,
  permission: Permission,
): Promise<'all' | string[]> {
  if (auth.role === 'superadmin') return 'all';
  const overrides = await loadOverrides(auth.tenantId);
  if (systemRolePermissions(auth.role, overrides).has(permission)) return 'all';
  const deptRoles = await userDepartmentRoles(auth.userId, auth.tenantId);
  return deptRoles
    .filter((d) => departmentRolePermissions(d.role, overrides).has(permission))
    .map((d) => d.departmentId);
}

/**
 * Fastify preHandler enforcing a permission. For department-scoped routes pass
 * a `getDepartmentId` that extracts the target department from the request.
 */
export function requirePermission(
  permission: Permission,
  getDepartmentId?: (request: import('fastify').FastifyRequest) => string | null | undefined,
): preHandlerHookHandler {
  return async (request) => {
    const auth = requireAuth(request);
    const deptId = getDepartmentId?.(request) ?? null;
    if (!(await can(auth, permission, deptId))) {
      throw forbidden(`Missing permission: ${permission}`);
    }
  };
}
