import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Search, Users as UsersIcon } from 'lucide-react';
import { usersApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { User } from '@/lib/types';
import { format } from 'date-fns';

const schema = z.object({
  email: z.string().email('Valid email required'),
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  role: z.enum(['admin', 'supervisor', 'agent', 'viewer']),
  password: z.string().min(8, 'Minimum 8 characters').optional().or(z.literal('')),
});
type FormData = z.infer<typeof schema>;

const ROLE_VARIANTS: Record<string, 'primary' | 'warning' | 'info' | 'neutral'> = {
  superadmin: 'primary', admin: 'primary', supervisor: 'warning', agent: 'info', viewer: 'neutral',
};

export default function Users() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, search],
    queryFn: () => usersApi.list({ page, per_page: 20, search }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'agent' },
  });

  const upsert = useMutation({
    mutationFn: (d: FormData) => {
      const body = { ...d, password: d.password || undefined };
      return editing ? usersApi.update(editing.id, body) : usersApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setModalOpen(false);
      toast.success(editing ? 'User updated' : 'User created');
    },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
      toast.success('User deleted');
    },
    onError: () => toast.error('Delete failed'),
  });

  const openCreate = () => {
    setEditing(null);
    reset({ role: 'agent' });
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    reset({ email: u.email, first_name: u.first_name, last_name: u.last_name, role: u.role as FormData['role'], password: '' });
    setModalOpen(true);
  };

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
            {row.first_name[0]}{row.last_name[0]}
          </div>
          <div>
            <p className="font-medium text-surface-800 dark:text-surface-200">{row.first_name} {row.last_name}</p>
            <p className="text-xs text-surface-400">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <Badge variant={ROLE_VARIANTS[row.role] ?? 'neutral'} className="capitalize">{row.role}</Badge>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Active' : 'Disabled'}</Badge>
      ),
    },
    {
      key: 'mfa_enabled',
      header: 'MFA',
      render: (row) => (
        <Badge variant={row.mfa_enabled ? 'success' : 'neutral'}>{row.mfa_enabled ? 'Enabled' : 'Off'}</Badge>
      ),
    },
    {
      key: 'last_login_at',
      header: 'Last Login',
      render: (row) => (
        <span className="text-xs text-surface-500">
          {row.last_login_at ? format(new Date(row.last_login_at), 'MMM d, HH:mm') : 'Never'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <UsersIcon size={20} className="text-primary-500" /> Users
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} users</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={16} /> New User
        </button>
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          type="search"
          placeholder="Search users…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input pl-9 text-sm"
        />
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={20}
        onPageChange={setPage}
        emptyMessage="No users found."
        actions={(row) => (
          <>
            <button onClick={() => openEdit(row)} className="btn-ghost btn-icon btn-sm"><Pencil size={14} /></button>
            <button onClick={() => setDeleteTarget(row)} className="btn-ghost btn-icon btn-sm text-danger"><Trash2 size={14} /></button>
          </>
        )}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit User' : 'New User'}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create User'}
            </button>
          </>
        }
      >
        <form className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="First Name" error={errors.first_name?.message} {...register('first_name')} />
            <Input label="Last Name" error={errors.last_name?.message} {...register('last_name')} />
          </div>
          <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
          <Input
            label={editing ? 'New Password (leave blank to keep)' : 'Password'}
            type="password"
            error={errors.password?.message}
            {...register('password')}
          />
          <Select
            label="Role"
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'supervisor', label: 'Supervisor' },
              { value: 'agent', label: 'Agent' },
              { value: 'viewer', label: 'Viewer' },
            ]}
            error={errors.role?.message}
            {...register('role')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete User"
        message={`Remove ${deleteTarget?.first_name} ${deleteTarget?.last_name}? They will lose access immediately.`}
        confirmLabel="Delete"
        loading={deleteMut.isPending}
      />
    </div>
  );
}
