import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Menu, Transition } from '@headlessui/react';
import { Building2, Check, ChevronDown, Home } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { tenantsApi, tenantContext } from '@/lib/api';

/**
 * Platform-superadmin tenant switcher. Sets the X-Tenant-Id override (via
 * tenantContext) and reloads so every query re-fetches under the chosen tenant.
 * Hidden for non-superadmins.
 */
export function TenantSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  const homeTenantId = useAuthStore((s) => s.user?.tenant_id);
  const active = tenantContext.get();

  const { data } = useQuery({
    queryKey: ['tenant-switcher'],
    queryFn: () => tenantsApi.list({ per_page: 100 }),
    enabled: role === 'superadmin',
    staleTime: 60_000,
  });

  if (role !== 'superadmin') return null;

  const tenants = data?.data ?? [];
  const activeTenant = tenants.find((t) => t.id === active);
  const impersonating = Boolean(active && active !== homeTenantId);

  const switchTo = (id: string | null) => {
    tenantContext.set(id);
    window.location.reload();
  };

  return (
    <Menu as="div" className="relative">
      <Menu.Button
        className={
          'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors ' +
          (impersonating
            ? 'bg-accent-50 border-accent-300 text-accent-700 dark:bg-accent-900/30 dark:border-accent-700 dark:text-accent-300'
            : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100')
        }
        title="Switch tenant"
      >
        <Building2 size={14} />
        <span className="max-w-[140px] truncate text-xs">
          {impersonating ? activeTenant?.name ?? 'Tenant' : 'All tenants (home)'}
        </span>
        <ChevronDown size={13} />
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items className="absolute left-0 mt-2 w-64 max-h-80 overflow-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg z-50 py-1">
          <Menu.Item>
            {() => (
              <button
                onClick={() => switchTo(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                <Home size={14} className="text-surface-400" />
                <span className="flex-1">My tenant (home)</span>
                {!impersonating && <Check size={14} className="text-primary-500" />}
              </button>
            )}
          </Menu.Item>
          <div className="my-1 border-t border-surface-100 dark:border-surface-800" />
          {tenants.map((t) => (
            <Menu.Item key={t.id}>
              {() => (
                <button
                  onClick={() => switchTo(t.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-100 dark:hover:bg-surface-800"
                >
                  <span className="flex-1 truncate">
                    {t.name}
                    <span className="ml-1 text-xs text-surface-400">{t.slug}</span>
                  </span>
                  {!t.is_active && <span className="text-2xs text-danger">suspended</span>}
                  {t.id === active && <Check size={14} className="text-primary-500" />}
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
