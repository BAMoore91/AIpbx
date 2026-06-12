import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import {
  PhoneCall, PhoneIncoming, PhoneMissed, Clock,
  TrendingUp, Activity, Users, Headphones,
} from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { wsClient } from '@/lib/ws';
import { useCallStore } from '@/store/callStore';
import { StatCard } from '@/components/StatCard';
import { Badge } from '@/components/Badge';
import type { DashboardStats, WSEvent } from '@/lib/types';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const SENTIMENT_COLORS = {
  positive: '#10b981',
  neutral:  '#6366f1',
  negative: '#ef4444',
};

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { activeCalls } = useCallStore();

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.stats,
    refetchInterval: 60_000,
  });

  // Refresh stats on call events
  useEffect(() => {
    const unsub = wsClient.on('*', (e: WSEvent) => {
      if (['call.started', 'call.ended', 'call.updated'].includes(e.type)) {
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      }
    });
    return unsub;
  }, [queryClient]);

  const sentimentData = stats
    ? [
        { name: 'Positive', value: stats.sentiment_breakdown.positive, color: SENTIMENT_COLORS.positive },
        { name: 'Neutral',  value: stats.sentiment_breakdown.neutral,  color: SENTIMENT_COLORS.neutral },
        { name: 'Negative', value: stats.sentiment_breakdown.negative, color: SENTIMENT_COLORS.negative },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">Dashboard</h1>
          <p className="text-sm text-surface-500 mt-0.5">Real-time call metrics and KPIs</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-surface-500">Live</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Calls"
          value={activeCalls.length}
          icon={<Activity size={18} />}
          iconColor="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
          loading={isLoading}
          subtitle="Right now"
        />
        <StatCard
          title="Calls Today"
          value={stats?.calls_today ?? 0}
          icon={<PhoneCall size={18} />}
          iconColor="bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
          loading={isLoading}
          trend={4.2}
        />
        <StatCard
          title="Answered"
          value={stats?.answered_today ?? 0}
          icon={<PhoneIncoming size={18} />}
          iconColor="bg-accent-100 text-accent-600 dark:bg-accent-900/30 dark:text-accent-400"
          loading={isLoading}
          subtitle={stats ? `${Math.round((stats.answered_today / Math.max(stats.calls_today, 1)) * 100)}% answer rate` : ''}
        />
        <StatCard
          title="Missed"
          value={stats?.missed_today ?? 0}
          icon={<PhoneMissed size={18} />}
          iconColor="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
          loading={isLoading}
          trend={-1.8}
        />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Avg Handle Time"
          value={stats ? formatDuration(stats.avg_handle_time) : '—'}
          icon={<Clock size={18} />}
          iconColor="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
          loading={isLoading}
        />
        <StatCard
          title="Queue SLA"
          value={stats ? `${stats.queue_sla_pct.toFixed(1)}%` : '—'}
          icon={<TrendingUp size={18} />}
          iconColor="bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
          loading={isLoading}
          subtitle="Within service level"
        />
        <StatCard
          title="Positive Sentiment"
          value={stats ? `${stats.sentiment_breakdown.positive}%` : '—'}
          icon={<Headphones size={18} />}
          iconColor="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
          loading={isLoading}
        />
        <StatCard
          title="Active Agents"
          value={activeCalls.filter(c => c.extension_id).length}
          icon={<Users size={18} />}
          iconColor="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
          loading={isLoading}
          subtitle="On calls"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calls by hour */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            Call Volume — Today
          </h3>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-surface-400">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={stats?.calls_by_hour ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="callsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="answeredGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Area
                  type="monotone"
                  dataKey="calls"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#callsGrad)"
                  name="Total"
                />
                <Area
                  type="monotone"
                  dataKey="answered"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  fill="url(#answeredGrad)"
                  name="Answered"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Sentiment breakdown */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            Sentiment Breakdown
          </h3>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-surface-400">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={sentimentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {sentimentData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value}%`, '']}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ fontSize: 12, color: '#94a3b8' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom row: Live calls + Queue status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active calls */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">Active Calls</h3>
            <Badge variant="success" dot>{activeCalls.length} live</Badge>
          </div>
          {activeCalls.length === 0 ? (
            <p className="text-sm text-surface-400 py-6 text-center">No active calls</p>
          ) : (
            <div className="space-y-2">
              {activeCalls.slice(0, 5).map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-700/50"
                >
                  <div>
                    <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {call.from_name ?? call.from_number}
                    </p>
                    <p className="text-xs text-surface-500">→ {call.to_number}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={call.status === 'answered' ? 'success' : 'warning'}>
                      {call.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {activeCalls.length > 5 && (
                <p className="text-xs text-surface-400 text-center">+{activeCalls.length - 5} more</p>
              )}
            </div>
          )}
        </div>

        {/* Queue SLA bar */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">Top Queues</h3>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
              ))}
            </div>
          ) : (stats?.top_queues?.length ?? 0) === 0 ? (
            <p className="text-sm text-surface-400 py-6 text-center">No queue data</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats?.top_queues ?? []} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} unit="%" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={80} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v}%`, 'SLA']}
                />
                <Bar dataKey="sla" radius={[0, 4, 4, 0]} name="SLA %">
                  {(stats?.top_queues ?? []).map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.sla >= 80 ? '#10b981' : entry.sla >= 60 ? '#f59e0b' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
