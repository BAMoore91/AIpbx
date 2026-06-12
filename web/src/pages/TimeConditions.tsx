import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Clock } from 'lucide-react';
import { timeConditionsApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { TimeCondition } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  timezone: z.string().min(1, 'Required'),
  match_dest_type: z.string().optional(),
  match_dest_id: z.string().optional(),
  nomatch_dest_type: z.string().optional(),
  nomatch_dest_id: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney', 'UTC',
].map(tz => ({ value: tz, label: tz }));

const DEST_TYPES = [
  { value: 'extension', label: 'Extension' },
  { value: 'ring_group', label: 'Ring Group' },
  { value: 'queue', label: 'Queue' },
  { value: 'ivr_menu', label: 'IVR Menu' },
  { value: 'ai_agent', label: 'AI Agent' },
  { value: 'voicemail', label: 'Voicemail' },
];

export default function TimeConditions() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TimeCondition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TimeCondition | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['time-conditions', page],
    queryFn: () => timeConditionsApi.list({ page, per_page: 20 }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { timezone: 'America/New_York' },
  });

  const upsert = useMutation({
    mutationFn: (d: FormData) => editing ? timeConditionsApi.update(editing.id, d) : timeConditionsApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-conditions'] }); setModalOpen(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => timeConditionsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-conditions'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const openCreate = () => { setEditing(null); reset({ timezone: 'America/New_York' }); setModalOpen(true); };
  const openEdit = (t: TimeCondition) => { setEditing(t); reset(t); setModalOpen(true); };

  const columns: Column<TimeCondition>[] = [
    { key: 'name', header: 'Condition Name', sortable: true },
    { key: 'timezone', header: 'Timezone', render: (r) => <span className="text-sm font-mono">{r.timezone}</span> },
    { key: 'rules', header: 'Rules', render: (r) => <Badge variant="info">{r.rules.length} rule{r.rules.length !== 1 ? 's' : ''}</Badge> },
    {
      key: 'match', header: 'Match → Route',
      render: (r) => r.match_dest_type ? (
        <Badge variant="success">{r.match_dest_type.replace('_', ' ')}</Badge>
      ) : <span className="text-surface-400 text-xs">Not set</span>,
    },
    {
      key: 'nomatch', header: 'No Match → Route',
      render: (r) => r.nomatch_dest_type ? (
        <Badge variant="warning">{r.nomatch_dest_type.replace('_', ' ')}</Badge>
      ) : <span className="text-surface-400 text-xs">Not set</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Clock size={20} className="text-primary-500" /> Time Conditions
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">Route calls based on time of day or holidays</p>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={16} /> New Condition</button>
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} total={data?.total ?? 0} page={page} perPage={20} onPageChange={setPage}
        emptyMessage="No time conditions configured."
        actions={(row) => (
          <>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => openEdit(row)}><Pencil size={14} /></button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={14} /></button>
          </>
        )}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Time Condition' : 'New Time Condition'} size="lg"
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
          <div className="grid grid-cols-2 gap-3">
            <Input label="Condition Name" placeholder="Business Hours" error={errors.name?.message} {...register('name')} />
            <Select label="Timezone" options={TIMEZONES} error={errors.timezone?.message} {...register('timezone')} />
          </div>

          <div className="p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl text-sm text-surface-600 dark:text-surface-400">
            <p className="font-medium mb-1 text-surface-700 dark:text-surface-300">Business Hours Rules</p>
            <p className="text-xs">Time rules (Mon–Fri 09:00–17:00, etc.) can be managed via the API or will be configurable in a future UI update. Configure match/no-match destinations below.</p>
          </div>

          <div>
            <p className="label">When condition MATCHES (within business hours)</p>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <Select label="Route To" placeholder="— Select destination type —" options={DEST_TYPES} {...register('match_dest_type')} />
              <Input label="Destination ID" placeholder="Extension / Queue ID" {...register('match_dest_id')} />
            </div>
          </div>

          <div>
            <p className="label">When condition DOES NOT MATCH (after hours)</p>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <Select label="Route To" placeholder="— Select destination type —" options={DEST_TYPES} {...register('nomatch_dest_type')} />
              <Input label="Destination ID" placeholder="Voicemail / IVR ID" {...register('nomatch_dest_id')} />
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Time Condition" message={`Delete "${deleteTarget?.name}"?`} loading={deleteMut.isPending}
      />
    </div>
  );
}
