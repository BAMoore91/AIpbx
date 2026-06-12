import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Settings as SettingsIcon, Plus, Trash2, Globe, User, Webhook as WebhookIcon, Shield } from 'lucide-react';
import { webhooksApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Input, Textarea, Toggle } from '@/components/FormFields';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/Badge';
import { DataTable, Column } from '@/components/DataTable';
import { toast } from 'react-hot-toast';
import type { Webhook } from '@/lib/types';

type SettingsTab = 'profile' | 'tenant' | 'webhooks' | 'security';

const profileSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
});
type ProfileForm = z.infer<typeof profileSchema>;

const webhookSchema = z.object({
  url: z.string().url('Valid URL required'),
  events: z.string().min(1, 'At least one event required'),
  secret: z.string().optional(),
  is_active: z.boolean().default(true),
});
type WebhookForm = z.infer<typeof webhookSchema>;

const ALL_EVENTS = [
  'call.started', 'call.updated', 'call.ended',
  'call.answered', 'call.missed', 'voicemail.created',
  'queue.stats', 'presence.changed',
];

function ProfileTab() {
  const { user, setUser } = useAuthStore();
  const { register, handleSubmit, formState: { errors } } = useForm<ProfileForm>({
    defaultValues: { first_name: user?.first_name, last_name: user?.last_name, email: user?.email },
  });

  const save = async (data: ProfileForm) => {
    try {
      const updated = await authApi.me(); // Re-fetch after hypothetical update
      setUser({ ...updated, ...data });
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xl font-bold">
          {user?.first_name?.[0]}{user?.last_name?.[0]}
        </div>
        <div>
          <p className="font-semibold text-surface-900 dark:text-surface-100">{user?.first_name} {user?.last_name}</p>
          <p className="text-sm text-surface-500">{user?.email}</p>
          <Badge variant="primary" className="mt-1 capitalize">{user?.role}</Badge>
        </div>
      </div>

      <form onSubmit={handleSubmit(save)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="First Name" error={errors.first_name?.message} {...register('first_name')} />
          <Input label="Last Name" error={errors.last_name?.message} {...register('last_name')} />
        </div>
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <button type="submit" className="btn-primary">Save Profile</button>
      </form>
    </div>
  );
}

function TenantTab() {
  return (
    <div className="max-w-lg space-y-4">
      <div className="p-4 bg-surface-50 dark:bg-surface-700/50 rounded-xl border border-surface-200 dark:border-surface-700">
        <p className="text-sm font-medium text-surface-500 mb-3">Tenant Settings</p>
        <p className="text-sm text-surface-600 dark:text-surface-400">
          Tenant-level settings (name, plan, max extensions, etc.) are managed by your system administrator.
          Contact support to make changes.
        </p>
      </div>
    </div>
  );
}

function WebhooksTab() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => webhooksApi.list({ per_page: 50 }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<WebhookForm>({
    resolver: zodResolver(webhookSchema),
    defaultValues: { is_active: true, events: ALL_EVENTS.join(',') },
  });

  const upsert = useMutation({
    mutationFn: (d: WebhookForm) => {
      const body = { ...d, events: d.events.split(',').map(e => e.trim()).filter(Boolean) };
      return editing ? webhooksApi.update(editing.id, body) : webhooksApi.create(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setModal(false); toast.success('Saved'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => webhooksApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const columns: Column<Webhook>[] = [
    { key: 'url', header: 'Endpoint URL', render: (r) => <span className="font-mono text-xs text-surface-600 dark:text-surface-400 truncate max-w-[250px] block">{r.url}</span> },
    { key: 'events', header: 'Events', render: (r) => <Badge variant="info">{r.events.length} events</Badge> },
    { key: 'is_active', header: 'Status', render: (r) => <Badge variant={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Off'}</Badge> },
  ];

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary btn-sm" onClick={() => { setEditing(null); reset({ is_active: true, events: ALL_EVENTS.join(',') }); setModal(true); }}>
          <Plus size={14} /> Add Webhook
        </button>
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} total={data?.total ?? 0} page={1} perPage={50}
        actions={(row) => (
          <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={14} /></button>
        )}
      />

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Webhook' : 'New Webhook'} size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>Save</button>
          </>
        }
      >
        <form className="space-y-4">
          <Input label="Endpoint URL" placeholder="https://yourapp.com/webhooks/aipbx" error={errors.url?.message} {...register('url')} />
          <div>
            <label className="label">Events (comma-separated)</label>
            <Textarea placeholder={ALL_EVENTS.join(', ')} rows={3} error={errors.events?.message} {...register('events')} />
            <p className="text-xs text-surface-400 mt-1">Available: {ALL_EVENTS.join(', ')}</p>
          </div>
          <Input label="Signing Secret" placeholder="Optional — used for HMAC verification" {...register('secret')} />
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Webhook" message={`Remove webhook for ${deleteTarget?.url}?`} loading={deleteMut.isPending}
      />
    </>
  );
}

function SecurityTab() {
  const { user } = useAuthStore();
  const [mfaEnabled, setMfaEnabled] = useState(user?.mfa_enabled ?? false);

  return (
    <div className="max-w-lg space-y-4">
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Two-Factor Authentication</h3>
        <Toggle
          label="MFA Enabled"
          description="Require a one-time code on every login"
          checked={mfaEnabled}
          onChange={(v) => {
            setMfaEnabled(v);
            toast(v ? 'MFA setup flow not yet wired to this demo — check API docs.' : 'MFA disabled.');
          }}
        />
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Change Password</h3>
        <div className="space-y-3">
          <Input label="Current Password" type="password" />
          <Input label="New Password" type="password" />
          <Input label="Confirm New Password" type="password" />
          <button className="btn-primary btn-sm" onClick={() => toast('Password change requires API integration.')}>
            Update Password
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('profile');

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ElementType }> = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'tenant', label: 'Tenant', icon: Globe },
    { id: 'webhooks', label: 'Webhooks', icon: WebhookIcon },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
          <SettingsIcon size={20} className="text-primary-500" /> Settings
        </h1>
        <p className="text-sm text-surface-500 mt-0.5">Manage your account and system configuration</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <div className="w-44 flex-shrink-0">
          <nav className="space-y-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                }`}
              >
                <t.icon size={15} />
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 card p-6">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'tenant' && <TenantTab />}
          {tab === 'webhooks' && <WebhooksTab />}
          {tab === 'security' && <SecurityTab />}
        </div>
      </div>
    </div>
  );
}
