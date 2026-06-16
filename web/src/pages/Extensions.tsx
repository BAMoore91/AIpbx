import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Search, Phone, RefreshCw } from 'lucide-react';
import { extensionsApi, departmentsApi } from '@/lib/api';
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
  type: z.enum(['sip', 'webrtc', 'virtual']),
  voicemail_enabled: z.boolean(),
  call_recording: z.enum(['disabled', 'on_demand', 'always']),
  dnd: z.boolean(),
  ring_timeout: z.coerce.number().min(5).max(120),
  department_id: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const TYPE_LABELS: Record<string, string> = {
  sip: 'SIP', webrtc: 'WebRTC', virtual: 'Virtual',
};

export default function Extensions() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Extension | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Extension | null>(null);

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
      call_recording: 'on_demand',
      dnd: false,
      ring_timeout: 30,
    },
  });

  const upsert = useMutation({
    mutationFn: (d: FormData) => {
      const body = { ...d, department_id: d.department_id || null };
      return editing
        ? extensionsApi.update(editing.id, body)
        : extensionsApi.create(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions'] });
      setModalOpen(false);
      setEditing(null);
      reset();
      toast.success(editing ? 'Extension updated' : 'Extension created');
    },
    onError: () => toast.error('Save failed'),
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
      call_recording: 'on_demand',
      dnd: false,
      ring_timeout: 30,
      sip_password: Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join(''),
      department_id: '',
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
          {TYPE_LABELS[row.type]}
        </Badge>
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
        <Badge variant={row.call_recording === 'always' ? 'warning' : row.call_recording === 'on_demand' ? 'info' : 'neutral'}>
          {row.call_recording.replace('_', ' ')}
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
                { value: 'sip', label: 'SIP Phone' },
                { value: 'virtual', label: 'Virtual' },
              ]}
              error={errors.type?.message}
              {...register('type')}
            />
            <Select
              label="Call Recording"
              options={[
                { value: 'disabled', label: 'Disabled' },
                { value: 'on_demand', label: 'On Demand' },
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
        </form>
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
