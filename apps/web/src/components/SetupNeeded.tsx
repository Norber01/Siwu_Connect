import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isSuperAdmin } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { Icon } from './Icon';

/**
 * Tells the Super Admin when an update brought new security rules or database indexes that have not
 * been installed yet (until then some features, like private chat, can be refused).
 */
export function SetupNeeded() {
  const { role } = useMe();
  const location = useLocation();
  const superAdmin = isSuperAdmin(role);
  const q = useQuery({
    queryKey: ['setupStatus'],
    queryFn: () => api<{ setupNeeded?: boolean }>('/setup/status', { method: 'GET' }),
    enabled: superAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!superAdmin || !q.data?.setupNeeded || location.pathname === '/setup') return null;
  return (
    <Link to="/setup" role="alert" className="flex items-center gap-2 bg-gold-400 px-4 py-2.5 text-sm font-bold text-[#0f2f41]">
      <Icon name="alert" className="h-5 w-5 shrink-0" />
      <span className="flex-1">An update needs setup — tap to run it</span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
