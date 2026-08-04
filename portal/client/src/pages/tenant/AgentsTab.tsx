import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ArrowUpCircle, Pause, Play, RotateCcw, Trash2, Terminal } from 'lucide-react';
import { api } from '../../lib/api';
import type { Computer, CommandType, Tenant } from '../../lib/types';
import { CompliancePill, ConfirmDialog, EmptyState, EnforcementBadge, ErrorBanner, Modal, OnlineBadge, Spinner } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { DeployPanel } from './DeployPanel';
import { EffectivePolicyModal } from './EffectivePolicyModal';

export function AgentsTab({ tenant }: { tenant: Tenant }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uninstallTarget, setUninstallTarget] = useState<Computer | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<Computer | null>(null);
  const [bulkUninstall, setBulkUninstall] = useState(false);
  const [effectiveFor, setEffectiveFor] = useState<Computer | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['computers', tenant.id],
    queryFn: () => api.get<Computer[]>(`/tenants/${tenant.id}/computers`),
    refetchInterval: 20_000,
  });

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

  const allSelected = useMemo(() => data && data.length > 0 && selected.size === data.length, [data, selected]);
  const toggleAll = () => {
    if (!data) return;
    setSelected(allSelected ? new Set() : new Set(data.map((c) => c.id)));
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      <DeployPanel tenant={tenant} />

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 border-accent-700 bg-ink-850 px-3 py-2">
          <span className="text-sm text-slate-300">{selected.size} selected</span>
          <button className="btn-secondary" onClick={() => bulkMut.mutate({ type: 'UPDATE_NOW' })}>
            <ArrowUpCircle size={14} /> Update
          </button>
          <button className="btn-secondary" onClick={() => bulkMut.mutate({ type: 'REAUDIT' })}>
            <RefreshCw size={14} /> Re-audit
          </button>
          <button className="btn-danger" onClick={() => setBulkUninstall(true)}>
            <Trash2 size={14} /> Uninstall
          </button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.length > 0 ? (
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
              {data.map((c) => (
                <tr key={c.id} className="border-b border-ink-850 last:border-0 hover:bg-ink-850/40">
                  <td className="td">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td className="td">
                    <div className="font-medium text-slate-100">{c.hostname}</div>
                    <OnlineBadge online={c.online} />
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
                    <EnforcementBadge paused={c.enforcementPaused} tenantPaused={c.tenantEnforcementPaused} />
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
                      <IconBtn title="Rollback to snapshot" disabled={!c.latestSnapshot} onClick={() => setRollbackTarget(c)}>
                        <RotateCcw size={14} />
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
      ) : (
        <EmptyState>
          <Terminal className="mx-auto mb-2" size={20} /> No agents enrolled yet. Use the deploy panel above.
        </EmptyState>
      )}

      {rollbackTarget && (
        <ConfirmDialog
          title="Rollback to snapshot"
          danger
          confirmLabel="Rollback & pause enforcement"
          message={
            <div className="space-y-2">
              <p>
                Restore <b>{rollbackTarget.hostname}</b> to the snapshot captured{' '}
                <b>{rollbackTarget.latestSnapshot ? new Date(rollbackTarget.latestSnapshot.createdAt).toLocaleString() : ''}</b>.
              </p>
              <p className="text-amber-400">
                Enforcement will be automatically paused on this machine so the drift loop does not immediately re-apply the policy.
              </p>
            </div>
          }
          onCancel={() => setRollbackTarget(null)}
          onConfirm={() => {
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
