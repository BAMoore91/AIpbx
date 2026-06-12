import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Mail, Search, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { messagesApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import type { Message } from '@/lib/types';

export default function Messages() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['messages', page, search],
    queryFn: () => messagesApi.list({ page, per_page: 25, search }),
  });

  const columns: Column<Message>[] = [
    {
      key: 'direction',
      header: '',
      width: '32px',
      render: (r) => r.direction === 'inbound'
        ? <ArrowDownLeft size={14} className="text-blue-500" />
        : <ArrowUpRight size={14} className="text-emerald-500" />,
    },
    { key: 'from_addr', header: 'From', sortable: true },
    { key: 'to_addr', header: 'To' },
    {
      key: 'body',
      header: 'Message',
      render: (r) => (
        <p className="truncate max-w-[300px] text-sm text-surface-600 dark:text-surface-400">{r.body}</p>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      render: (r) => <Badge variant="neutral" className="capitalize">{r.channel}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge variant={r.status === 'delivered' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Date',
      sortable: true,
      render: (r) => <span className="text-xs text-surface-500">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Mail size={20} className="text-primary-500" /> Messages
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">{data?.total ?? 0} messages</p>
        </div>
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          type="search"
          placeholder="Search messages…"
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
        emptyMessage="No messages found."
      />
    </div>
  );
}
