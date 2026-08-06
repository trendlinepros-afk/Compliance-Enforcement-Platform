import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Rocket, AlertTriangle, Info, ChevronRight, ChevronDown, ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import type { DeploymentPlan, DeploymentSettingRow, Tenant } from '../../lib/types';
import { EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(empty)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const MECH_LABEL: Record<string, string> = {
  REGISTRY_POL: 'Registry.pol',
  SECEDIT: 'secedit',
  AUDITPOL: 'auditpol',
};

export function DeploymentTab({ tenant }: { tenant: Tenant }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['deployment', tenant.id],
    queryFn: () => api.get<DeploymentPlan>(`/tenants/${tenant.id}/deployment`),
    refetchInterval: 20_000,
  });

  const deployMut = useMutation({
    mutationFn: () => api.post<{ approved: number; commandsQueued: number }>(`/tenants/${tenant.id}/deployment/deploy`),
    onSuccess: (r) => {
      show(`Deploying to ${r.commandsQueued} machine${r.commandsQueued === 1 ? '' : 's'} — they'll apply on next check-in`);
      qc.invalidateQueries({ queryKey: ['deployment', tenant.id] });
      qc.invalidateQueries({ queryKey: ['computers', tenant.id] });
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Deploy failed', 'error'),
  });

  const approvalMut = useMutation({
    mutationFn: (requireApproval: boolean) =>
      api.patch(`/tenants/${tenant.id}/deployment/settings`, { requireApproval }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deployment', tenant.id] });
      qc.invalidateQueries({ queryKey: ['computers', tenant.id] });
      show('Deployment mode updated');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const toggle = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const nothingToDeploy = data.settings.length === 0;

  return (
    <div className="space-y-4 pb-24">
      {/* Mode banner */}
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {data.requireApproval ? (
              <ShieldCheck size={18} className="mt-0.5 text-accent-400" />
            ) : (
              <ShieldAlert size={18} className="mt-0.5 text-amber-400" />
            )}
            <div>
              <div className="text-sm font-semibold text-slate-100">
                {data.requireApproval ? 'Staged deployment is ON' : 'Immediate enforcement (staged deployment OFF)'}
              </div>
              <p className="mt-0.5 max-w-2xl text-xs text-slate-400">
                {data.requireApproval ? (
                  <>
                    Agents audit continuously but <b className="text-slate-300">do not change anything</b> until you review the impact
                    below and deploy. Review what will change and what it could break, then click{' '}
                    <b className="text-slate-300">Confirm &amp; deploy</b>.
                  </>
                ) : (
                  <>Changes apply automatically as soon as a policy is assigned. Turn staging on to require review before changes hit machines.</>
                )}
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              className="btn-secondary"
              disabled={approvalMut.isPending}
              onClick={() => approvalMut.mutate(!data.requireApproval)}
            >
              {data.requireApproval ? 'Turn off staging' : 'Turn on staging'}
            </button>
          )}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Changes to apply" value={data.settings.length} />
        <Stat label="Machines affected" value={data.affectedComputers} />
        <Stat label="Awaiting deploy" value={data.pendingComputers} accent={data.pendingComputers > 0} />
        <Stat label="Total machines" value={data.totalComputers} />
      </div>

      {nothingToDeploy ? (
        <EmptyState>
          {data.totalComputers === 0
            ? 'No machines enrolled yet.'
            : data.lastCheckedAt
              ? 'Every audited machine is already compliant — nothing to deploy.'
              : 'No audit data yet. Agents report compliance within a few minutes of enrolling or a policy change.'}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">
              {data.settings.length} setting{data.settings.length === 1 ? '' : 's'} will change
            </h3>
            {data.lastCheckedAt && (
              <span className="text-xs text-slate-500">last audit {relativeTime(data.lastCheckedAt)}</span>
            )}
          </div>
          {data.settings.map((s) => (
            <SettingRow key={s.settingId} s={s} open={expanded.has(s.settingId)} onToggle={() => toggle(s.settingId)} />
          ))}
        </div>
      )}

      {/* Sticky deploy bar */}
      {!nothingToDeploy && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-ink-800 bg-ink-900/95 px-4 py-3 backdrop-blur sm:left-56">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              {data.requireApproval ? (
                <>
                  Applies <b className="text-slate-200">{data.settings.length}</b> change
                  {data.settings.length === 1 ? '' : 's'} across <b className="text-slate-200">{data.affectedComputers}</b> machine
                  {data.affectedComputers === 1 ? '' : 's'}. Agents enforce on their next check-in.
                </>
              ) : (
                <>Staging is off — changes already apply automatically. This re-approves and re-applies now.</>
              )}
            </div>
            <button className="btn-primary whitespace-nowrap" disabled={deployMut.isPending} onClick={() => deployMut.mutate()}>
              <Rocket size={15} /> Confirm &amp; deploy changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? 'text-amber-400' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function SettingRow({ s, open, onToggle }: { s: DeploymentSettingRow; open: boolean; onToggle: () => void }) {
  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-start gap-3 p-3 text-left hover:bg-ink-850/40" onClick={onToggle}>
        <div className="mt-0.5 text-slate-500">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-100">{s.name}</span>
            <span className="badge bg-ink-700 text-slate-300">{MECH_LABEL[s.mechanism] ?? s.mechanism}</span>
            <span className="text-xs text-slate-500">{s.category}</span>
          </div>
          {s.description && (
            <div className="mt-1 flex items-start gap-1 text-xs text-slate-400">
              <Info size={12} className="mt-0.5 shrink-0 text-accent-400" />
              <span>{s.description}</span>
            </div>
          )}
          {s.riskNote && (
            <div className="mt-1 flex items-start gap-1 text-xs text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span><b>What it can break:</b> {s.riskNote}</span>
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold text-slate-100">{s.nonCompliantCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">machines</div>
        </div>
      </button>
      {open && (
        <div className="border-t border-ink-800 bg-ink-950/40 px-3 py-2">
          <div className="mb-1.5 text-xs text-slate-400">
            Target value: <span className="font-mono text-slate-200">{fmtVal(s.requiredValue)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 text-left font-medium">Machine</th>
                  <th className="py-1 text-left font-medium">Current value</th>
                  <th className="py-1 text-left font-medium">→ Will become</th>
                </tr>
              </thead>
              <tbody>
                {s.computers.map((c) => (
                  <tr key={c.computerId} className="border-t border-ink-850">
                    <td className="py-1 text-slate-200">{c.hostname}</td>
                    <td className="py-1 font-mono text-slate-400">{fmtVal(c.currentValue)}</td>
                    <td className="py-1 font-mono text-emerald-400">{fmtVal(s.requiredValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
