/**
 * Permission catalog + default role→permission matrices, modeled on 3CX V20
 * access roles but with the V18-style *customizable* matrix that teams asked
 * for. Two role planes:
 *
 *   - SYSTEM roles (users.role): tenant-wide. admin = "System Owner",
 *     supervisor = "System Admin". superadmin is platform-wide (all perms).
 *   - DEPARTMENT roles (department_members.role): scoped to one department.
 *     owner = dept admin + manager, manager, receptionist, user.
 *
 * Effective permission for (user, permission, department?) =
 *   system-role grants it  OR  the user's role in that department grants it.
 *
 * Per-tenant `role_permissions` rows override these defaults (true/false),
 * which is how a tenant customizes what each role may do.
 */

export const PERMISSIONS = [
  // ── Visibility / management data (the 3CX "owner sees recordings" plane) ──
  { key: 'switchboard.view', category: 'Visibility', label: 'See live/switchboard calls' },
  { key: 'cdr.view', category: 'Visibility', label: 'View call logs (CDR) & reports' },
  { key: 'recordings.view', category: 'Visibility', label: 'Listen to / download recordings' },
  { key: 'transcripts.view', category: 'Visibility', label: 'View call transcripts' },
  { key: 'chat.view', category: 'Visibility', label: 'View chat / messages' },
  { key: 'voicemail.view', category: 'Visibility', label: 'Access voicemail' },
  // ── Administration ──
  { key: 'extensions.manage', category: 'Administration', label: 'Manage extensions' },
  { key: 'users.manage', category: 'Administration', label: 'Create / modify / delete users' },
  { key: 'users.elevate', category: 'Administration', label: 'Change user roles' },
  { key: 'routing.manage', category: 'Administration', label: 'Manage routing (DIDs, IVRs, time conditions)' },
  { key: 'queues.manage', category: 'Administration', label: 'Manage queues & ring groups' },
  { key: 'trunks.manage', category: 'Administration', label: 'Manage SIP trunks & carriers' },
  { key: 'ai.manage', category: 'Administration', label: 'Manage AI agents & knowledge bases' },
  // ── Organization (tenant/system only) ──
  { key: 'departments.manage', category: 'Organization', label: 'Manage departments & membership' },
  { key: 'roles.manage', category: 'Organization', label: 'Customize role permissions' },
  { key: 'settings.manage', category: 'Organization', label: 'Manage org settings' },
  { key: 'billing.view', category: 'Organization', label: 'View plan & billing' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

export type SystemRole = 'admin' | 'supervisor' | 'agent' | 'user';
export type DepartmentRole = 'owner' | 'manager' | 'receptionist' | 'user';
export const DEPARTMENT_ROLES: DepartmentRole[] = ['owner', 'manager', 'receptionist', 'user'];
export const CUSTOMIZABLE_SYSTEM_ROLES: SystemRole[] = ['supervisor', 'agent', 'user'];
// Owner mirrors 3CX (dept admin+manager, not customizable); the rest are.
export const CUSTOMIZABLE_DEPARTMENT_ROLES: DepartmentRole[] = ['manager', 'receptionist', 'user'];

const ALL = new Set<Permission>(ALL_PERMISSIONS);

/** Default permissions for tenant-wide (system) roles. admin = System Owner. */
const SYSTEM_DEFAULTS: Record<SystemRole, Set<Permission>> = {
  // System Owner — everything within the tenant.
  admin: ALL,
  // System Admin — manage the system, but not the management-sensitive data
  // (recordings/transcripts/chat) nor org-level controls.
  supervisor: new Set<Permission>([
    'switchboard.view',
    'cdr.view',
    'voicemail.view',
    'extensions.manage',
    'users.manage',
    'routing.manage',
    'queues.manage',
    'trunks.manage',
    'ai.manage',
  ]),
  // Agents — operate, see live calls and their voicemail.
  agent: new Set<Permission>(['switchboard.view', 'voicemail.view']),
  // Plain users — their own profile/voicemail only.
  user: new Set<Permission>(['voicemail.view']),
};

/** Default permissions for department-scoped roles (apply within the dept). */
const DEPARTMENT_DEFAULTS: Record<DepartmentRole, Set<Permission>> = {
  // Owner = department administrator + manager.
  owner: new Set<Permission>([
    'switchboard.view', 'cdr.view', 'recordings.view', 'transcripts.view', 'chat.view',
    'voicemail.view', 'extensions.manage', 'users.manage', 'users.elevate',
    'routing.manage', 'queues.manage', 'ai.manage',
  ]),
  // Manager — user config + reports + recordings (3CX manager rights).
  manager: new Set<Permission>([
    'switchboard.view', 'cdr.view', 'recordings.view', 'transcripts.view', 'chat.view',
    'voicemail.view', 'users.manage', 'users.elevate', 'queues.manage',
  ]),
  // Receptionist — operate the switchboard, see the department's calls & chat.
  receptionist: new Set<Permission>(['switchboard.view', 'cdr.view', 'chat.view', 'voicemail.view']),
  // User — own voicemail only.
  user: new Set<Permission>(['voicemail.view']),
};

export interface RoleOverride {
  scope: 'system' | 'department';
  role: string;
  permission: Permission;
  allowed: boolean;
}

function applyOverrides(
  base: Set<Permission>,
  overrides: RoleOverride[],
  scope: 'system' | 'department',
  role: string,
): Set<Permission> {
  const out = new Set(base);
  for (const o of overrides) {
    if (o.scope === scope && o.role === role) {
      if (o.allowed) out.add(o.permission);
      else out.delete(o.permission);
    }
  }
  return out;
}

/** Effective permission set for a system role, after tenant overrides. */
export function systemRolePermissions(
  role: string,
  overrides: RoleOverride[] = [],
): Set<Permission> {
  if (role === 'superadmin') return new Set(ALL);
  const base = SYSTEM_DEFAULTS[role as SystemRole] ?? new Set<Permission>();
  return applyOverrides(base, overrides, 'system', role);
}

/** Effective permission set for a department role, after tenant overrides. */
export function departmentRolePermissions(
  role: string,
  overrides: RoleOverride[] = [],
): Set<Permission> {
  const base = DEPARTMENT_DEFAULTS[role as DepartmentRole] ?? new Set<Permission>();
  return applyOverrides(base, overrides, 'department', role);
}

/** The default matrix (no overrides) — used to render the editor's baseline. */
export function defaultMatrix(): {
  system: Record<string, Permission[]>;
  department: Record<string, Permission[]>;
} {
  const sys: Record<string, Permission[]> = {};
  for (const r of ['admin', 'supervisor', 'agent', 'user'] as SystemRole[]) {
    sys[r] = [...SYSTEM_DEFAULTS[r]];
  }
  const dep: Record<string, Permission[]> = {};
  for (const r of DEPARTMENT_ROLES) dep[r] = [...DEPARTMENT_DEFAULTS[r]];
  return { system: sys, department: dep };
}
