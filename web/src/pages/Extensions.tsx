import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Search, Phone, RefreshCw, Copy, UserPlus, Check } from 'lucide-react';
import { extensionsApi, departmentsApi, usersApi, type UserProvisionResult } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select, Toggle } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { Extension } from '@/lib/types';

const schema = z.object({
  extension: z.string().min(2, 'Required'),
  display_name: z.string().min(1, 'Required'),
  sip_username: z.string().min(1, 'Required'),
  sip_password: z.string().min(6, 'Min 6 chars'),
  type: z.enum(['softphone', 'webrtc', 'desk', 'ai_agent']),
  voicemail_enabled: z.boolean(),
  call_recording: z.enum(['always', 'on-demand', 'never']),
  dnd: z.boolean(),
  ring_timeout: z.coerce.number().min(5).max(120),
  department_id: z.string().optional(),
  // Optional web-user association (used on create only).
  account_email: z.string().email('Invalid email').optional().or(z.literal('')),
  account_first_name: z.string().optional(),
  account_last_name: z.string().optional(),
  account_role: z.enum(['admin', 'supervisor', 'agent', 'user']).optional(),
  account_mode: z.enum(['generate', 'invite']).optional(),
});

type FormData = z.infer<typeof schema>;

const TYPE_LABELS: Record<string, string> = {
  softphone: 'Softphone', webrtc: 'WebRTC', desk: 'Desk Phone', ai_agent: 'AI Agent',
};
const RECORDING_LABELS: Record<string, string> = {
  always: 'Always', 'on-demand': 'On Demand', never: 'Disabled',
};

