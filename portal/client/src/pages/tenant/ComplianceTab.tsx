import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';
import type { AuditResultRow, Computer, Tenant } from '../../lib/types';
import { CompliancePill, EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { MechanismBadge } from '../../components/SettingExplainer';
import { displayValue, downloadCsv, relativeTime } from '../../lib/format';

interface Rollup {
  avgCompliance: number | null;
  computers: { id: string; hostname: string; online: boolean; compliance: { percent: number | null; compliant: number; total: number; lastCheckedAt: string | null } | null }[];
}

export function ComplianceTab({ tenant }: { tenant: Tenant }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyNoncompliant, setOnlyNoncompliant] = useState(true);

  const rollupQ = useQuery({ queryKey: ['compliance', tenant.id], queryFn: () => api.get<Rollup>(`/tenants/${tenant.id}/compliance`) });

  return (
    <div className="space-y-4">
      {rollupQ.isLoading ? (
        <Spinner />
      ) : rollupQ.error ? (
        <ErrorBanner error={rollupQ.error} />
      ) : rollupQ.data ? (
        <>
          <div className="card flex items-center gap-6 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Tenant average</div>
              <div className="text-2xl font-semibold">
                <CompliancePill percent={rollupQ.data.avgCompliance} />
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {rollupQ.data.computers.length} computers · sorted worst-first
            </div>
            <button
              className="btn-secondary ml-auto"
              disabled={rollupQ.data.computers.length === 0}
              onClick={() => {
                const rows: (string | number | null)[][] = [
                  ['Hostname', 'Online', 'Compliant', 'Total', 'Compliance %', 'Last checked'],
                  ...rollupQ.data!.computers.map((c) => [
                    c.hostname,
                    c.online ? 'online' : 'offline',
                    c.compliance?.compliant ?? 0,
                    c.compliance?.total ?? 0,
                    c.compliance?.percent ?? '',
                    c.compliance?.lastCheckedAt ?? '',
                  ]),
                ];
                downloadCsv(`compliance-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
              }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-ink-800 bg-ink-850">
                <tr>
                  <th className="th">Computer</th>
                  <th className="th">Compliant / total</th>
                  <th className="th">Compliance</th>
                  <th className="th">Last checked</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {rollupQ.data.computers.map((c) => (
                  <tr key={c.id} className="border-b border-ink-850 last:border-0">
                    <td className="td font-medium text-slate-100">{c.hostname}</td>
                    <td className="td font-mono text-xs text-slate-400">
                      {c.compliance ? `${c.compliance.compliant}/${c.compliance.total}` : '—'}
                    </td>
                    <td className="td">
                      <CompliancePill percent={c.compliance?.percent ?? null} />
                    </td>
                    <td className="td text-xs text-slate-500">{relativeTime(c.compliance?.lastCheckedAt ?? null)}</td>
                    <td className="td text-right">
                      <button className="link" onClick={() => setSelected(selected === c.id ? null : c.id)}>
                        {selected === c.id ? 'Hide detail' : 'View detail'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rollupQ.data.computers.length === 0 && <EmptyState>No computers to report on.</EmptyState>}
        </>
      ) : null}

      {selected && (
        <ComputerAuditDetail
          computerId={selected}
          onlyNoncompliant={onlyNoncompliant}
          setOnlyNoncompliant={setOnlyNoncompliant}
        />
      )}
    </div>
  );
}

function ComputerAuditDetail({
  computerId,
  onlyNoncompliant,
  setOnlyNoncompliant,
}: {
  computerId: string;
  onlyNoncompliant: boolean;
  setOnlyNoncompliant: (v: boolean) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', computerId, onlyNoncompliant],
    queryFn: () => api.get<AuditResultRow[]>(`/computers/${computerId}/audit${onlyNoncompliant ? '?noncompliant=1' : ''}`),
  });
  const computerQ = useQuery({ queryKey: ['computer', computerId], queryFn: () => api.get<Computer>(`/computers/${computerId}`) });

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-200">Per-setting detail — {computerQ.data?.hostname ?? '…'}</h3>
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={onlyNoncompliant} onChange={(e) => setOnlyNoncompliant(e.target.checked)} />
          Noncompliant only
        </label>
      </div>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <ErrorBanner error={error} />
        </div>
      ) : data && data.length > 0 ? (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 border-b border-ink-800 bg-ink-850">
              <tr>
                <th className="th">Setting</th>
                <th className="th">Mechanism</th>
                <th className="th">Current</th>
                <th className="th">Required</th>
                <th className="th">Status</th>
                <th className="th">Checked</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.settingId} className="border-b border-ink-850 last:border-0">
                  <td className="td">
                    <div className="text-slate-200">{r.setting.name}</div>
                    <div className="text-xs text-slate-500">{r.setting.category}</div>
                  </td>
                  <td className="td">
                    <MechanismBadge mechanism={r.setting.mechanism} />
                  </td>
                  <td className={`td font-mono text-xs ${r.compliant ? 'text-slate-300' : 'text-red-300'}`}>{displayValue(r.currentValue)}</td>
                  <td className="td font-mono text-xs text-slate-300">{displayValue(r.requiredValue)}</td>
                  <td className="td">
                    {r.compliant ? (
                      <span className="badge bg-emerald-900 text-emerald-300">Pass</span>
                    ) : (
                      <span className="badge bg-red-900 text-red-300">Fail</span>
                    )}
                  </td>
                  <td className="td text-xs text-slate-500">{relativeTime(r.checkedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-sm text-slate-500">{onlyNoncompliant ? 'No noncompliant settings — fully compliant.' : 'No audit results yet.'}</div>
      )}
    </div>
  );
}
