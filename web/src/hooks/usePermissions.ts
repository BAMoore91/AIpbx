import { useQuery } from '@tanstack/react-query';
import { accessApi } from '@/lib/api';
import type { AccessMe } from '@/lib/api';

export function usePermissions() {
  const { data: me, isLoading } = useQuery<AccessMe>({
    queryKey: ['access-me'],
    queryFn: () => accessApi.me(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  function can(permission: string, departmentId?: string): boolean {
    if (!me) return false;
    if (me.superadmin) return true;
    if (me.global.includes(permission)) return true;
    if (departmentId && me.byDepartment[departmentId]?.includes(permission)) return true;
    return false;
  }

  return { isLoading, can, me };
}
