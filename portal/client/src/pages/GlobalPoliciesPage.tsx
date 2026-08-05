import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import type { PolicyListItem } from '../lib/types';
import { EmptyState, ErrorBanner, Spinner } from '../components/ui';

export function GlobalPoliciesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['policies', 'global'], queryFn: () => api.get<PolicyListItem[]>('/policies/global') });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Global policies</h1>
        <p className="text-sm text-slate-500">
          Ready-made compliance baselines maintained at the MSP level. Open one to browse its settings, edit it, or clone it into a
          tenant as a sub-policy. <span className="text-slate-400">Built-in</span> baselines ship with the platform.
        </p>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/policies/${p.id}`} className="card p-4 transition-colors hover:border-accent-600">
              <div className="mb-2 flex items-start justify-between">
                <ShieldCheck size={18} className="text-accent-400" />
                {p.isSeeded && (
                  <span className="badge bg-sky-900 text-sky-300" title="Ships with the platform — a ready-made compliance baseline you can clone into any tenant.">
                    Built-in
                  </span>
                )}
              </div>
              <div className="font-medium text-slate-100">{p.name}</div>
              <div className="mt-1 line-clamp-3 text-xs text-slate-500">{p.description}</div>
              <div className="mt-3 flex gap-3 text-xs text-slate-400">
                <span>{p._count.settings} settings</span>
                <span>{p._count.assignments} assignments</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>No global policies.</EmptyState>
      )}
    </div>
  );
}
