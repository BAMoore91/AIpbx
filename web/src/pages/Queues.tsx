import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, GitBranch, UserPlus, UserMinus } from 'lucide-react';
import { queuesApi, extensionsApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select, Toggle } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { useCallStore } from '@/store/callStore';
import { toast } from 'react-hot-toast';
import type { Queue } from '@/lib/types';
import { clsx } from 'clsx';

const schema = z.object({
  number: z.string().min(1, 'Required'),
  name: z.string().min(1, 'Required'),
  strategy: z.string().min(1, 'Required'),
  max_wait: z.coerce.number().min(10),
  max_callers: z.coerce.number().min(1),
  wrapup_time: z.coerce.number().min(0),
  service_level: z.coerce.number().min(1).max(600),
  announce_position: z.boolean(),
});
type FormData = z.infer<typeof schema>;

const STRATEGIES = [
  { value: 'ringall', label: 'Ring All' },
  { value: 'roundrobin', label: 'Round Robin' },
  { value: 'leastrecent', label: 'Least Recent' },
  { value: 'fewestcalls', label: 'Fewest Calls' },
  { value: 'random', label: 'Random' },
];

export default function Queues() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Queue | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Queue | null>(null);
  const [membersQueue, setMembersQueue] = useState<Queue | null>(null);
  const { queueStats } = useCallStore();

  const { data, isLoading } = useQuery({
    queryKey: ['queues', page],
    queryFn: () => queuesApi.list({ page, per_page: 20 }),
  });

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['queue-members', membersQueue?.id],
    queryFn: () => queuesApi.members(membersQueue!.id),
    enabled: Boolean(membersQueue),
  });

  const { data: extensionsData } = useQuery({
    queryKey: ['extensions-list'],
    queryFn: () => extensionsApi.list({ per_page: 200 }),
    enabled: Boolean(membersQueue),
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { strategy: 'ringall', max_wait: 300, max_callers: 20, wrapup_time: 30, service_level: 60, announce_position: true },
  });

  const upsert = useMutation({
    mutationFn: (d: FormData) => editing ? queuesApi.update(editing.id, d) : queuesApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queues'] }); setModalOpen(false); toast.success('Saved'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => queuesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queues'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const addMember = useMutation({
    mutationFn: (extId: string) => queuesApi.addMember(membersQueue!.id, extId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queue-members'] }); toast.success('Member added'); },
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => queuesApi.removeMember(membersQueue!.id, memberId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queue-members'] }); toast.success('Member removed'); },
  });

  const announcePos = watch('announce_position');

  const columns: Column<Queue>[] = [
    {
      key: 'number',
      header: 'Number',
      render: (r) => <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">{r.number}</span>,
    },
    { key: 'name', header: 'Queue Name', sortable: true },
    { key: 'strategy', header: 'Strategy', render: (r) => <Badge variant="info">{r.strategy.replace('_', ' ')}</Badge> },
    {
      key: 'live',
      header: 'Live',
      render: (r) => {
        const s = queueStats[r.id];
        if (!s) return <span className="text-surface-400 text-xs">—</span>;
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-600 font-semibold">{s.waiting} waiting</span>
            <span className="text-emerald-600">{s.agents_available} avail</span>
          </div>
        );
      },
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (r) => {
        const s = queueStats[r.id];
        const pct = s?.service_level_pct ?? 0;
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-surface-200 dark:bg-surface-600 rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full', pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-surface-500">{pct.toFixed(0)}%</span>
          </div>
        );
      },
    },
    { key: 'max_callers', header: 'Max', render: (r) => <span className="text-sm">{r.max_callers}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <GitBranch size={20} className="text-primary-500" /> Queues
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} call queues</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); reset({ strategy: 'ringall', max_wait: 300, max_callers: 20, wrapup_time: 30, service_level: 60, announce_position: true }); setModalOpen(true); }}>
          <Plus size={16} /> New Queue
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
        emptyMessage="No queues configured."
        actions={(row) => (
          <>
            <button className="btn-ghost btn-icon btn-sm" title="Members" onClick={() => setMembersQueue(row)}><UserPlus size={14} /></button>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => { setEditing(row); reset(row); setModalOpen(true); }}><Pencil size={14} /></button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={14} /></button>
          </>
        )}
      />

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Queue' : 'New Queue'} size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Extension Number" placeholder="7000" error={errors.number?.message} {...register('number')} />
            <Input label="Queue Name" placeholder="Sales Queue" error={errors.name?.message} {...register('name')} />
          </div>
          <Select label="Ring Strategy" options={STRATEGIES} error={errors.strategy?.message} {...register('strategy')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Max Wait (sec)" type="number" error={errors.max_wait?.message} {...register('max_wait')} />
            <Input label="Max Callers" type="number" error={errors.max_callers?.message} {...register('max_callers')} />
            <Input label="Wrap-up Time (sec)" type="number" error={errors.wrapup_time?.message} {...register('wrapup_time')} />
          </div>
          <Input label="Service Level Target (sec)" type="number" hint="Calls answered within this time count as within SLA" error={errors.service_level?.message} {...register('service_level')} />
          <Toggle label="Announce Position" description="Tell callers their position in queue" checked={announcePos} onChange={(v) => setValue('announce_position', v)} />
        </form>
      </Modal>

      {/* Members Modal */}
      <Modal open={Boolean(membersQueue)} onClose={() => setMembersQueue(null)} title={`Members — ${membersQueue?.name ?? ''}`} size="lg"
        footer={<button className="btn-secondary" onClick={() => setMembersQueue(null)}>Close</button>}
      >
        <div className="space-y-3">
          {membersLoading ? (
            <div className="py-8 text-center text-surface-400">Loading…</div>
          ) : (
            <div className="space-y-2">
              {(membersData ?? []).map((m) => {
                const ext = extensionsData?.data.find(e => e.id === m.extension_id);
                return (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-700/50">
                    <div>
                      <p className="font-medium text-sm">{ext?.display_name ?? m.extension_id}</p>
                      {ext && <p className="text-xs text-surface-400">Ext {ext.extension}</p>}
                    </div>
                    <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => removeMember.mutate(m.id)}><UserMinus size={14} /></button>
                  </div>
                );
              })}
              {(membersData ?? []).length === 0 && (
                <p className="text-sm text-surface-400 py-4 text-center">No members assigned</p>
              )}
            </div>
          )}

          <div className="border-t border-surface-200 dark:border-surface-700 pt-3">
            <p className="text-xs font-medium text-surface-500 mb-2">Add Extension</p>
            <div className="flex gap-2">
              <select
                className="select flex-1"
                onChange={(e) => e.target.value && addMember.mutate(e.target.value)}
                defaultValue=""
              >
                <option value="">Select extension to add…</option>
                {(extensionsData?.data ?? [])
                  .filter(e => !(membersData ?? []).some(m => m.extension_id === e.id))
                  .map(e => (
                    <option key={e.id} value={e.id}>{e.extension} — {e.display_name}</option>
                  ))
                }
              </select>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Queue" message={`Delete queue "${deleteTarget?.name}"?`} loading={deleteMut.isPending}
      />
    </div>
  );
}
