import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Voicemail as VoicemailIcon, Phone, Mail, MailOpen, Trash2 } from 'lucide-react';
import { voicemailsApi } from '@/lib/api';
import { Badge } from '@/components/Badge';
import { AudioPlayer } from '@/components/AudioPlayer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { toast } from 'react-hot-toast';
import type { Voicemail } from '@/lib/types';
import { clsx } from 'clsx';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VoicemailPage() {
  const qc = useQueryClient();
  const [page] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Voicemail | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['voicemails', page],
    queryFn: () => voicemailsApi.list({ page, per_page: 30 }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => voicemailsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voicemails'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => voicemailsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voicemails'] }); setDeleteTarget(null); toast.success('Deleted'); },
  });

  const unread = (data?.data ?? []).filter(v => !v.is_read).length;

  const handleExpand = (vm: Voicemail) => {
    if (expanded === vm.id) {
      setExpanded(null);
    } else {
      setExpanded(vm.id);
      if (!vm.is_read) markRead.mutate(vm.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <VoicemailIcon size={20} className="text-primary-500" /> Voicemail
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {unread > 0 ? <><span className="font-semibold text-primary-600">{unread} unread</span> · </> : ''}
            {data?.total ?? 0} total
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (data?.data ?? []).length === 0 ? (
        <div className="card p-12 text-center">
          <VoicemailIcon size={32} className="mx-auto mb-3 text-surface-300" />
          <p className="text-surface-500">No voicemails</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(data?.data ?? []).map((vm) => (
            <div key={vm.id} className={clsx(
              'card overflow-hidden transition-all',
              !vm.is_read && 'ring-1 ring-primary-200 dark:ring-primary-800'
            )}>
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/50"
                onClick={() => handleExpand(vm)}
              >
                <div className={clsx(
                  'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
                  vm.is_read ? 'bg-surface-100 dark:bg-surface-700' : 'bg-primary-100 dark:bg-primary-900/30'
                )}>
                  {vm.is_read ? <MailOpen size={16} className="text-surface-400" /> : <Mail size={16} className="text-primary-500" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={clsx('font-semibold text-sm', !vm.is_read && 'text-surface-900 dark:text-surface-100')}>
                      {vm.from_number}
                    </p>
                    {!vm.is_read && <Badge variant="primary">New</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-surface-400 mt-0.5">
                    <span className="flex items-center gap-1"><Phone size={10} /> Ext {vm.extension}</span>
                    <span>{formatDuration(vm.duration)}</span>
                    <span>{format(new Date(vm.created_at), 'MMM d, h:mm a')}</span>
                  </div>
                </div>

                <button
                  className="btn-ghost btn-icon btn-sm text-danger ml-auto"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(vm); }}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Expanded content */}
              {expanded === vm.id && (
                <div className="px-4 pb-4 border-t border-surface-100 dark:border-surface-700 pt-3 space-y-3">
                  {vm.download_url && (
                    <AudioPlayer src={vm.download_url} duration={vm.duration} />
                  )}
                  {vm.transcription && (
                    <div className="p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
                      <p className="text-xs font-semibold text-surface-500 uppercase mb-1">Transcription</p>
                      <p className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed">
                        {vm.transcription}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete Voicemail"
        message={`Delete this voicemail from ${deleteTarget?.from_number}?`}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
