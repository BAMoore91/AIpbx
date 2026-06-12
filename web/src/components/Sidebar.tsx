import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Monitor, Users, Phone, PhoneForwarded,
  GitBranch, Clock, Network, Brain, BookOpen, PhoneCall,
  Mic, Mail, Voicemail, BarChart3, Settings, ChevronRight,
  Radio, Building2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/store/authStore';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
  /** Only show this group to platform superadmins. */
  superadmin?: boolean;
}

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/wallboard', icon: Monitor, label: 'Live Wallboard' },
    ],
  },
  {
    title: 'Users & Phones',
    items: [
      { to: '/users', icon: Users, label: 'Users' },
      { to: '/extensions', icon: Phone, label: 'Extensions' },
      { to: '/trunks', icon: Radio, label: 'Trunks' },
    ],
  },
  {
    title: 'Call Routing',
    items: [
      { to: '/routing', icon: PhoneForwarded, label: 'Routing' },
      { to: '/queues', icon: GitBranch, label: 'Queues' },
      { to: '/ivr', icon: Network, label: 'IVR Menus' },
      { to: '/time-conditions', icon: Clock, label: 'Time Conditions' },
    ],
  },
  {
    title: 'AI',
    items: [
      { to: '/ai-agents', icon: Brain, label: 'AI Agents' },
      { to: '/knowledge-bases', icon: BookOpen, label: 'Knowledge Bases' },
    ],
  },
  {
    title: 'History',
    items: [
      { to: '/cdr', icon: PhoneCall, label: 'Call History' },
      { to: '/recordings', icon: Mic, label: 'Recordings' },
      { to: '/voicemail', icon: Voicemail, label: 'Voicemail' },
      { to: '/messages', icon: Mail, label: 'Messages' },
    ],
  },
  {
    items: [
      { to: '/reports', icon: BarChart3, label: 'Reports' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
  {
    title: 'Platform',
    superadmin: true,
    items: [{ to: '/tenants', icon: Building2, label: 'Tenants' }],
  },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const groups = NAV.filter((g) => !g.superadmin || role === 'superadmin');

  return (
    <aside
      className={clsx(
        'flex flex-col h-full bg-surface-900 dark:bg-surface-950 border-r border-surface-700/50 transition-all duration-200',
        collapsed ? 'w-14' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className={clsx(
        'flex items-center gap-2 px-4 py-4 border-b border-surface-700/50',
        collapsed && 'justify-center px-2'
      )}>
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
          <Phone size={14} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <span className="text-sm font-bold text-white">AIpbx</span>
            <span className="ml-1 text-2xs font-medium text-surface-400">console</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 no-scrollbar space-y-1">
        {groups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
            {group.title && !collapsed && (
              <p className="px-3 py-1 text-2xs font-semibold text-surface-500 uppercase tracking-wider">
                {group.title}
              </p>
            )}
            {group.items.map((item) => {
              const isActive = location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                    collapsed ? 'justify-center' : '',
                    isActive
                      ? 'bg-primary-600/20 text-primary-300'
                      : 'text-surface-400 hover:bg-surface-700/50 hover:text-surface-200'
                  )}
                >
                  <item.icon size={16} className="flex-shrink-0" />
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {!collapsed && item.badge && (
                    <span className="text-2xs bg-primary-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {item.badge}
                    </span>
                  )}
                  {!collapsed && isActive && (
                    <ChevronRight size={12} className="text-primary-400" />
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
