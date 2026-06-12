import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  iconColor?: string;
  trend?: number; // percentage change
  loading?: boolean;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  iconColor = 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400',
  trend,
  loading = false,
  className,
}: StatCardProps) {
  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;

  return (
    <div className={clsx('stat-card', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider truncate">
            {title}
          </p>
          {loading ? (
            <div className="mt-1 h-8 w-24 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
          ) : (
            <p className="mt-1 text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">
              {value}
            </p>
          )}
          {subtitle && (
            <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={clsx('flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center', iconColor)}>
            {icon}
          </div>
        )}
      </div>

      {trend !== undefined && (
        <div
          className={clsx(
            'flex items-center gap-1 mt-2 text-xs font-medium',
            trendPositive && 'text-emerald-600 dark:text-emerald-400',
            trendNegative && 'text-red-500 dark:text-red-400',
            !trendPositive && !trendNegative && 'text-surface-500'
          )}
        >
          {trendPositive ? (
            <TrendingUp size={12} />
          ) : trendNegative ? (
            <TrendingDown size={12} />
          ) : (
            <Minus size={12} />
          )}
          <span>
            {trendPositive ? '+' : ''}{trend.toFixed(1)}% vs yesterday
          </span>
        </div>
      )}
    </div>
  );
}
