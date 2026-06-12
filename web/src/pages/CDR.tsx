import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Phone, ChevronLeft, Mic, Bot, User, ArrowRight,
  Search, Filter, Download,
} from 'lucide-react';
import { callsApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { AudioPlayer } from '@/components/AudioPlayer';
import { Modal } from '@/components/Modal';
import type { Call, Transcript } from '@/lib/types';
import { clsx } from 'clsx';

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const DISPOSITION_VARIANTS: Record<string, string> = {
  answered: 'success',
  no_answer: 'warning',
  busy: 'danger',
  failed: 'danger',
  voicemail: 'info',
};

const SENTIMENT_VARIANTS: Record<string, string> = {
  positive: 'success',
  neutral: 'neutral',
  negative: 'danger',
};

// ─── Call Detail View ─────────────────────────────────────────────────────────
function CallDetail({ callId, onBack }: { callId: string; onBack: () => void }) {
  const { data: call, isLoading: callLoading } = useQuery({
    queryKey: ['call', callId],
    queryFn: () => callsApi.get(callId),
  });

  const { data: transcript, isLoading: tLoading } = useQuery({
    queryKey: ['call-transcript', callId],
    queryFn: () => callsApi.transcript(callId),
    enabled: Boolean(call),
    retry: false,
  });

  const { data: recording } = useQuery({
    queryKey: ['call-recording', callId],
    queryFn: () => callsApi.recording(callId),
    enabled: Boolean(call?.recording_id),
    retry: false,
  });

  if (callLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!call) return <p className="text-surface-400">Call not found.</p>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-ghost btn-icon">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {call.from_name ?? call.from_number}
          </h2>
          <p className="text-sm text-surface-500">
            {format(new Date(call.started_at), 'MMMM d, yyyy · h:mm a')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={DISPOSITION_VARIANTS[call.disposition] as 'success' | 'warning' | 'danger' | 'info' ?? 'neutral'}>
            {call.disposition.replace('_', ' ')}
          </Badge>
          {call.sentiment && (
            <Badge variant={SENTIMENT_VARIANTS[call.sentiment] as 'success' | 'neutral' | 'danger' ?? 'neutral'}>
              {call.sentiment}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Metadata column */}
        <div className="space-y-4">
          {/* Call info */}
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">Call Details</h3>
            {[
              { label: 'Direction', value: <Badge variant="info">{call.direction}</Badge> },
              { label: 'From', value: <span>{call.from_name && `${call.from_name} · `}{call.from_number}</span> },
              { label: 'To', value: call.to_number },
              { label: 'DID', value: call.did ?? '—' },
              { label: 'Duration', value: formatDuration(call.talk_seconds) },
              { label: 'Ring', value: formatDuration(call.ring_seconds) },
              { label: 'Hold', value: formatDuration(call.hold_seconds) },
              { label: 'Hangup Cause', value: call.hangup_cause ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center text-sm">
                <span className="text-surface-500">{label}</span>
                <span className="font-medium text-surface-800 dark:text-surface-200">{value}</span>
              </div>
            ))}
          </div>

          {/* AI Summary */}
          {call.summary && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2 flex items-center gap-1">
                <Bot size={14} className="text-primary-500" /> AI Summary
              </h3>
              <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{call.summary}</p>
              {call.sentiment_score !== undefined && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-surface-500">Sentiment score:</span>
                  <div className="flex-1 h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className={clsx('h-full rounded-full', call.sentiment === 'positive' ? 'bg-emerald-500' : call.sentiment === 'negative' ? 'bg-red-500' : 'bg-surface-400')}
                      style={{ width: `${((call.sentiment_score + 1) / 2) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-surface-500">{call.sentiment_score.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {/* Recording */}
          {recording?.download_url && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2 flex items-center gap-1">
                <Mic size={14} className="text-primary-500" /> Recording
              </h3>
              <AudioPlayer src={recording.download_url} duration={recording.duration} />
            </div>
          )}
        </div>

        {/* Transcript column */}
        <div className="xl:col-span-2 card p-4">
          <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-1">
            <Phone size={14} className="text-primary-500" /> Transcript Timeline
          </h3>

          {tLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={clsx('flex gap-3', i % 2 === 0 && 'flex-row-reverse')}>
                  <div className="w-8 h-8 rounded-full bg-surface-200 dark:bg-surface-700 animate-pulse flex-shrink-0" />
                  <div className="flex-1 h-12 bg-surface-100 dark:bg-surface-700 rounded-xl animate-pulse" />
                </div>
              ))}
            </div>
          ) : !transcript ? (
            <div className="py-12 text-center text-surface-400 text-sm">
              No transcript available for this call.
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {transcript.turns.map((turn: Transcript['turns'][0], i: number) => {
                const isAgent = turn.role === 'agent' || turn.role === 'ai';
                return (
                  <div key={i} className={clsx('flex gap-2', !isAgent && 'flex-row-reverse')}>
                    <div className={clsx(
                      'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                      isAgent ? 'bg-primary-100 dark:bg-primary-900/30' : 'bg-surface-200 dark:bg-surface-700'
                    )}>
                      {turn.role === 'ai' ? (
                        <Bot size={12} className="text-primary-600 dark:text-primary-400" />
                      ) : isAgent ? (
                        <Mic size={12} className="text-primary-600 dark:text-primary-400" />
                      ) : (
                        <User size={12} className="text-surface-600" />
                      )}
                    </div>
                    <div className={clsx(
                      'flex-1 max-w-[80%] rounded-2xl px-3 py-2',
                      isAgent
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-900 dark:text-primary-100 rounded-tl-sm'
                        : 'bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 rounded-tr-sm'
                    )}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={clsx('text-2xs font-semibold uppercase tracking-wide', isAgent ? 'text-primary-500' : 'text-surface-400')}>
                          {turn.role === 'ai' ? 'AI Agent' : turn.role === 'agent' ? 'Agent' : 'Caller'}
                        </span>
                        <span className="text-2xs text-surface-400 tabular-nums">
                          {turn.start_time.toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{turn.text}</p>
                      {turn.sentiment && (
                        <div className="mt-1">
                          <Badge
                            variant={SENTIMENT_VARIANTS[turn.sentiment] as 'success' | 'neutral' | 'danger' ?? 'neutral'}
                            className="text-2xs"
                          >
                            {turn.sentiment}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CDR List ─────────────────────────────────────────────────────────────────
export default function CDR() {
  const { id: urlId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedCall, setSelectedCall] = useState<string | null>(urlId ?? null);

  // Filters
  const [direction, setDirection] = useState('');
  const [disposition, setDisposition] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['cdr', page, search, direction, disposition, dateFrom, dateTo],
    queryFn: () => callsApi.list({
      page,
      per_page: 25,
      search: search || undefined,
      direction: direction || undefined,
      disposition: disposition || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
  });

  const handleRowClick = (call: Call) => {
    setSelectedCall(call.id);
    navigate(`/cdr/${call.id}`);
  };

  if (selectedCall) {
    return (
      <CallDetail
        callId={selectedCall}
        onBack={() => { setSelectedCall(null); navigate('/cdr'); }}
      />
    );
  }

  const columns: Column<Call>[] = [
    {
      key: 'direction',
      header: '',
      width: '36px',
      render: (r) => (
        <div className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center',
          r.direction === 'inbound' ? 'bg-blue-100 dark:bg-blue-900/30' :
          r.direction === 'outbound' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-surface-100 dark:bg-surface-700'
        )}>
          {r.direction === 'inbound'
            ? <PhoneIncoming size={12} className="text-blue-600" />
            : r.direction === 'outbound'
            ? <PhoneOutgoing size={12} className="text-emerald-600" />
            : <Phone size={12} className="text-surface-400" />
          }
        </div>
      ),
    },
    {
      key: 'from_number',
      header: 'From',
      sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium text-surface-800 dark:text-surface-200">{r.from_name ?? r.from_number}</p>
          {r.from_name && <p className="text-xs text-surface-400">{r.from_number}</p>}
        </div>
      ),
    },
    {
      key: 'to_number',
      header: 'To',
      render: (r) => (
        <div className="flex items-center gap-1">
          <ArrowRight size={10} className="text-surface-300" />
          <span className="font-mono text-sm">{r.to_number}</span>
        </div>
      ),
    },
    {
      key: 'started_at',
      header: 'Date / Time',
      sortable: true,
      render: (r) => (
        <div>
          <p className="text-sm">{format(new Date(r.started_at), 'MMM d')}</p>
          <p className="text-xs text-surface-400">{format(new Date(r.started_at), 'HH:mm:ss')}</p>
        </div>
      ),
    },
    {
      key: 'talk_seconds',
      header: 'Duration',
      align: 'right',
      render: (r) => <span className="tabular-nums text-sm">{formatDuration(r.talk_seconds)}</span>,
    },
    {
      key: 'disposition',
      header: 'Status',
      render: (r) => (
        <Badge variant={DISPOSITION_VARIANTS[r.disposition] as 'success' | 'warning' | 'danger' | 'info' ?? 'neutral'}>
          {r.disposition === 'no_answer' ? 'No Answer' : r.disposition}
        </Badge>
      ),
    },
    {
      key: 'sentiment',
      header: 'Sentiment',
      render: (r) => r.sentiment
        ? <Badge variant={SENTIMENT_VARIANTS[r.sentiment] as 'success' | 'neutral' | 'danger' ?? 'neutral'}>{r.sentiment}</Badge>
        : <span className="text-surface-300 text-xs">—</span>,
    },
    {
      key: 'recording_id',
      header: '',
      render: (r) => r.recording_id
        ? <Mic size={13} className="text-primary-400" title="Has recording" />
        : null,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <PhoneCall size={20} className="text-primary-500" /> Call History
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {data?.total ?? 0} calls
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setFilterOpen(true)}>
            <Filter size={14} /> Filters
          </button>
          <button className="btn-secondary btn-sm">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Active filters */}
      {(direction || disposition || dateFrom || dateTo) && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-surface-500">Filters:</span>
          {direction && <Badge variant="primary" className="cursor-pointer" onClick={() => setDirection('')}>Direction: {direction} ×</Badge>}
          {disposition && <Badge variant="primary" className="cursor-pointer" onClick={() => setDisposition('')}>Status: {disposition} ×</Badge>}
          {dateFrom && <Badge variant="primary" className="cursor-pointer" onClick={() => setDateFrom('')}>From: {dateFrom} ×</Badge>}
          {dateTo && <Badge variant="primary" className="cursor-pointer" onClick={() => setDateTo('')}>To: {dateTo} ×</Badge>}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          type="search"
          placeholder="Search by number or name…"
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
        onRowClick={handleRowClick}
        emptyMessage="No call records found."
        sortKey="started_at"
        sortDir="desc"
      />

      {/* Filter Modal */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Calls" size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => { setDirection(''); setDisposition(''); setDateFrom(''); setDateTo(''); }}>
              Clear
            </button>
            <button className="btn-primary" onClick={() => setFilterOpen(false)}>Apply</button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Direction</label>
            <select className="select" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">All</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div>
            <label className="label">Disposition</label>
            <select className="select" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
              <option value="">All</option>
              <option value="answered">Answered</option>
              <option value="no_answer">No Answer</option>
              <option value="busy">Busy</option>
              <option value="voicemail">Voicemail</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date From</label>
              <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">Date To</label>
              <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
