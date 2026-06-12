import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, BookOpen, Upload, File, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { knowledgeBasesApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Textarea } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { KnowledgeBase, KBDocument } from '@/lib/types';
import { useDropzone } from 'react-dropzone';
import { clsx } from 'clsx';
import { format } from 'date-fns';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function DocumentsPanel({ kb }: { kb: KnowledgeBase }) {
  const qc = useQueryClient();

  const { data: docsData, isLoading } = useQuery({
    queryKey: ['kb-documents', kb.id],
    queryFn: () => knowledgeBasesApi.documents(kb.id),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => knowledgeBasesApi.uploadDocument(kb.id, file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-documents', kb.id] }); toast.success('Document uploaded'); },
    onError: () => toast.error('Upload failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (docId: string) => knowledgeBasesApi.deleteDocument(kb.id, docId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-documents', kb.id] }); toast.success('Removed'); },
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => files.forEach(f => uploadMut.mutate(f)),
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxSize: 20 * 1024 * 1024, // 20MB
  });

  const statusIcon = (status: KBDocument['status']) => {
    if (status === 'ready') return <CheckCircle2 size={14} className="text-emerald-500" />;
    if (status === 'error') return <AlertCircle size={14} className="text-red-500" />;
    if (status === 'processing' || status === 'pending') return <Loader2 size={14} className="text-amber-500 animate-spin" />;
    return null;
  };

  const docs = docsData?.data ?? [];

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={clsx(
          'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
            : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
        )}
      >
        <input {...getInputProps()} />
        <Upload size={24} className="mx-auto mb-2 text-surface-400" />
        <p className="text-sm font-medium text-surface-600 dark:text-surface-400">
          {isDragActive ? 'Drop files here' : 'Drag & drop or click to upload'}
        </p>
        <p className="text-xs text-surface-400 mt-0.5">PDF, TXT, MD, DOC, DOCX — max 20MB</p>
      </div>

      {/* Documents list */}
      {isLoading ? (
        <div className="py-6 text-center text-surface-400">Loading documents…</div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-surface-400 text-center py-4">No documents uploaded yet</p>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-700/50 border border-surface-100 dark:border-surface-700">
              <File size={16} className="text-surface-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{doc.filename}</p>
                <p className="text-xs text-surface-400">
                  {(doc.size_bytes / 1024).toFixed(0)} KB · {format(new Date(doc.created_at), 'MMM d, yyyy')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {statusIcon(doc.status)}
                <Badge variant={doc.status === 'ready' ? 'success' : doc.status === 'error' ? 'danger' : 'warning'}>
                  {doc.status}
                </Badge>
                <button
                  className="btn-ghost btn-icon btn-sm text-danger"
                  onClick={() => deleteMut.mutate(doc.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBases() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBase | null>(null);
  const [docsKB, setDocsKB] = useState<KnowledgeBase | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['knowledge-bases', page],
    queryFn: () => knowledgeBasesApi.list({ page, per_page: 20 }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const upsert = useMutation({
    mutationFn: (d: FormData) => editing ? knowledgeBasesApi.update(editing.id, d) : knowledgeBasesApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-bases'] }); setModalOpen(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => knowledgeBasesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-bases'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const columns: Column<KnowledgeBase>[] = [
    { key: 'name', header: 'Knowledge Base', sortable: true, render: (r) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <BookOpen size={14} className="text-white" />
        </div>
        <div>
          <p className="font-semibold text-surface-800 dark:text-surface-200">{r.name}</p>
          {r.description && <p className="text-xs text-surface-400 truncate max-w-[200px]">{r.description}</p>}
        </div>
      </div>
    )},
    { key: 'created_at', header: 'Created', render: (r) => <span className="text-xs text-surface-500">{format(new Date(r.created_at), 'MMM d, yyyy')}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <BookOpen size={20} className="text-primary-500" /> Knowledge Bases
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">Documents and data sources for AI agents</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); reset(); setModalOpen(true); }}>
          <Plus size={16} /> New Knowledge Base
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
        emptyMessage="No knowledge bases. Create one and upload documents."
        actions={(row) => (
          <>
            <button className="btn-ghost btn-sm text-xs" onClick={() => setDocsKB(row)}>
              <Upload size={12} /> Manage Docs
            </button>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => { setEditing(row); reset(row); setModalOpen(true); }}>
              <Pencil size={14} />
            </button>
            <button className="btn-ghost btn-icon btn-sm text-danger" onClick={() => setDeleteTarget(row)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Knowledge Base' : 'New Knowledge Base'} size="md"
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
          <Input label="Name" placeholder="Product FAQ" error={errors.name?.message} {...register('name')} />
          <Textarea label="Description" placeholder="FAQs and product documentation for AI agents" rows={3} {...register('description')} />
        </form>
      </Modal>

      {/* Documents modal */}
      <Modal open={Boolean(docsKB)} onClose={() => setDocsKB(null)} title={`Documents — ${docsKB?.name ?? ''}`} size="lg"
        footer={<button className="btn-secondary" onClick={() => setDocsKB(null)}>Close</button>}
      >
        {docsKB && <DocumentsPanel kb={docsKB} />}
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Knowledge Base" message={`Delete "${deleteTarget?.name}" and all its documents?`} loading={deleteMut.isPending}
      />
    </div>
  );
}
