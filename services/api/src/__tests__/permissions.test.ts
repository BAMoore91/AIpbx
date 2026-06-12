import { describe, it, expect } from 'vitest';
import {
  systemRolePermissions,
  departmentRolePermissions,
  defaultMatrix,
  ALL_PERMISSIONS,
  type RoleOverride,
} from '../auth/permissions.js';

describe('RBAC permission matrix (3CX-style)', () => {
  it('System Owner (admin) has every permission', () => {
    const p = systemRolePermissions('admin');
    for (const perm of ALL_PERMISSIONS) expect(p.has(perm)).toBe(true);
  });

  it('superadmin is all-powerful regardless of overrides', () => {
    const p = systemRolePermissions('superadmin', [
      { scope: 'system', role: 'superadmin', permission: 'recordings.view', allowed: false },
    ]);
    expect(p.has('recordings.view')).toBe(true);
  });

  it('System Admin (supervisor) manages but cannot see recordings by default', () => {
    const p = systemRolePermissions('supervisor');
    expect(p.has('extensions.manage')).toBe(true);
    expect(p.has('routing.manage')).toBe(true);
    expect(p.has('recordings.view')).toBe(false);
    expect(p.has('roles.manage')).toBe(false);
  });

  it('Department Owner gets recordings within the department; receptionist does not', () => {
    expect(departmentRolePermissions('owner').has('recordings.view')).toBe(true);
    expect(departmentRolePermissions('receptionist').has('recordings.view')).toBe(false);
    expect(departmentRolePermissions('receptionist').has('switchboard.view')).toBe(true);
  });

  it('Manager can manage/elevate users and see recordings, but not extensions', () => {
    const m = departmentRolePermissions('manager');
    expect(m.has('users.manage')).toBe(true);
    expect(m.has('users.elevate')).toBe(true);
    expect(m.has('recordings.view')).toBe(true);
    expect(m.has('extensions.manage')).toBe(false);
  });

  it('plain user has only their own voicemail', () => {
    const u = systemRolePermissions('user');
    expect([...u]).toEqual(['voicemail.view']);
  });

  it('tenant overrides add and remove permissions', () => {
    const overrides: RoleOverride[] = [
      { scope: 'department', role: 'receptionist', permission: 'recordings.view', allowed: true }, // grant
      { scope: 'system', role: 'supervisor', permission: 'extensions.manage', allowed: false }, // revoke
    ];
    expect(departmentRolePermissions('receptionist', overrides).has('recordings.view')).toBe(true);
    expect(systemRolePermissions('supervisor', overrides).has('extensions.manage')).toBe(false);
  });

  it('default matrix exposes every role with a concrete permission list', () => {
    const m = defaultMatrix();
    expect(Object.keys(m.system)).toEqual(['admin', 'supervisor', 'agent', 'user']);
    expect(Object.keys(m.department)).toEqual(['owner', 'manager', 'receptionist', 'user']);
    expect(m.department.owner.length).toBeGreaterThan(m.department.receptionist.length);
  });
});
