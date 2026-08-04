import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import type { DriftRow, Tenant } from '../../lib/types';
import { EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { displayValue, formatDate } from '../../lib/format';

export function DriftTab({ tenant }: { tenant: Tenant }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['drift', tenant.id],
    queryFn: () => api.get<DriftRow[]>(`/tenants/${tenant.id}/drift`),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!data || data.length === 0)
    return <EmptyState>No drift events recorded. The agent logs one here each time it re-applies a setting that was changed out of band.</EmptyState>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[800px]">
        <thead className="border-b border-ink-800 bg-ink-850">
          <tr>
            <th className="th">When</th>
            <th className="th">Computer</th>
            <th className="th">Setting</th>
            <th className="th">Before → After</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} className="border-b border-ink-850 last:border-0">
              <td className="td whitespace-nowrap text-xs text-slate-400">{formatDate(d.remediatedAt)}</td>
              <td className="td font-medium text-slate-100">{d.computer?.hostname}</td>
              <td className="td">
                <div className="text-slate-200">{d.setting.name}</div>
                <div className="text-xs text-slate-500">{d.setting.category}</div>
              </td>
              <td className="td">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-red-300">{displayValue(d.beforeValue)}</span>
                  <ArrowRight size={12} className="text-slate-500" />
                  <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-emerald-300">{displayValue(d.afterValue)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
