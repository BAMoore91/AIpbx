import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, PhoneForwarded, Hash, ArrowRight, GitBranch } from 'lucide-react';
import { didNumbersApi, outboundRoutesApi, ringGroupsApi, trunksApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { DIDNumber, OutboundRoute, RingGroup } from '@/lib/types';

type Tab = 'dids' | 'outbound' | 'ringgroups';

const DEST_TYPES = [
  { value: 'extension', label: 'Extension' },
  { value: 'ring_group', label: 'Ring Group' },
  { value: 'queue', label: 'Queue' },
  { value: 'ivr_menu', label: 'IVR Menu' },
  { value: 'time_condition', label: 'Time Condition' },
  { value: 'ai_agent', label: 'AI Agent' },
  { value: 'voicemail', label: 'Voicemail' },
];

const STRATEGIES = [
  { value: 'ringall', label: 'Ring All' },
  { value: 'roundrobin', label: 'Round Robin' },
  { value: 'leastrecent', label: 'Least Recent' },
  { value: 'fewestcalls', label: 'Fewest Calls' },
  { value: 'random', label: 'Random' },
];

// ─── DID Section ─────────────────────────────────────────────────────────────
const didSchema = z.object({
  e164: z.string().min(7, 'Valid phone number required'),
  label: z.string().optional(),
  trunk_id: z.string().optional(),
  dest_type: z.enum(['extension', 'ring_group', 'queue', 'ivr_menu', 'time_condition', 'ai_agent', 'voicemail', 'external']),
  dest_id: z.string().optional(),
  cnam: z.string().optional(),
  is_active: z.boolean().default(true),
});
type DIDForm = z.infer<typeof didSchema>;

function DIDsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<DIDNumber | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DIDNumber | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['dids', page], queryFn: () => didNumbersApi.list({ page, per_page: 20 }) });
  const { data: trunksData } = useQuery({ queryKey: ['trunks-list'], queryFn: () => trunksApi.list({ per_page: 100 }) });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<DIDForm>({ resolver: zodResolver(didSchema) });

  const upsert = useMutation({
    mutationFn: (d: DIDForm) => editing ? didNumbersApi.update(editing.id, d) : didNumbersApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dids'] }); setModal(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => didNumbersApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dids'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const columns: Column<DIDNumber>[] = [
    { key: 'e164', header: 'DID Number', sortable: true, render: (r) => <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">{r.e164}</span> },
    { key: 'label', header: 'Label', render: (r) => r.label ?? <span className="text-surface-400">—</span> },
    { key: 'dest_type', header: 'Routes To', render: (r) => (
      <div className="flex items-center gap-1">
        <ArrowRight size={12} className="text-surface-400" />
        <Badge variant="info">{r.dest_type.replace('_', ' ')}</Badge>
        {r.dest_id && <span className="text-xs text-surface-400">{r.dest_id}</span>}
      </div>
    )},
    { key: 'is_active', header: 'Status', render: (r) => <Badge variant={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Off'}</Badge> },
  ];

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary btn-sm" onClick={() => { setEditing(null); reset({ dest_type: 'extension', is_active: true }); setModal(true); }}>
          <Plus size={14} /> Add DID
        </button>
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} total={data?.total ?? 0} page={page} perPage={20} onPageChange={setPage}
        actions={(row) => (
          <>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => { setEditing(row); reset(row); setModal(true); }}><Pencil size={13} /></button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={13} /></button>
          </>
        )}
      />
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit DID' : 'Add DID Number'} size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>Save</button>
          </>
        }
      >
        <form className="space-y-3">
          <Input label="E.164 Number" placeholder="+15551234567" error={errors.e164?.message} {...register('e164')} />
          <Input label="Label" placeholder="Main Line" {...register('label')} />
          <Select label="Trunk" placeholder="— Any trunk —" options={(trunksData?.data ?? []).map(t => ({ value: t.id, label: t.name }))} {...register('trunk_id')} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Route To" options={DEST_TYPES} error={errors.dest_type?.message} {...register('dest_type')} />
            <Input label="Destination ID" placeholder="Extension / Group ID" {...register('dest_id')} />
          </div>
          <Input label="CNAM" placeholder="My Company" {...register('cnam')} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} title="Remove DID" message={`Remove ${deleteTarget?.e164}?`} loading={deleteMut.isPending} />
    </>
  );
}

// ─── Outbound Routes Section ──────────────────────────────────────────────────
const outboundSchema = z.object({
  name: z.string().min(1, 'Required'),
  pattern: z.string().min(1, 'Required'),
  trunk_id: z.string().min(1, 'Required'),
  prepend: z.string().optional(),
  strip: z.coerce.number().min(0),
  caller_id: z.string().optional(),
  priority: z.coerce.number().min(0),
});
type OutboundForm = z.infer<typeof outboundSchema>;

function OutboundTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<OutboundRoute | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutboundRoute | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['outbound-routes', page], queryFn: () => outboundRoutesApi.list({ page, per_page: 20 }) });
  const { data: trunksData } = useQuery({ queryKey: ['trunks-list'], queryFn: () => trunksApi.list({ per_page: 100 }) });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<OutboundForm>({
    resolver: zodResolver(outboundSchema),
    defaultValues: { strip: 0, priority: 0 },
  });

  const upsert = useMutation({
    mutationFn: (d: OutboundForm) => editing ? outboundRoutesApi.update(editing.id, d) : outboundRoutesApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['outbound-routes'] }); setModal(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => outboundRoutesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['outbound-routes'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const columns: Column<OutboundRoute>[] = [
    { key: 'name', header: 'Route Name', sortable: true },
    { key: 'pattern', header: 'Pattern', render: (r) => <span className="font-mono text-sm bg-surface-100 dark:bg-surface-700 px-2 py-0.5 rounded">{r.pattern}</span> },
    { key: 'trunk_id', header: 'Trunk', render: (r) => <span className="text-sm">{trunksData?.data.find(t => t.id === r.trunk_id)?.name ?? r.trunk_id}</span> },
    { key: 'priority', header: 'Priority', align: 'center', render: (r) => <Badge variant="neutral">{r.priority}</Badge> },
  ];

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary btn-sm" onClick={() => { setEditing(null); reset({ strip: 0, priority: 0 }); setModal(true); }}>
          <Plus size={14} /> Add Route
        </button>
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} total={data?.total ?? 0} page={page} perPage={20} onPageChange={setPage}
        actions={(row) => (
          <>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => { setEditing(row); reset(row); setModal(true); }}><Pencil size={13} /></button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={13} /></button>
          </>
        )}
      />
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Route' : 'New Outbound Route'} size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>Save</button>
          </>
        }
      >
        <form className="space-y-3">
          <Input label="Route Name" error={errors.name?.message} {...register('name')} />
          <Input label="Dial Pattern" placeholder="_X." hint="E.g. _1NXXNXXXXXX, _9." error={errors.pattern?.message} {...register('pattern')} />
          <Select label="Trunk" options={(trunksData?.data ?? []).map(t => ({ value: t.id, label: t.name }))} error={errors.trunk_id?.message} {...register('trunk_id')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Prepend" placeholder="1" {...register('prepend')} />
            <Input label="Strip Digits" type="number" error={errors.strip?.message} {...register('strip')} />
            <Input label="Priority" type="number" error={errors.priority?.message} {...register('priority')} />
          </div>
          <Input label="Caller ID Override" placeholder="+15551234567" {...register('caller_id')} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} title="Delete Route" message={`Delete route "${deleteTarget?.name}"?`} loading={deleteMut.isPending} />
    </>
  );
}

// ─── Ring Groups Section ──────────────────────────────────────────────────────
const rgSchema = z.object({
  number: z.string().min(1, 'Required'),
  name: z.string().min(1, 'Required'),
  strategy: z.enum(['ringall', 'roundrobin', 'leastrecent', 'fewestcalls', 'random']),
  ring_timeout: z.coerce.number().min(5).max(120),
});
type RGForm = z.infer<typeof rgSchema>;

function RingGroupsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<RingGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RingGroup | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['ring-groups', page], queryFn: () => ringGroupsApi.list({ page, per_page: 20 }) });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<RGForm>({ resolver: zodResolver(rgSchema), defaultValues: { strategy: 'ringall', ring_timeout: 30 } });

  const upsert = useMutation({
    mutationFn: (d: RGForm) => editing ? ringGroupsApi.update(editing.id, d) : ringGroupsApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ring-groups'] }); setModal(false); toast.success('Saved'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ringGroupsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ring-groups'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const columns: Column<RingGroup>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">{r.number}</span> },
    { key: 'name', header: 'Group Name', sortable: true },
    { key: 'strategy', header: 'Strategy', render: (r) => <Badge variant="info">{r.strategy.replace('_', ' ')}</Badge> },
    { key: 'members', header: 'Members', render: (r) => <Badge variant="neutral">{r.members.length}</Badge> },
    { key: 'ring_timeout', header: 'Timeout', render: (r) => `${r.ring_timeout}s` },
  ];

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary btn-sm" onClick={() => { setEditing(null); reset({ strategy: 'ringall', ring_timeout: 30 }); setModal(true); }}>
          <Plus size={14} /> Add Ring Group
        </button>
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} total={data?.total ?? 0} page={page} perPage={20} onPageChange={setPage}
        actions={(row) => (
          <>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => { setEditing(row); reset(row); setModal(true); }}><Pencil size={13} /></button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={13} /></button>
          </>
        )}
      />
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Ring Group' : 'New Ring Group'} size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>Save</button>
          </>
        }
      >
        <form className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Extension Number" placeholder="6000" error={errors.number?.message} {...register('number')} />
            <Input label="Group Name" placeholder="Support Team" error={errors.name?.message} {...register('name')} />
          </div>
          <Select label="Strategy" options={STRATEGIES} error={errors.strategy?.message} {...register('strategy')} />
          <Input label="Ring Timeout (sec)" type="number" error={errors.ring_timeout?.message} {...register('ring_timeout')} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} title="Delete Ring Group" message={`Delete "${deleteTarget?.name}"?`} loading={deleteMut.isPending} />
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Routing() {
  const [tab, setTab] = useState<Tab>('dids');

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: 'dids', label: 'DID Numbers', icon: Hash },
    { id: 'outbound', label: 'Outbound Routes', icon: PhoneForwarded },
    { id: 'ringgroups', label: 'Ring Groups', icon: GitBranch },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
          <PhoneForwarded size={20} className="text-primary-500" /> Routing
        </h1>
        <p className="text-sm text-surface-500 mt-0.5">Manage DID numbers, outbound routes, and ring groups</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200 dark:border-surface-700 gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="card p-4">
        {tab === 'dids' && <DIDsTab />}
        {tab === 'outbound' && <OutboundTab />}
        {tab === 'ringgroups' && <RingGroupsTab />}
      </div>
    </div>
  );
}
