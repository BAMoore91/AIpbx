import { useEffect, useState } from 'react';
import { useCallStore } from '@/store/callStore';
import { queuesApi } from '@/lib/api';
import { Badge } from '@/components/Badge';
import { PhoneCall, Clock, Users, TrendingUp } from 'lucide-react';
import { clsx } from 'clsx';
import type { Queue, QueueStats } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

function CallTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return <span className="tabular-nums">{m}:{s.toString().padStart(2,'0')}</span>;
}

export default function LiveWallboard() {
  const { activeCalls, queueStats } = useCallStore();

  const { data: queuesData } = useQuery({
    queryKey: ['queues-wallboard'],
    queryFn: () => queuesApi.list({ per_page: 50 }),
    refetchInterval: 30_000,
  });
  const queues: Queue[] = queuesData?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">Live Wallboard</h1>
          <p className="text-sm text-surface-500 mt-0.5">Real-time call center activity</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Live</span>
        </div>
      </div>

      {/* Summary strips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Calls', value: activeCalls.length, icon: PhoneCall, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { label: 'Waiting', value: Object.values(queueStats).reduce((a, q) => a + q.waiting, 0), icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Agents on Calls', value: activeCalls.filter(c => c.extension_id).length, icon: Users, color: 'text-primary-600', bg: 'bg-primary-50 dark:bg-primary-900/20' },
          { label: 'Queues Active', value: queues.length, icon: TrendingUp, color: 'text-accent-600', bg: 'bg-accent-50 dark:bg-accent-900/20' },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', s.bg)}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className="text-xs font-medium text-surface-500">{s.label}</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Active Calls Table */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            Active Calls ({activeCalls.length})
          </h2>
          {activeCalls.length === 0 ? (
            <div className="py-12 text-center text-surface-400 text-sm">No active calls</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Status</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCalls.map((call) => (
                    <tr key={call.id}>
                      <td>
                        <div>
                          <p className="font-medium text-surface-800 dark:text-surface-200 text-sm">
                            {call.from_name ?? call.from_number}
                          </p>
                          {call.from_name && (
                            <p className="text-xs text-surface-400">{call.from_number}</p>
                          )}
                        </div>
                      </td>
                      <td className="text-sm">{call.to_number}</td>
                      <td>
                        <Badge variant={call.status === 'answered' ? 'success' : 'warning'}>
                          {call.status}
                        </Badge>
                      </td>
                      <td className="text-sm text-surface-600 dark:text-surface-400">
                        <CallTimer startedAt={call.started_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Queue Stats */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            Queue Status
          </h2>
          {queues.length === 0 ? (
            <div className="py-12 text-center text-surface-400 text-sm">No queues configured</div>
          ) : (
            <div className="space-y-3">
              {queues.map((q) => {
                const qs: QueueStats | undefined = queueStats[q.id];
                const sla = qs?.service_level_pct ?? 0;
                return (
                  <div key={q.id} className="p-3 rounded-xl bg-surface-50 dark:bg-surface-700/50 border border-surface-100 dark:border-surface-700">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-surface-800 dark:text-surface-200">{q.name}</p>
                        <p className="text-xs text-surface-500">Ext {q.number}</p>
                      </div>
                      <Badge variant={sla >= 80 ? 'success' : sla >= 60 ? 'warning' : 'danger'}>
                        SLA {sla.toFixed(0)}%
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: 'Waiting', value: qs?.waiting ?? 0 },
                        { label: 'Active',  value: qs?.active ?? 0 },
                        { label: 'Avail',   value: qs?.agents_available ?? 0 },
                        { label: 'Paused',  value: qs?.agents_paused ?? 0 },
                      ].map((s) => (
                        <div key={s.label} className="bg-white dark:bg-surface-800 rounded-lg p-1.5">
                          <p className="text-base font-bold text-surface-900 dark:text-surface-100 tabular-nums">{s.value}</p>
                          <p className="text-2xs text-surface-400 uppercase">{s.label}</p>
                        </div>
                      ))}
                    </div>
                    {/* SLA bar */}
                    <div className="mt-2 h-1.5 bg-surface-200 dark:bg-surface-600 rounded-full overflow-hidden">
                      <div
                        className={clsx(
                          'h-full rounded-full transition-all duration-500',
                          sla >= 80 ? 'bg-emerald-500' : sla >= 60 ? 'bg-amber-500' : 'bg-red-500'
                        )}
                        style={{ width: `${sla}%` }}
                      />
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
