import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import type { SnapshotRow, Tenant } from '../../lib/types';
import { ConfirmDialog, EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { formatBytes, formatDate } from '../../lib/format';
import { useToast } from '../../lib/toast';

export function SnapshotsTab({ tenant }: { tenant: Tenant }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const [rollback, setRollback] = useState<SnapshotRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['snapshots', tenant.id],
    queryFn: () => api.get<SnapshotRow[]>(`/tenants/${tenant.id}/snapshots`),
  });

  const rollbackMut = useMutation({
    mutationFn: (snap: SnapshotRow) => api.post(`/computers/${snap.computer!.id}/commands`, { type: 'ROLLBACK', payload: { snapshotId: snap.id } }),
    onSuccess: () => {
      show('Rollback queued — enforcement will pause on that machine');
      qc.invalidateQueries({ queryKey: ['computers', tenant.id] });
      setRollback(null);
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!data || data.length === 0)
    return (
      <EmptyState>
        No snapshots yet. The agent captures a full snapshot (GroupPolicy folders, secedit export, auditpol backup, and touched
        registry values) before the first enforcement on each machine.
      </EmptyState>
    );

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="border-b border-ink-800 bg-ink-850">
            <tr>
              <th className="th">Computer</th>
              <th className="th">Captured</th>
              <th className="th">Size</th>
              <th className="th">SHA-256</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className="border-b border-ink-850 last:border-0">
                <td className="td font-medium text-slate-100">
                  {s.computer?.hostname}
                  {s.computer?.status === 'DECOMMISSIONED' && <span className="ml-1 badge bg-ink-700 text-slate-400">decommissioned</span>}
                </td>
                <td className="td text-xs text-slate-400">{formatDate(s.createdAt)}</td>
                <td className="td text-xs text-slate-400">{formatBytes(s.sizeBytes)}</td>
                <td className="td font-mono text-xs text-slate-500">{s.sha256.slice(0, 16)}…</td>
                <td className="td">
                  <div className="flex justify-end gap-1">
                    <a className="btn-ghost p-1" href={`/api/snapshots/${s.id}/download`} title="Download">
                      <Download size={14} />
                    </a>
                    <button
                      className="btn-ghost p-1"
                      title="Rollback to this snapshot"
                      disabled={s.computer?.status === 'DECOMMISSIONED'}
                      onClick={() => setRollback(s)}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rollback && (
        <ConfirmDialog
          title="Rollback to snapshot"
          danger
          confirmLabel="Rollback & pause enforcement"
          message={
            <div className="space-y-2">
              <p>
                Restore <b>{rollback.computer?.hostname}</b> to the snapshot captured <b>{formatDate(rollback.createdAt)}</b>.
              </p>
              <p className="text-amber-400">Enforcement will be automatically paused on this machine after the rollback.</p>
            </div>
          }
          onCancel={() => setRollback(null)}
          onConfirm={() => rollbackMut.mutate(rollback)}
        />
      )}
    </>
  );
}
