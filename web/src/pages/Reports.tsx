import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import { BarChart3, Download, Calendar } from 'lucide-react';
import { reportsApi } from '@/lib/api';
import { Badge } from '@/components/Badge';
import { format, subDays } from 'date-fns';

const REPORT_TYPES = [
  { value: 'call_summary', label: 'Call Summary' },
  { value: 'agent_performance', label: 'Agent Performance' },
  { value: 'queue_stats', label: 'Queue Statistics' },
  { value: 'ai_agent_usage', label: 'AI Agent Usage' },
];

export default function Reports() {
  const [reportType, setReportType] = useState('call_summary');
  const [period, setPeriod] = useState('7d');

  const dateFrom = period === '7d'
    ? format(subDays(new Date(), 7), 'yyyy-MM-dd')
    : period === '30d'
    ? format(subDays(new Date(), 30), 'yyyy-MM-dd')
    : format(subDays(new Date(), 90), 'yyyy-MM-dd');

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', reportType, period],
    queryFn: () => reportsApi.generate(reportType, { date_from: dateFrom, date_to: format(new Date(), 'yyyy-MM-dd') }),
  });

  // Mock chart data for display
  const chartData = Array.from({ length: 14 }).map((_, i) => ({
    date: format(subDays(new Date(), 13 - i), 'MMM d'),
    calls: Math.floor(Math.random() * 200 + 50),
    answered: Math.floor(Math.random() * 150 + 40),
    missed: Math.floor(Math.random() * 30 + 5),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <BarChart3 size={20} className="text-primary-500" /> Reports
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">Analyze your call center performance</p>
        </div>
        <button className="btn-secondary btn-sm"><Download size={14} /> Export PDF</button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-lg">
          {REPORT_TYPES.map(rt => (
            <button
              key={rt.value}
              onClick={() => setReportType(rt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                reportType === rt.value
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
              }`}
            >
              {rt.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-lg">
          {[{ v: '7d', l: '7 Days' }, { v: '30d', l: '30 Days' }, { v: '90d', l: '90 Days' }].map(p => (
            <button
              key={p.v}
              onClick={() => setPeriod(p.v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
                period === p.v
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              <Calendar size={12} /> {p.l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary rows from API */}
      {report?.rows && report.rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {report.rows.slice(0, 8).map((row, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wide">{row.label}</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-1 tabular-nums">
                {typeof row.value === 'number' ? row.value.toLocaleString() : row.value}
              </p>
              {row.change !== undefined && (
                <Badge variant={row.change >= 0 ? 'success' : 'danger'} className="mt-1">
                  {row.change >= 0 ? '+' : ''}{row.change.toFixed(1)}%
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
          Call Volume — Last {period === '7d' ? '7' : period === '30d' ? '30' : '90'} Days
        </h3>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-surface-400">Generating report…</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12, color: '#94a3b8' }}>{v}</span>} />
              <Bar dataKey="calls" fill="#6366f1" radius={[3, 3, 0, 0]} name="Total" />
              <Bar dataKey="answered" fill="#14b8a6" radius={[3, 3, 0, 0]} name="Answered" />
              <Bar dataKey="missed" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Missed" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Trend line */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">Answer Rate Trend</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="answered"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              name="Answered"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
