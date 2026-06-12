import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Radio, Zap } from 'lucide-react';
import { trunksApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { TwilioConnectModal } from '@/components/TwilioConnectModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select, Toggle } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { Trunk } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  provider: z.string().min(1, 'Required'),
  host: z.string().min(1, 'Required'),
  port: z.coerce.number().min(1).max(65535),
  transport: z.enum(['udp', 'tcp', 'tls']),
  auth_type: z.enum(['userpass', 'ip', 'none']),
  username: z.string().optional(),
  secret: z.string().optional(),
  max_channels: z.coerce.number().min(1).max(999),
  caller_id: z.string().optional(),
  register: z.boolean(),
  is_active: z.boolean(),
});
type FormData = z.infer<typeof schema>;

export default function Trunks() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [twilioOpen, setTwilioOpen] = useState(false);
  const [editing, setEditing] = useState<Trunk | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Trunk | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['trunks', page],
    queryFn: () => trunksApi.list({ page, per_page: 20 }),
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { transport: 'udp', auth_type: 'userpass', port: 5060, max_channels: 30, register: true, is_active: true },
  });

  const upsert = useMutation({
    mutationFn: (d: FormData) => editing ? trunksApi.update(editing.id, d) : trunksApi.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trunks'] });
      setModalOpen(false);
      toast.success(editing ? 'Trunk updated' : 'Trunk created');
    },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => trunksApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trunks'] });
      setDeleteTarget(null);
      toast.success('Trunk deleted');
    },
    onError: () => toast.error('Delete failed'),
  });

  const openCreate = () => {
    setEditing(null);
    reset({ transport: 'udp', auth_type: 'userpass', port: 5060, max_channels: 30, register: true, is_active: true });
    setModalOpen(true);
  };

  const openEdit = (t: Trunk) => {
    setEditing(t);
    reset({ ...t, transport: t.transport as 'udp' | 'tcp' | 'tls', port: t.port, max_channels: t.max_channels });
    setModalOpen(true);
  };

  const isActive = watch('is_active');
  const registr = watch('register');

  const columns: Column<Trunk>[] = [
    {
      key: 'name',
      header: 'Trunk',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-semibold text-surface-800 dark:text-surface-200">{row.name}</p>
          <p className="text-xs text-surface-400">{row.provider}</p>
        </div>
      ),
    },
    { key: 'host', header: 'Host', render: (row) => <span className="font-mono text-sm">{row.host}:{row.port}</span> },
    {
      key: 'transport',
      header: 'Transport',
      render: (row) => <Badge variant="neutral" className="uppercase">{row.transport}</Badge>,
    },
    { key: 'max_channels', header: 'Max Ch.', align: 'center' },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <Badge variant={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Active' : 'Disabled'}</Badge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Radio size={20} className="text-primary-500" /> SIP Trunks
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} trunks configured</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTwilioOpen(true)} className="btn-secondary inline-flex items-center gap-1.5">
            <Zap size={16} className="text-accent-500" /> Connect Twilio
          </button>
          <button onClick={openCreate} className="btn-primary"><Plus size={16} /> New Trunk</button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={20}
        onPageChange={setPage}
        emptyMessage="No trunks configured."
        actions={(row) => (
          <>
            <button onClick={() => openEdit(row)} className="btn-ghost btn-icon btn-sm"><Pencil size={14} /></button>
            <button onClick={() => setDeleteTarget(row)} className="btn-ghost btn-icon btn-sm text-danger"><Trash2 size={14} /></button>
          </>
        )}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Trunk' : 'New Trunk'} size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Trunk Name" placeholder="Primary Trunk" error={errors.name?.message} {...register('name')} />
            <Input label="Provider" placeholder="Twilio / Vonage" error={errors.provider?.message} {...register('provider')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Host / IP" placeholder="sip.provider.com" error={errors.host?.message} {...register('host')} />
            <Input label="Port" type="number" error={errors.port?.message} {...register('port')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Transport" options={[{value:'udp',label:'UDP'},{value:'tcp',label:'TCP'},{value:'tls',label:'TLS'}]} {...register('transport')} />
            <Select label="Auth Type" options={[{value:'userpass',label:'Username/Password'},{value:'ip',label:'IP-based'},{value:'none',label:'None'}]} {...register('auth_type')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Username" {...register('username')} />
            <Input label="Secret / Password" type="password" {...register('secret')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Max Channels" type="number" error={errors.max_channels?.message} {...register('max_channels')} />
            <Input label="Caller ID" placeholder="+15551234567" {...register('caller_id')} />
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <Toggle label="Register" description="Send REGISTER to provider" checked={registr} onChange={(v) => setValue('register', v)} />
            <Toggle label="Active" description="Enable this trunk" checked={isActive} onChange={(v) => setValue('is_active', v)} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Trunk"
        message={`Delete trunk "${deleteTarget?.name}"? Any DIDs assigned to this trunk will lose routing.`}
        loading={deleteMut.isPending}
      />

      <TwilioConnectModal
        open={twilioOpen}
        onClose={() => setTwilioOpen(false)}
        onConnected={() => qc.invalidateQueries({ queryKey: ['trunks'] })}
      />
    </div>
  );
}
