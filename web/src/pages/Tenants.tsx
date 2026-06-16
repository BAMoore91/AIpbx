import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Building2, Power, PowerOff, LogIn, Pencil } from 'lucide-react';
import { tenantsApi, tenantContext, type Tenant } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { Input, Select } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';

const createSchema = z.object({
  name: z.string().min(1, 'Required'),
  slug: z.string().min(2).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, numbers, hyphens'),
  domain: z.string().optional(),
  plan: z.enum(['free', 'pro', 'enterprise']),
  max_extensions: z.coerce.number().min(1),
  max_concurrent_calls: z.coerce.number().min(1),
  adminEmail: z.string().email('Valid email required'),
  adminPassword: z.string().min(8, 'Min 8 characters'),
});
type CreateForm = z.infer<typeof createSchema>;

const PLAN_OPTS = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
];

const planVariant = (p: string) => (p === 'enterprise' ? 'accent' : p === 'pro' ? 'info' : 'neutral');
const iconBtn = 'p-1.5 rounded-md text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors';

export default function Tenants() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tenants', page],
    queryFn: () => tenantsApi.list({ page, per_page: 20 }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { plan: 'pro', max_extensions: 50, max_concurrent_calls: 30 },
  });

  const create = useMutation({
    mutationFn: (d: CreateForm) =>
      tenantsApi.create({
        name: d.name,
        slug: d.slug,
        domain: d.domain || undefined,
        plan: d.plan,
        max_extensions: d.max_extensions,
        max_concurrent_calls: d.max_concurrent_calls,
        admin: { email: d.adminEmail, password: d.adminPassword },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setCreateOpen(false);
      reset();
      toast.success('Tenant created with admin user');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message ?? 'Create failed'),
  });

  const toggle = useMutation({
    mutationFn: (t: Tenant) => (t.is_active ? tenantsApi.suspend(t.id) : tenantsApi.activate(t.id)),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      toast.success(t.is_active ? 'Tenant activated' : 'Tenant suspended');
    },
  });

  const saveLimits = useMutation({
    mutationFn: (t: Tenant) =>
      tenantsApi.update(t.id, {
        plan: t.plan,
        max_extensions: t.max_extensions,
        max_concurrent_calls: t.max_concurrent_calls,
        domain: t.domain,
        settings: t.settings,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setEditing(null);
      toast.success('Tenant updated');
    },
  });

  const manageAs = (t: Tenant) => {
    tenantContext.set(t.id);
    toast.success(`Now managing ${t.name}`);
    window.location.assign('/dashboard');
  };

  const columns: Column<Tenant>[] = [
    {
      key: 'name',
      header: 'Tenant',
      sortable: true,
      render: (t) => (
        <div>
          <p className="font-semibold text-surface-800 dark:text-surface-200">{t.name}</p>
          <p className="text-xs text-surface-400 font-mono">{t.slug}{t.domain ? ` · ${t.domain}` : ''}</p>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', render: (t) => <Badge variant={planVariant(t.plan)} className="capitalize">{t.plan}</Badge> },
    {
      key: 'usage',
      header: 'Usage',
      render: (t) => (
        <div className="text-xs text-surface-500 space-y-0.5">
          <div>
            Ext <span className={t.usage && t.usage.extensions >= t.max_extensions ? 'text-danger font-semibold' : 'text-surface-700 dark:text-surface-300'}>{t.usage?.extensions ?? 0}</span>/{t.max_extensions}
          </div>
          <div>Calls {t.usage?.active_calls ?? 0}/{t.max_concurrent_calls} · Agents {t.usage?.ai_agents ?? 0}</div>
        </div>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (t) => <Badge variant={t.is_active ? 'success' : 'danger'}>{t.is_active ? 'Active' : 'Suspended'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <div className="flex items-center justify-end gap-1">
          <button className={iconBtn} title="Manage this tenant" onClick={() => manageAs(t)}><LogIn size={15} /></button>
          <button className={iconBtn} title="Edit plan & limits" onClick={() => setEditing(t)}><Pencil size={15} /></button>
          <button
            className={iconBtn}
            title={t.is_active ? 'Suspend' : 'Activate'}
            onClick={() => toggle.mutate(t)}
          >
            {t.is_active ? <PowerOff size={15} className="text-danger" /> : <Power size={15} className="text-emerald-500" />}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Building2 size={20} className="text-primary-500" /> Tenants
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} tenants on this platform</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary"><Plus size={16} /> New Tenant</button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={20}
        onPageChange={setPage}
        emptyMessage="No tenants yet."
      />

      {/* Create tenant + first admin */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Tenant" size="lg">
        <form className="space-y-4" onSubmit={handleSubmit((d) => create.mutate(d))}>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" error={errors.name?.message} {...register('name')} />
            <Input label="Slug" hint="lowercase, used for the SIP domain" error={errors.slug?.message} {...register('slug')} />
          </div>
          <Input label="SIP Domain (optional)" placeholder="acme.pbx.example.com" {...register('domain')} />
          <div className="grid grid-cols-3 gap-3">
            <Select label="Plan" options={PLAN_OPTS} {...register('plan')} />
            <Input label="Max extensions" type="number" error={errors.max_extensions?.message} {...register('max_extensions')} />
            <Input label="Max concurrent calls" type="number" error={errors.max_concurrent_calls?.message} {...register('max_concurrent_calls')} />
          </div>
          <div className="border-t border-surface-200 dark:border-surface-700 pt-3">
            <p className="text-sm font-medium mb-2">First admin user</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Admin email" type="email" error={errors.adminEmail?.message} {...register('adminEmail')} />
              <Input label="Admin password" type="password" error={errors.adminPassword?.message} {...register('adminPassword')} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create tenant'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit plan / limits */}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ''}`} size="md">
        {editing && (
          <div className="space-y-3">
            <Select
              label="Plan"
              options={PLAN_OPTS}
              value={editing.plan}
              onChange={(e) => setEditing({ ...editing, plan: e.target.value as Tenant['plan'] })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Max extensions"
                type="number"
                value={editing.max_extensions}
                onChange={(e) => setEditing({ ...editing, max_extensions: Number(e.target.value) })}
              />
              <Input
                label="Max concurrent calls"
                type="number"
                value={editing.max_concurrent_calls}
                onChange={(e) => setEditing({ ...editing, max_concurrent_calls: Number(e.target.value) })}
              />
            </div>
            <Input
              label="SIP Domain"
              value={editing.domain ?? ''}
              onChange={(e) => setEditing({ ...editing, domain: e.target.value || null })}
            />
            <Input
              label="Data retention (days)"
              type="number"
              hint="Calls, recordings, transcripts & logs older than this are purged. Blank = platform default (90)."
              value={editing.settings?.retention_days ?? ''}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  settings: {
                    ...(editing.settings ?? {}),
                    retention_days: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => saveLimits.mutate(editing)} disabled={saveLimits.isPending}>Save</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
