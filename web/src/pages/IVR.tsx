import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Network, Phone, ArrowRight } from 'lucide-react';
import { ivrMenusApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select, Textarea } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { IVRMenu } from '@/lib/types';

const DEST_TYPES = [
  { value: 'extension', label: 'Extension' },
  { value: 'ring_group', label: 'Ring Group' },
  { value: 'queue', label: 'Queue' },
  { value: 'ivr_menu', label: 'IVR Menu' },
  { value: 'ai_agent', label: 'AI Agent' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'external', label: 'External Number' },
];

const KEYS = ['0','1','2','3','4','5','6','7','8','9','*','#'];

const optionSchema = z.object({
  key: z.string().min(1),
  dest_type: z.enum(['extension', 'ring_group', 'queue', 'ivr_menu', 'time_condition', 'ai_agent', 'voicemail', 'external']),
  dest_id: z.string().min(1, 'Required'),
  label: z.string().optional(),
});

const schema = z.object({
  number: z.string().min(1, 'Required'),
  name: z.string().min(1, 'Required'),
  greeting_type: z.enum(['tts', 'file']),
  greeting_text: z.string().optional(),
  timeout: z.coerce.number().min(1).max(30),
  max_retries: z.coerce.number().min(1).max(10),
  options: z.array(optionSchema),
});
type FormData = z.infer<typeof schema>;

export default function IVR() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IVRMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IVRMenu | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ivr-menus', page],
    queryFn: () => ivrMenusApi.list({ page, per_page: 20 }),
  });

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { greeting_type: 'tts', timeout: 10, max_retries: 3, options: [] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'options' });
  const greetingType = watch('greeting_type');

  const upsert = useMutation({
    mutationFn: (d: FormData) => editing ? ivrMenusApi.update(editing.id, d) : ivrMenusApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ivr-menus'] }); setModalOpen(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ivrMenusApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ivr-menus'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const openCreate = () => {
    setEditing(null);
    reset({ greeting_type: 'tts', timeout: 10, max_retries: 3, options: [] });
    setModalOpen(true);
  };

  const openEdit = (m: IVRMenu) => {
    setEditing(m);
    reset({ ...m });
    setModalOpen(true);
  };

  const columns: Column<IVRMenu>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">{r.number}</span> },
    { key: 'name', header: 'Menu Name', sortable: true },
    { key: 'greeting_type', header: 'Greeting', render: (r) => <Badge variant={r.greeting_type === 'tts' ? 'info' : 'neutral'}>{r.greeting_type.toUpperCase()}</Badge> },
    { key: 'options', header: 'Keys', render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.options.map((o) => (
          <span key={o.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-surface-100 dark:bg-surface-700 rounded text-xs">
            <kbd className="font-mono font-bold">{o.key}</kbd>
            <ArrowRight size={9} className="text-surface-400" />
            <span>{o.dest_type.replace('_', ' ')}</span>
          </span>
        ))}
        {r.options.length === 0 && <span className="text-surface-400 text-xs">No keys</span>}
      </div>
    )},
  ];

  const usedKeys = fields.map(f => f.key);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Network size={20} className="text-primary-500" /> IVR Menus
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} interactive menus</p>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={16} /> New Menu</button>
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} total={data?.total ?? 0} page={page} perPage={20} onPageChange={setPage} emptyMessage="No IVR menus configured."
        actions={(row) => (
          <>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => openEdit(row)}><Pencil size={14} /></button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}><Trash2 size={14} /></button>
          </>
        )}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit IVR Menu' : 'New IVR Menu'} size="xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit((d) => upsert.mutate(d))} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save Menu'}
            </button>
          </>
        }
      >
        <form className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Extension Number" placeholder="8000" error={errors.number?.message} {...register('number')} />
            <Input label="Menu Name" placeholder="Main Menu" error={errors.name?.message} {...register('name')} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Select label="Greeting Type" options={[{value:'tts',label:'Text-to-Speech'},{value:'file',label:'Audio File'}]} {...register('greeting_type')} />
            <Input label="Timeout (sec)" type="number" error={errors.timeout?.message?.toString()} {...register('timeout')} />
            <Input label="Max Retries" type="number" error={errors.max_retries?.message?.toString()} {...register('max_retries')} />
          </div>

          {greetingType === 'tts' && (
            <Textarea label="Greeting Text (TTS)" placeholder="Welcome to Acme Corp. Press 1 for Sales, Press 2 for Support…" rows={3} {...register('greeting_text')} />
          )}

          {/* IVR Key Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Key Mappings</label>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => append({ key: '', dest_type: 'extension', dest_id: '', label: '' })}
              >
                <Plus size={12} /> Add Key
              </button>
            </div>

            {fields.length === 0 ? (
              <div className="py-6 text-center text-sm text-surface-400 border-2 border-dashed border-surface-200 dark:border-surface-700 rounded-xl">
                <Phone size={24} className="mx-auto mb-2 opacity-40" />
                Add key mappings to define menu options
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((field, i) => (
                  <div key={field.id} className="flex items-start gap-2 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl border border-surface-200 dark:border-surface-700">
                    <Select
                      options={KEYS.map(k => ({ value: k, label: `Key ${k}`, }))}
                      className="w-24"
                      {...register(`options.${i}.key`)}
                    />
                    <Select
                      options={DEST_TYPES}
                      className="flex-1"
                      {...register(`options.${i}.dest_type`)}
                    />
                    <Input
                      placeholder="Destination ID / number"
                      className="flex-1"
                      error={(errors.options?.[i] as { dest_id?: { message?: string } })?.dest_id?.message}
                      {...register(`options.${i}.dest_id`)}
                    />
                    <Input
                      placeholder="Label (optional)"
                      className="w-28"
                      {...register(`options.${i}.label`)}
                    />
                    <button type="button" onClick={() => remove(i)} className="btn-ghost btn-icon btn-sm text-danger mt-0.5">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {usedKeys.length > 0 && (
              <p className="text-xs text-surface-400 mt-1">Keys in use: {usedKeys.filter(Boolean).join(', ')}</p>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete IVR Menu" message={`Delete "${deleteTarget?.name}"?`} loading={deleteMut.isPending}
      />
    </div>
  );
}
