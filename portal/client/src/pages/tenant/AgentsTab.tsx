import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ArrowUpCircle, Pause, Play, RotateCcw, Trash2, Terminal, Search, History, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Computer, CommandType, Tenant } from '../../lib/types';
import { CompliancePill, EmptyState, EnforcementBadge, ErrorBanner, Modal, OnlineBadge, Spinner } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { DeployPanel } from './DeployPanel';
import { EffectivePolicyModal } from './EffectivePolicyModal';
import { CommandHistoryModal } from './CommandHistoryModal';

type StatusFilter = 'all' | 'online' | 'offline' | 'paused' | 'noncompliant' | 'outdated';

export function AgentsTab({ tenant }: { tenant: Tenant }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uninstallTarget, setUninstallTarget] = useState<Computer | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<Computer | null>(null);
  const [bulkUninstall, setBulkUninstall] = useState(false);
  const [effectiveFor, setEffectiveFor] = useState<Computer | null>(null);
  const [historyFor, setHistoryFor] = useState<Computer | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['computers', tenant.id],
    queryFn: () => api.get<Computer[]>(`/tenants/${tenant.id}/computers`),
    refetchInterval: 20_000,
  });

  // Client-side search + status filter over the fetched fleet.
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((c) => {
      if (q && !c.hostname.toLowerCase().includes(q) && !c.ipAddresses.some((ip) => ip.includes(q))) return false;
      switch (statusFilter) {
        case 'online':
          return c.online;
        case 'offline':
          return !c.online;
        case 'paused':
          return c.enforcementPaused || c.tenantEnforcementPaused;
        case 'noncompliant':
          return c.compliance?.percent != null && c.compliance.percent < 100;
        case 'outdated':
          return !c.policyUpToDate && !!c.agentVersion;
        default:
          return true;
      }
    });
  }, [data, search, statusFilter]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['computers', tenant.id] });
  };

  const cmdMut = useMutation({
    mutationFn: ({ id, type, payload }: { id: string; type: CommandType; payload?: Record<string, unknown> }) =>
      api.post(`/computers/${id}/commands`, { type, payload }),
    onSuccess: (_r, v) => {
      show(`${v.type.replace(/_/g, ' ').toLowerCase()} queued`);
      invalidate();
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const bulkMut = useMutation({
    mutationFn: ({ type, payload }: { type: CommandType; payload?: Record<string, unknown> }) =>
      api.post('/computers/bulk-commands', { computerIds: [...selected], type, payload }),
    onSuccess: (r: any, v) => {
      const ok = r.results.filter((x: any) => x.ok).length;
      show(`${v.type.replace(/_/g, ' ').toLowerCase()} queued for ${ok}/${r.results.length}`);
      setSelected(new Set());
      setBulkUninstall(false);
      invalidate();
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  // Select-all operates over the currently visible (filtered) rows.
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach((c) => next.delete(c.id));
    else filtered.forEach((c) => next.add(c.id));
    setSelected(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      <DeployPanel tenant={tenant} />

      <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="text-xs text-slate-400">
          <b className="text-slate-200">Agent broken, or left files behind after removal?</b> The Agent Cleaner fully removes the
          service, scheduled task, and every agent file from a machine (run it as admin) and reports exactly what it found, removed,
          and any path it couldn&apos;t.
        </div>
        <a className="btn-secondary whitespace-nowrap" href="/api/tools/agent-cleaner.ps1" download title="Download a standalone PowerShell cleaner (no enrollment needed)">
          <Trash2 size={14} /> Agent Cleaner
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            className="input pl-8"
            placeholder="Search hostname or IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="paused">Enforcement paused</option>
          <option value="noncompliant">Noncompliant</option>
          <option value="outdated">Policy stale</option>
        </select>
        {data && (
          <span className="text-xs text-slate-500">
            {filtered.length} of {data.length}
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 border-accent-700 bg-ink-850 px-3 py-2">
          <span className="text-sm text-slate-300">{selected.size} selected</span>
          <button className="btn-secondary" onClick={() => bulkMut.mutate({ type: 'UPDATE_NOW' })}>
            <ArrowUpCircle size={14} /> Update
          </button>
          <button className="btn-secondary" onClick={() => bulkMut.mutate({ type: 'REAUDIT' })}>
            <RefreshCw size={14} /> Re-audit
          </button>
          <button className="btn-secondary" onClick={() => bulkMut.mutate({ type: 'PAUSE_ENFORCEMENT' })}>
            <Pause size={14} /> Pause
          </button>
          <button className="btn-secondary" onClick={() => bulkMut.mutate({ type: 'RESUME_ENFORCEMENT' })}>
            <Play size={14} /> Resume
          </button>
          <button className="btn-danger" onClick={() => setBulkUninstall(true)}>
            <Trash2 size={14} /> Uninstall
          </button>
          <button className="btn-ghost ml-auto text-slate-400" onClick={() => setSelected(new Set())}>
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.length > 0 ? (
        filtered.length === 0 ? (
          <EmptyState>No agents match your search / filter.</EmptyState>
        ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="border-b border-ink-800 bg-ink-850">
              <tr>
                <th className="th w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="th">Hostname</th>
                <th className="th">IPs</th>
                <th className="th">OS</th>
                <th className="th">Agent</th>
                <th className="th">Last seen</th>
                <th className="th">Effective policy</th>
                <th className="th">Compliance</th>
                <th className="th">Enforcement</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-ink-850 last:border-0 hover:bg-ink-850/40">
                  <td className="td">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td className="td">
                    <Link to={`/computers/${c.id}`} className="link font-medium">
                      {c.hostname}
                    </Link>
                    <div>
                      <OnlineBadge online={c.online} />
                    </div>
                  </td>
                  <td className="td font-mono text-xs text-slate-400">{c.ipAddresses.join(', ') || '—'}</td>
                  <td className="td text-xs text-slate-400">
                    {c.osName}
                    <div className="text-slate-500">
                      {c.osVersion} ({c.osBuild})
                    </div>
                  </td>
                  <td className="td font-mono text-xs">{c.agentVersion || '—'}</td>
                  <td className="td text-xs text-slate-400">{relativeTime(c.lastSeenAt)}</td>
                  <td className="td text-xs">
                    {c.effectivePolicyNames.length ? (
                      <button className="link" onClick={() => setEffectiveFor(c)}>
                        {c.effectiveSettingCount} settings
                      </button>
                    ) : (
                      <span className="text-slate-500">none</span>
                    )}
                    {!c.policyUpToDate && c.agentVersion && (
                      <span className="ml-1 badge bg-amber-900 text-amber-300" title="Agent has not yet applied the latest policy">
                        stale
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <CompliancePill percent={c.compliance?.percent ?? null} />
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1">
                      <EnforcementBadge paused={c.enforcementPaused} tenantPaused={c.tenantEnforcementPaused} />
                      {c.groups.some((g) => g.name === 'Roll Back') && (
                        <span className="badge bg-rose-900 text-rose-300" title="Reverted — quarantined in the Roll Back group">
                          Rolled back
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="Re-audit" onClick={() => cmdMut.mutate({ id: c.id, type: 'REAUDIT' })}>
                        <RefreshCw size={14} />
                      </IconBtn>
                      <IconBtn title="Update now" onClick={() => cmdMut.mutate({ id: c.id, type: 'UPDATE_NOW' })}>
                        <ArrowUpCircle size={14} />
                      </IconBtn>
                      {c.enforcementPaused ? (
                        <IconBtn title="Resume enforcement" onClick={() => cmdMut.mutate({ id: c.id, type: 'RESUME_ENFORCEMENT' })}>
                          <Play size={14} />
                        </IconBtn>
                      ) : (
                        <IconBtn title="Pause enforcement" onClick={() => cmdMut.mutate({ id: c.id, type: 'PAUSE_ENFORCEMENT' })}>
                          <Pause size={14} />
                        </IconBtn>
                      )}
                      <IconBtn title="Revert changes / roll back" onClick={() => setRollbackTarget(c)}>
                        <RotateCcw size={14} />
                      </IconBtn>
                      <IconBtn title="Command history" onClick={() => setHistoryFor(c)}>
                        <History size={14} />
                      </IconBtn>
                      <IconBtn title="Uninstall" onClick={() => setUninstallTarget(c)}>
                        <Trash2 size={14} className="text-red-400" />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )
      ) : (
        <EmptyState>
          <Terminal className="mx-auto mb-2" size={20} /> No agents enrolled yet. Use the deploy panel above.
        </EmptyState>
      )}

      {rollbackTarget && (
        <RevertModal
          computer={rollbackTarget}
          onCancel={() => setRollbackTarget(null)}
          onRevertAll={() => {
            cmdMut.mutate({ id: rollbackTarget.id, type: 'ROLLBACK' });
            setRollbackTarget(null);
          }}
        />
      )}

      {uninstallTarget && (
        <UninstallModal
          title={`Uninstall agent from ${uninstallTarget.hostname}`}
          onCancel={() => setUninstallTarget(null)}
          onConfirm={(mode) => {
            cmdMut.mutate({ id: uninstallTarget.id, type: 'UNINSTALL', payload: { mode } });
            setUninstallTarget(null);
          }}
        />
      )}

      {bulkUninstall && (
        <UninstallModal
          title={`Uninstall agent from ${selected.size} machines`}
          onCancel={() => setBulkUninstall(false)}
          onConfirm={(mode) => bulkMut.mutate({ type: 'UNINSTALL', payload: { mode } })}
        />
      )}

      {effectiveFor && <EffectivePolicyModal computer={effectiveFor} onClose={() => setEffectiveFor(null)} />}
      {historyFor && <CommandHistoryModal computer={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn-ghost p-1" title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function RevertModal({
  computer,
  onCancel,
  onRevertAll,
}: {
  computer: Computer;
  onCancel: () => void;
  onRevertAll: () => void;
}) {
  const snap = computer.latestSnapshot;
  return (
    <Modal title={`Revert changes on ${computer.hostname}`} onClose={onCancel}>
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          If enforcement broke something on this machine, revert it here. Reverting moves it into this tenant&apos;s{' '}
          <b className="text-slate-100">Roll Back</b> group and pauses enforcement, so it stops following the default policy until you
          resume it.
        </p>
        <button
          className="card w-full p-3 text-left enabled:hover:border-accent-600 disabled:opacity-50"
          disabled={!snap}
          onClick={onRevertAll}
        >
          <div className="font-medium text-slate-100">Revert all changes</div>
          <div className="text-xs text-slate-400">
            {snap ? (
              <>
                Restores the pre-enforcement snapshot from {new Date(snap.createdAt).toLocaleString()} (Group Policy, security policy,
                audit policy, and the registry values it changed), runs gpupdate, and pauses enforcement.
              </>
            ) : (
              <>No pre-enforcement snapshot has been captured for this machine yet, so a full revert isn&apos;t available.</>
            )}
          </div>
        </button>
        <div className="card w-full cursor-not-allowed p-3 text-left opacity-60">
          <div className="flex items-center justify-between">
            <div className="font-medium text-slate-100">Revert specific settings</div>
            <span className="badge bg-ink-700 text-slate-400">Next agent update</span>
          </div>
          <div className="text-xs text-slate-400">
            Pick individual settings to roll back while keeping the rest enforced. Ships in the next agent release.
          </div>
        </div>
        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UninstallModal({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: (mode: 'revert' | 'leave') => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="space-y-3">
        <p className="text-sm text-slate-300">Choose what happens to the enforced settings when the agent is removed:</p>
        <button
          className="card w-full p-3 text-left hover:border-accent-600"
          onClick={() => onConfirm('revert')}
        >
          <div className="font-medium text-slate-100">Revert settings to snapshot</div>
          <div className="text-xs text-slate-400">
            Restores the pre-enforcement snapshot first, then removes the agent and every artifact it created. Recommended.
          </div>
        </button>
        <button className="card w-full p-3 text-left hover:border-accent-600" onClick={() => onConfirm('leave')}>
          <div className="font-medium text-slate-100">Leave settings in place</div>
          <div className="text-xs text-slate-400">
            Removes the agent but keeps the currently-applied hardening. The agent still cleans up its own Registry.pol baseline,
            service, and ProgramData.
          </div>
        </button>
        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
