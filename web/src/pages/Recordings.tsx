import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Mic, Search, Phone } from 'lucide-react';
import { recordingsApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { AudioPlayer } from '@/components/AudioPlayer';
import type { Recording } from '@/lib/types';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Recordings() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['recordings', page, search],
    queryFn: () => recordingsApi.list({ page, per_page: 25, search }),
  });

  const columns: Column<Recording>[] = [
    {
      key: 'call_id',
      header: 'Call ID',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Phone size={13} className="text-surface-400" />
          <span className="font-mono text-xs text-surface-500 truncate max-w-[120px]">{r.call_id}</span>
        </div>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (r) => <span className="tabular-nums">{formatDuration(r.duration)}</span>,
    },
    {
      key: 'format',
      header: 'Format',
      render: (r) => <Badge variant="neutral" className="uppercase">{r.format}</Badge>,
    },
    {
      key: 'size_bytes',
      header: 'Size',
      render: (r) => <span className="text-sm text-surface-500">{(r.size_bytes / 1024 / 1024).toFixed(1)} MB</span>,
    },
    {
      key: 'transcribed',
      header: 'Transcribed',
      render: (r) => <Badge variant={r.transcribed ? 'success' : 'neutral'}>{r.transcribed ? 'Yes' : 'No'}</Badge>,
    },
    {
      key: 'created_at',
      header: 'Date',
      sortable: true,
      render: (r) => <span className="text-sm text-surface-500">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>,
    },
    {
      key: 'player',
      header: 'Play',
      render: (r) => r.download_url
        ? <AudioPlayer src={r.download_url} duration={r.duration} compact />
        : <span className="text-xs text-surface-400">No URL</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Mic size={20} className="text-primary-500" /> Recordings
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} recordings</p>
        </div>
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          type="search"
          placeholder="Search by call ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input pl-9 text-sm"
        />
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={25}
        onPageChange={setPage}
        emptyMessage="No recordings found."
      />
    </div>
  );
}
