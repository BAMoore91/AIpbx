import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Monitor, Users, Phone, PhoneForwarded,
  GitBranch, Clock, Network, Brain, BookOpen, PhoneCall,
  Mic, Mail, Voicemail, BarChart3, Settings, ChevronRight,
  Radio, Building2, Building, ShieldCheck, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/store/authStore';
import { usePermissions } from '@/hooks/usePermissions';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
  /** Permission key required to show this item. */
  permission?: string;
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
    title: 'Access',
    items: [
      { to: '/departments', icon: Building, label: 'Departments', permission: 'departments.manage' },
      { to: '/roles', icon: ShieldCheck, label: 'Roles', permission: 'roles.manage' },
    ],
  },
  {
    title: 'Platform',
    superadmin: true,
    items: [{ to: '/tenants', icon: Building2, label: 'Tenants' }],
  },
];

interface SidebarProps {
  /** Desktop icon-rail mode (md+ only). */
  collapsed?: boolean;
  /** Mobile drawer open state (< md only). */
  mobileOpen?: boolean;
  onToggle?: () => void;
  /** Close the mobile drawer (backdrop tap / nav tap / close button). */
  onClose?: () => void;
}

export function Sidebar({ collapsed = false, mobileOpen = false, onClose }: SidebarProps) {
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const { can } = usePermissions();

  const groups = NAV
    .filter((g) => !g.superadmin || role === 'superadmin')
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.permission || can(item.permission)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <aside
      className={clsx(
        'flex flex-col h-full bg-surface-900 dark:bg-surface-950 border-r border-surface-700/50 transition-all duration-200',
        // Off-canvas drawer on mobile; part of the flex layout on md+.
        'fixed inset-y-0 left-0 z-40 md:static md:z-auto',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0',
        // Full-width drawer on mobile; icon rail / full rail on desktop.
        'w-64',
        collapsed ? 'md:w-14' : 'md:w-60'
      )}
    >
      {/* Logo */}
      <div className={clsx(
        'flex items-center gap-2 px-4 py-4 border-b border-surface-700/50',
        collapsed && 'md:justify-center md:px-2'
      )}>
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
          <Phone size={14} className="text-white" />
        </div>
        <div className={clsx(collapsed && 'md:hidden')}>
          <span className="text-sm font-bold text-white">AIpbx</span>
          <span className="ml-1 text-2xs font-medium text-surface-400">console</span>
        </div>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="ml-auto md:hidden text-surface-400 hover:text-surface-200 p-1 -mr-1"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 no-scrollbar space-y-1">
        {groups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
            {group.title && (
              <p className={clsx(
                'px-3 py-1 text-2xs font-semibold text-surface-500 uppercase tracking-wider',
                collapsed && 'md:hidden'
              )}>
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
                  onClick={onClose}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                    collapsed && 'md:justify-center',
                    isActive
                      ? 'bg-primary-600/20 text-primary-300'
                      : 'text-surface-400 hover:bg-surface-700/50 hover:text-surface-200'
                  )}
                >
                  <item.icon size={16} className="flex-shrink-0" />
                  <span className={clsx('flex-1', collapsed && 'md:hidden')}>{item.label}</span>
                  {item.badge && (
                    <span className={clsx(
                      'text-2xs bg-primary-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center',
                      collapsed && 'md:hidden'
                    )}>
                      {item.badge}
                    </span>
                  )}
                  {isActive && (
                    <ChevronRight size={12} className={clsx('text-primary-400', collapsed && 'md:hidden')} />
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
