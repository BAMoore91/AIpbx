import { clsx } from 'clsx';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'accent';

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const dotColors: Record<Variant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-surface-400',
  primary: 'bg-primary-500',
  accent: 'bg-accent-500',
};

export function Badge({ variant = 'neutral', children, className, dot }: BadgeProps) {
  return (
    <span className={clsx(`badge-${variant}`, className)}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  );
}
