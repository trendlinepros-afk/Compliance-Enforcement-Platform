import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, MonitorSmartphone, ShieldCheck, Wifi, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { DashboardData } from '../lib/types';
import { CompliancePill, ErrorBanner, Spinner } from '../components/ui';
import { relativeTime } from '../lib/format';

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Building2; label: string; value: string; sub?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="rounded bg-ink-800 p-2 text-accent-400">
        <Icon size={20} />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-xl font-semibold text-slate-100">{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });

  if (isLoading) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Fleet overview</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat icon={Building2} label="Tenants" value={String(data.tenantCount)} />
        <Stat icon={MonitorSmartphone} label="Computers" value={String(data.computerCount)} />
        <Stat icon={Wifi} label="Online now" value={String(data.onlineCount)} sub={`${data.computerCount - data.onlineCount} offline`} />
        <Stat icon={ShieldCheck} label="Avg compliance" value={data.avgCompliance === null ? '—' : `${data.avgCompliance}%`} />
        <Stat
          icon={AlertTriangle}
          label="Outdated agents"
          value={String(data.outdatedAgentCount)}
          sub={data.latestAgentVersion ? `latest ${data.latestAgentVersion}` : 'no release'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="border-b border-ink-800 px-4 py-2 text-sm font-semibold text-slate-200">Lowest compliance</div>
          {data.worstComputers.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">No audited machines yet.</div>
          ) : (
            <table className="w-full">
              <tbody>
                {data.worstComputers.map((c) => (
                  <tr key={c.id} className="border-b border-ink-850 last:border-0">
                    <td className="td">
                      <Link className="link" to={`/tenants/${c.tenant.id}/agents`}>
                        {c.hostname}
                      </Link>
                    </td>
                    <td className="td text-slate-400">{c.tenant.name}</td>
                    <td className="td text-right">
                      <CompliancePill percent={c.percent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="border-b border-ink-800 px-4 py-2 text-sm font-semibold text-slate-200">Recent drift remediations</div>
          {data.recentDrift.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">No drift events recorded.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full">
                <tbody>
                  {data.recentDrift.map((d) => (
                    <tr key={d.id} className="border-b border-ink-850 last:border-0">
                      <td className="td">
                        {d.computer && (
                          <Link className="link" to={`/tenants/${d.computer.tenant?.id}/drift`}>
                            {d.computer.hostname}
                          </Link>
                        )}
                      </td>
                      <td className="td text-slate-300" title={d.setting.key}>
                        {d.setting.name}
                      </td>
                      <td className="td text-right text-xs text-slate-500">{relativeTime(d.remediatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
