import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Users, UserPlus, UserMinus, Building } from 'lucide-react';
import { departmentsApi, usersApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import { usePermissions } from '@/hooks/usePermissions';
import type { Department, DepartmentDetail, DepartmentMember } from '@/lib/api';

// ─── Schemas ──────────────────────────────────────────────────────────────────
const deptSchema = z.object({
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
  manager_user_id: z.string().optional(),
});
type DeptFormData = z.infer<typeof deptSchema>;

const MEMBER_ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'user', label: 'User' },
];

const MEMBER_ROLE_VARIANTS: Record<string, 'primary' | 'accent' | 'info' | 'neutral'> = {
  owner: 'primary',
  manager: 'accent',
  receptionist: 'info',
  user: 'neutral',
};

// ─── Members Panel ────────────────────────────────────────────────────────────
function MembersPanel({
  dept,
  canManage,
}: {
  dept: DepartmentDetail;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<DepartmentMember['role']>('user');

  const { data: usersData } = useQuery({
    queryKey: ['users-list-all'],
    queryFn: () => usersApi.list({ per_page: 200 }),
  });

  const setMemberMut = useMutation({
    mutationFn: (body: { user_id: string; role: DepartmentMember['role'] }) =>
      departmentsApi.setMember(dept.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['department-detail', dept.id] });
      setAddUserId('');
      setAddRole('user');
      toast.success('Member updated');
    },
    onError: () => toast.error('Failed to update member'),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => departmentsApi.removeMember(dept.id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['department-detail', dept.id] });
      toast.success('Member removed');
    },
    onError: () => toast.error('Failed to remove member'),
  });

  const existingUserIds = new Set(dept.members.map((m) => m.user_id));
  const availableUsers = (usersData?.data ?? []).filter((u) => !existingUserIds.has(u.id));

  return (
    <div className="space-y-4">
      {/* Current members */}
      <div className="space-y-2">
        {dept.members.length === 0 && (
          <p className="text-sm text-surface-400 py-3 text-center">No members assigned</p>
        )}
        {dept.members.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-700/50 border border-surface-100 dark:border-surface-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
                <Users size={12} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                  {m.first_name} {m.last_name}
                </p>
                <p className="text-xs text-surface-400">{m.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canManage ? (
                <select
                  className="select text-xs py-1 h-7"
                  value={m.role}
                  onChange={(e) =>
                    setMemberMut.mutate({
                      user_id: m.user_id,
                      role: e.target.value as DepartmentMember['role'],
                    })
                  }
                >
                  {MEMBER_ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant={MEMBER_ROLE_VARIANTS[m.role] ?? 'neutral'}>{m.role}</Badge>
              )}
              {canManage && (
                <button
                  className="p-1.5 rounded-lg text-surface-400 hover:text-danger hover:bg-danger/10 transition-colors"
                  title="Remove member"
                  onClick={() => removeMemberMut.mutate(m.user_id)}
                  disabled={removeMemberMut.isPending}
                >
                  <UserMinus size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add member */}
      {canManage && (
        <div className="border-t border-surface-200 dark:border-surface-700 pt-4">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
            Add Member
          </p>
          <div className="flex gap-2">
            <select
              className="select flex-1 text-sm"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="">Select user…</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.first_name} {u.last_name} ({u.email})
                </option>
              ))}
            </select>
            <select
              className="select text-sm"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as DepartmentMember['role'])}
            >
              {MEMBER_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className="btn-primary btn-sm flex items-center gap-1"
              disabled={!addUserId || setMemberMut.isPending}
              onClick={() =>
                addUserId && setMemberMut.mutate({ user_id: addUserId, role: addRole })
              }
            >
              <UserPlus size={13} /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Departments() {
  const qc = useQueryClient();
  const { can, isLoading: permLoading } = usePermissions();
  const canManage = can('departments.manage');

  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [membersTarget, setMembersTarget] = useState<Department | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['departments', page],
    queryFn: () => departmentsApi.list({ page, per_page: 20 }),
  });

  const { data: deptDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['department-detail', membersTarget?.id],
    queryFn: () => departmentsApi.get(membersTarget!.id),
    enabled: Boolean(membersTarget),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list-all'],
    queryFn: () => usersApi.list({ per_page: 200 }),
    enabled: modalOpen,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<DeptFormData>({
    resolver: zodResolver(deptSchema),
  });

  const upsert = useMutation({
    mutationFn: (d: DeptFormData) =>
      editing
        ? departmentsApi.update(editing.id, d)
        : departmentsApi.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setModalOpen(false);
      setEditing(null);
      reset();
      toast.success(editing ? 'Department updated' : 'Department created');
    },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => departmentsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setDeleteTarget(null);
      toast.success('Department deleted');
    },
    onError: () => toast.error('Delete failed'),
  });

  const openCreate = () => {
    setEditing(null);
    reset({ name: '', description: '', manager_user_id: '' });
    setModalOpen(true);
  };

  const openEdit = (dept: Department) => {
    setEditing(dept);
    reset({
      name: dept.name,
      description: dept.description ?? '',
      manager_user_id: dept.manager_user_id ?? '',
    });
    setModalOpen(true);
  };

  const columns: Column<Department>[] = [
    {
      key: 'name',
      header: 'Department',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center flex-shrink-0">
            <Building size={14} className="text-primary-500" />
          </div>
          <div>
            <p className="font-semibold text-surface-800 dark:text-surface-200">{row.name}</p>
            {row.description && (
              <p className="text-xs text-surface-400 truncate max-w-[200px]">{row.description}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'member_count',
      header: 'Members',
      render: (row) => (
        <Badge variant="info">{row.member_count} members</Badge>
      ),
    },
    {
      key: 'extension_count',
      header: 'Extensions',
      render: (row) => (
        <Badge variant="neutral">{row.extension_count} ext</Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (row) => (
        <span className="text-xs text-surface-400">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

  if (permLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Building size={20} className="text-primary-500" /> Departments
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {data?.total ?? 0} departments configured
          </p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} /> New Department
          </button>
        )}
      </div>

      {!canManage && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
          You have read-only access to departments. Contact an admin to make changes.
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={20}
        onPageChange={setPage}
        emptyMessage="No departments configured."
        actions={(row) => (
          <>
            <button
              className="btn-ghost btn-sm text-xs flex items-center gap-1"
              title="Manage members"
              onClick={() => setMembersTarget(row)}
            >
              <Users size={13} /> Members
            </button>
            {canManage && (
              <>
                <button
                  className="p-1.5 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                  title="Edit"
                  onClick={() => openEdit(row)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="p-1.5 rounded-lg text-surface-400 hover:text-danger hover:bg-danger/10 transition-colors"
                  title="Delete"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </>
        )}
      />

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        title={editing ? `Edit Department — ${editing.name}` : 'New Department'}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleSubmit((d) => upsert.mutate(d))}
              disabled={upsert.isPending}
            >
              {upsert.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Department'}
            </button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((d) => upsert.mutate(d))}>
          <Input
            label="Department Name"
            placeholder="Sales"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Description"
            placeholder="Optional description"
            {...register('description')}
          />
          <Select
            label="Manager"
            placeholder="— No manager —"
            options={(usersData?.data ?? []).map((u) => ({
              value: u.id,
              label: `${u.first_name} ${u.last_name} (${u.email})`,
            }))}
            {...register('manager_user_id')}
          />
        </form>
      </Modal>

      {/* Members Modal */}
      <Modal
        open={Boolean(membersTarget)}
        onClose={() => setMembersTarget(null)}
        title={`Members — ${membersTarget?.name ?? ''}`}
        size="lg"
        footer={
          <button className="btn-secondary" onClick={() => setMembersTarget(null)}>
            Close
          </button>
        }
      >
        {detailLoading ? (
          <div className="py-8 text-center">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : deptDetail ? (
          <MembersPanel dept={deptDetail} canManage={canManage} />
        ) : null}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Department"
        message={`Delete department "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMut.isPending}
      />
    </div>
  );
}
