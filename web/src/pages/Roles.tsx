import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Save, RotateCcw, Lock } from 'lucide-react';
import { accessApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import { clsx } from 'clsx';
import type { RoleMatrixEntry } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
type Scope = 'system' | 'department';

const SYSTEM_ROLES = ['admin', 'supervisor', 'agent', 'user'] as const;
const DEPT_ROLES = ['owner', 'manager', 'receptionist', 'user'] as const;

// ─── Per-role editor section ──────────────────────────────────────────────────
function RoleMatrix({
  scope,
  roles,
  matrix,
  catalog,
}: {
  scope: Scope;
  roles: readonly string[];
  matrix: Record<string, RoleMatrixEntry>;
  catalog: Array<{ key: string; category: string; label: string }>;
}) {
  const qc = useQueryClient();

  // Local override state: role -> Set<permission>
  const [localPerms, setLocalPerms] = useState<Record<string, Set<string>>>({});

  // Merge server state with local overrides
  function getPerms(role: string): Set<string> {
    if (localPerms[role]) return localPerms[role];
    return new Set(matrix[role]?.permissions ?? []);
  }

  function togglePerm(role: string, perm: string) {
    const current = new Set(getPerms(role));
    if (current.has(perm)) current.delete(perm);
    else current.add(perm);
    setLocalPerms((prev) => ({ ...prev, [role]: current }));
  }

  function isDirty(role: string): boolean {
    if (!localPerms[role]) return false;
    const server = new Set(matrix[role]?.permissions ?? []);
    const local = localPerms[role];
    if (local.size !== server.size) return true;
    for (const p of local) if (!server.has(p)) return true;
    return false;
  }

  const saveMut = useMutation({
    mutationFn: ({ role, permissions }: { role: string; permissions: string[] }) =>
      accessApi.setRole(scope, role, permissions),
    onSuccess: (_, { role }) => {
      qc.invalidateQueries({ queryKey: ['access-matrix'] });
      setLocalPerms((prev) => {
        const next = { ...prev };
        delete next[role];
        return next;
      });
      toast.success(`${role} permissions saved`);
    },
    onError: () => toast.error('Save failed'),
  });

  const resetMut = useMutation({
    mutationFn: (role: string) => accessApi.resetRole(scope, role),
    onSuccess: (_, role) => {
      qc.invalidateQueries({ queryKey: ['access-matrix'] });
      setLocalPerms((prev) => {
        const next = { ...prev };
        delete next[role];
        return next;
      });
      toast.success(`${role} reset to defaults`);
    },
    onError: () => toast.error('Reset failed'),
  });

  // Group catalog by category
  const categories = Array.from(new Set(catalog.map((c) => c.category)));

  const colCount = roles.length + 1; // +1 for permission label column

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-surface-200 dark:border-surface-700">
            <th className="text-left py-2 px-3 text-xs font-semibold text-surface-500 uppercase tracking-wider w-48">
              Permission
            </th>
            {roles.map((role) => {
              const entry = matrix[role];
              const locked = entry?.editable === false;
              const dirty = isDirty(role);
              return (
                <th key={role} className="py-2 px-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-surface-700 dark:text-surface-300 capitalize">
                        {role}
                      </span>
                      {locked && (
                        <span title="Read-only role">
                          <Lock size={10} className="text-surface-400" />
                        </span>
                      )}
                    </div>
                    {!locked && (
                      <div className="flex gap-1">
                        <button
                          className={clsx(
                            'px-2 py-0.5 rounded text-2xs font-medium flex items-center gap-0.5 transition-colors',
                            dirty
                              ? 'bg-primary-600 text-white hover:bg-primary-700'
                              : 'bg-surface-200 dark:bg-surface-700 text-surface-500 cursor-not-allowed opacity-50'
                          )}
                          disabled={!dirty || saveMut.isPending}
                          onClick={() =>
                            saveMut.mutate({
                              role,
                              permissions: Array.from(getPerms(role)),
                            })
                          }
                          title="Save changes"
                        >
                          <Save size={9} /> Save
                        </button>
                        <button
                          className="px-2 py-0.5 rounded text-2xs font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 flex items-center gap-0.5 transition-colors"
                          onClick={() => resetMut.mutate(role)}
                          disabled={resetMut.isPending}
                          title="Reset to defaults"
                        >
                          <RotateCcw size={9} /> Reset
                        </button>
                      </div>
                    )}
                    {locked && (
                      <Badge variant="neutral" className="text-2xs">Full / locked</Badge>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const catItems = catalog.filter((c) => c.category === cat);
            return (
              <>
                <tr key={`cat-${cat}`}>
                  <td
                    colSpan={colCount}
                    className="bg-surface-50 dark:bg-surface-800/50 px-3 py-1.5 text-2xs font-semibold text-surface-500 uppercase tracking-wider"
                  >
                    {cat}
                  </td>
                </tr>
                {catItems.map((item) => (
                  <tr
                    key={item.key}
                    className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
                  >
                    <td className="py-2 px-3 text-surface-700 dark:text-surface-300 text-xs">
                      {item.label}
                      <span className="ml-1 text-2xs text-surface-400 font-mono">({item.key})</span>
                    </td>
                    {roles.map((role) => {
                      const entry = matrix[role];
                      const locked = entry?.editable === false;
                      const perms = getPerms(role);
                      const checked = locked ? true : perms.has(item.key);
                      return (
                        <td key={role} className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 cursor-pointer disabled:cursor-not-allowed accent-primary-600"
                            checked={checked}
                            disabled={locked}
                            onChange={() => !locked && togglePerm(role, item.key)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Roles() {
  const { can, isLoading: permLoading } = usePermissions();
  const canManage = can('roles.manage');

  const { data: matrixData, isLoading } = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => accessApi.matrix(),
    staleTime: 60_000,
  });

  if (permLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldCheck size={40} className="text-surface-400 mx-auto mb-3" />
          <p className="text-surface-600 dark:text-surface-400 font-medium">Access denied</p>
          <p className="text-sm text-surface-400 mt-1">You need the roles.manage permission to access this page.</p>
        </div>
      </div>
    );
  }

  if (!matrixData) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
          <ShieldCheck size={20} className="text-primary-500" /> Role Permissions
        </h1>
        <p className="text-sm text-surface-500 mt-0.5">
          Customize which permissions each role has. Locked roles (admin, owner) have full access.
        </p>
      </div>

      {/* System Roles */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">System Roles</h2>
          <p className="text-xs text-surface-500 mt-0.5">Apply globally to all users regardless of department.</p>
        </div>
        <div className="p-4">
          <RoleMatrix
            scope="system"
            roles={SYSTEM_ROLES}
            matrix={matrixData.system}
            catalog={matrixData.catalog}
          />
        </div>
      </div>

      {/* Department Roles */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Department Roles</h2>
          <p className="text-xs text-surface-500 mt-0.5">Scoped to a specific department membership.</p>
        </div>
        <div className="p-4">
          <RoleMatrix
            scope="department"
            roles={DEPT_ROLES}
            matrix={matrixData.department}
            catalog={matrixData.catalog}
          />
        </div>
      </div>
    </div>
  );
}