export default function Extensions() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Extension | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Extension | null>(null);
  const [provisionResult, setProvisionResult] = useState<UserProvisionResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['extensions', page, search],
    queryFn: () => extensionsApi.list({ page, per_page: 20, search }),
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => departmentsApi.list({ per_page: 200 }),
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'webrtc',
      voicemail_enabled: true,
      call_recording: 'on-demand',
      dnd: false,
      ring_timeout: 30,
      account_role: 'agent',
      account_mode: 'generate',
    },
  });

  const upsert = useMutation({
    mutationFn: async (d: FormData) => {
      const {
        account_email, account_first_name, account_last_name, account_role, account_mode,
        ...extData
      } = d;
      const body = { ...extData, department_id: extData.department_id || null };

      // 1) Save the extension itself. A failure here is a real "save failed".
      const ext = editing
        ? await extensionsApi.update(editing.id, body)
        : await extensionsApi.create(body);

      // 2) Optionally associate a web user. This is a SEPARATE step: if it
      //    fails, the extension is already saved, so surface a precise warning
      //    rather than a misleading "save failed".
      const wantsAccount =
        Boolean(account_email && account_email.trim()) && !editing?.user_id;
      if (!wantsAccount) return { provision: null as UserProvisionResult | null, accountError: null as string | null };

      try {
        const provision = await usersApi.provision({
          email: account_email!.trim(),
          first_name: account_first_name || undefined,
          last_name: account_last_name || undefined,
          role: account_role ?? 'agent',
          mode: account_mode ?? 'generate',
          extension_id: ext.id,
        });
        return { provision, accountError: null as string | null };
      } catch (e: unknown) {
        const r = (e as { response?: { status?: number; data?: { error?: { message?: string } } } })?.response;
        const reason = r?.data?.error?.message ?? (r ? `HTTP ${r.status}` : 'network error');
        return { provision: null as UserProvisionResult | null, accountError: reason };
      }
    },
    onSuccess: ({ provision, accountError }) => {
      queryClient.invalidateQueries({ queryKey: ['extensions'] });
      const wasEditing = Boolean(editing);
      setModalOpen(false);
      setEditing(null);
      reset();
      toast.success(wasEditing ? 'Extension updated' : 'Extension created');
      if (provision) {
        setCopied(false);
        setProvisionResult(provision);
      } else if (accountError) {
        // The extension was saved; only the web-user link failed.
        toast.error(`Extension saved, but the web user couldn't be set up: ${accountError}`, { duration: 7000 });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ? `Save failed: ${msg}` : 'Save failed');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => extensionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions'] });
      setDeleteTarget(null);
      toast.success('Extension deleted');
    },
    onError: () => toast.error('Delete failed'),
  });

  const openCreate = () => {
    setEditing(null);
    reset({
      type: 'webrtc',
      voicemail_enabled: true,
      call_recording: 'on-demand',
      dnd: false,
      ring_timeout: 30,
      sip_password: Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join(''),
      department_id: '',
      account_email: '',
      account_first_name: '',
      account_last_name: '',
      account_role: 'agent',
      account_mode: 'generate',
    });
    setModalOpen(true);
  };

  const openEdit = (ext: Extension) => {
    setEditing(ext);
    reset({
      extension: ext.extension,
      display_name: ext.display_name,
      sip_username: ext.sip_username,
      sip_password: ext.sip_password,
      type: ext.type,
      voicemail_enabled: ext.voicemail_enabled,
      call_recording: ext.call_recording,
      dnd: ext.dnd,
      ring_timeout: ext.ring_timeout,
      department_id: (ext as Extension & { department_id?: string }).department_id ?? '',
      account_email: '',
      account_first_name: '',
      account_last_name: '',
      account_role: 'agent',
      account_mode: 'generate',
    });
    setModalOpen(true);
  };

  const columns: Column<Extension>[] = [
    {
      key: 'extension',
      header: 'Extension',
      sortable: true,
      render: (row) => (
        <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">{row.extension}</span>
      ),
    },
    {
      key: 'display_name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-surface-800 dark:text-surface-200">{row.display_name}</p>
          <p className="text-xs text-surface-400">{row.sip_username}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Badge variant={row.type === 'webrtc' ? 'accent' : 'neutral'}>
          {TYPE_LABELS[row.type] ?? row.type}
        </Badge>
      ),
    },
    {
      key: 'user_id',
      header: 'Web user',
      render: (row) => (
        <Badge variant={row.user_id ? 'success' : 'neutral'}>{row.user_id ? 'Linked' : '—'}</Badge>
      ),
    },
    {
      key: 'voicemail_enabled',
      header: 'Voicemail',
      render: (row) => (
        <Badge variant={row.voicemail_enabled ? 'success' : 'neutral'}>
          {row.voicemail_enabled ? 'On' : 'Off'}
        </Badge>
      ),
    },
    {
      key: 'call_recording',
      header: 'Recording',
      render: (row) => (
        <Badge variant={row.call_recording === 'always' ? 'warning' : row.call_recording === 'on-demand' ? 'info' : 'neutral'}>
          {RECORDING_LABELS[row.call_recording] ?? row.call_recording}
        </Badge>
      ),
    },
    {
      key: 'dnd',
      header: 'DND',
      render: (row) => (
        <Badge variant={row.dnd ? 'danger' : 'neutral'}>{row.dnd ? 'On' : 'Off'}</Badge>
      ),
    },
  ];

  const voicemailEnabled = watch('voicemail_enabled');
  const dnd = watch('dnd');
  const accountEmail = watch('account_email');
  const hasAccount = Boolean(accountEmail && accountEmail.trim());

  const copyPassword = (pw: string) => {
    navigator.clipboard?.writeText(pw).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => toast.error('Copy failed — select and copy manually'),
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Phone size={20} className="text-primary-500" /> Extensions
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {data?.total ?? 0} extensions configured
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={16} /> New Extension
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            type="search"
            placeholder="Search extensions…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-9 text-sm"
          />
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['extensions'] })}
          className="btn-secondary btn-icon"
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={20}
        onPageChange={setPage}
        emptyMessage="No extensions found. Create your first one!"
        actions={(row) => (
          <>
            <button onClick={() => openEdit(row)} className="btn-ghost btn-icon btn-sm" title="Edit">
              <Pencil size={14} />
            </button>
            <button onClick={() => setDeleteTarget(row)} className="btn-ghost btn-icon btn-sm text-danger" title="Delete">
              <Trash2 size={14} />
            </button>
          </>
        )}
      />

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        title={editing ? `Edit Extension ${editing.extension}` : 'New Extension'}
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Extension'}
            </button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((d) => upsert.mutate(d))}>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Extension Number" placeholder="1001" error={errors.extension?.message} {...register('extension')} />
            <Input label="Display Name" placeholder="John Smith" error={errors.display_name?.message} {...register('display_name')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="SIP Username" placeholder="1001" error={errors.sip_username?.message} {...register('sip_username')} />
            <Input label="SIP Password" type="password" autoComplete="new-password" error={errors.sip_password?.message} {...register('sip_password')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Type"
              options={[
                { value: 'webrtc', label: 'WebRTC (Browser)' },
                { value: 'softphone', label: 'Softphone (SIP)' },
                { value: 'desk', label: 'Desk Phone (SIP)' },
              ]}
              error={errors.type?.message}
              {...register('type')}
            />
            <Select
              label="Call Recording"
              options={[
                { value: 'never', label: 'Disabled' },
                { value: 'on-demand', label: 'On Demand' },
                { value: 'always', label: 'Always' },
              ]}
              error={errors.call_recording?.message}
              {...register('call_recording')}
            />
          </div>
          <Input
            label="Ring Timeout (seconds)"
            type="number"
            min={5}
            max={120}
            error={errors.ring_timeout?.message}
            {...register('ring_timeout')}
          />
          <Select
            label="Department"
            placeholder="— Unassigned —"
            options={(departmentsData?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            {...register('department_id')}
          />
          <div className="grid grid-cols-2 gap-4 pt-1">
            <Toggle
              label="Voicemail Enabled"
              description="Record missed calls"
              checked={voicemailEnabled}
              onChange={(v) => setValue('voicemail_enabled', v)}
            />
            <Toggle
              label="Do Not Disturb"
              description="Block all incoming calls"
              checked={dnd}
              onChange={(v) => setValue('dnd', v)}
            />
          </div>

          {/* Already-linked note (edit of a linked extension) */}
          {editing?.user_id && (
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 p-4 flex items-center gap-2">
              <UserPlus size={16} className="text-emerald-500" />
              <p className="text-sm text-surface-600 dark:text-surface-300">
                This extension is already linked to a web user. Manage the account from the{' '}
                <strong>Users</strong> page.
              </p>
            </div>
          )}

          {/* Web-user association (create, or edit of an unlinked extension) */}
          {!editing?.user_id && (
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <UserPlus size={16} className="text-primary-500" />
                <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
                  Associate a web user <span className="font-normal text-surface-400">(optional)</span>
                </h4>
              </div>
              <p className="text-xs text-surface-500 -mt-2">
                Give this extension's owner a console login. Enter their email; we'll create the
                account (or link an existing one) and connect it to this extension.
              </p>
              <Input
                label="Email address"
                type="email"
                placeholder="person@company.com"
                autoComplete="off"
                error={errors.account_email?.message}
                {...register('account_email')}
              />
              {hasAccount && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="First name" placeholder="Jane" {...register('account_first_name')} />
                    <Input label="Last name" placeholder="Doe" {...register('account_last_name')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      label="Console role"
                      options={[
                        { value: 'agent', label: 'Agent' },
                        { value: 'supervisor', label: 'Supervisor' },
                        { value: 'admin', label: 'Admin' },
                        { value: 'user', label: 'User' },
                      ]}
                      {...register('account_role')}
                    />
                    <Select
                      label="Set up access by"
                      options={[
                        { value: 'generate', label: 'Generate a password' },
                        { value: 'invite', label: 'Email an invite' },
                      ]}
                      {...register('account_mode')}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Provisioned-account result */}
      <Modal
        open={Boolean(provisionResult)}
        onClose={() => setProvisionResult(null)}
        title="Web user ready"
        size="md"
        footer={<button className="btn-primary" onClick={() => setProvisionResult(null)}>Done</button>}
      >
        {provisionResult && (
          <div className="space-y-4 text-sm">
            <p className="text-surface-700 dark:text-surface-300">
              {provisionResult.linkedExisting
                ? <>Linked the extension to the existing user <strong>{provisionResult.user.email}</strong>. Their current password is unchanged.</>
                : <>Created and linked <strong>{provisionResult.user.email}</strong>.</>}
            </p>

            {provisionResult.generatedPassword && (
              <div className="space-y-1.5">
                <label className="label">Temporary password — copy &amp; share it securely</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-lg bg-surface-100 dark:bg-surface-800 font-mono text-base tracking-wide select-all">
                    {provisionResult.generatedPassword}
                  </code>
                  <button className="btn-secondary btn-icon" title="Copy" onClick={() => copyPassword(provisionResult.generatedPassword!)}>
                    {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
                  </button>
                </div>
                <p className="text-xs text-surface-400">This is shown only once. The user can change it under Settings → Security.</p>
              </div>
            )}

            {provisionResult.invited && provisionResult.emailSent && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-3 py-2">
                An invite email with sign-in instructions was sent to {provisionResult.user.email}.
              </div>
            )}

            {provisionResult.invited && !provisionResult.emailSent && provisionResult.temporaryPassword && (
              <div className="space-y-1.5">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-3 py-2">
                  Email isn't configured on this server, so the invite couldn't be sent. Share this
                  temporary password with the user instead:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-lg bg-surface-100 dark:bg-surface-800 font-mono text-base tracking-wide select-all">
                    {provisionResult.temporaryPassword}
                  </code>
                  <button className="btn-secondary btn-icon" title="Copy" onClick={() => copyPassword(provisionResult.temporaryPassword!)}>
                    {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Extension"
        message={`Delete extension ${deleteTarget?.extension} (${deleteTarget?.display_name})? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMut.isPending}
      />
    </div>
  );
}
