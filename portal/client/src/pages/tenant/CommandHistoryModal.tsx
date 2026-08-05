import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Computer, CommandRow, CommandStatus } from '../../lib/types';
import { Modal, Spinner, ErrorBanner, EmptyState } from '../../components/ui';
import { formatDate, relativeTime } from '../../lib/format';

const STATUS_STYLE: Record<CommandStatus, string> = {
  PENDING: 'bg-slate-700 text-slate-300',
  DELIVERED: 'bg-sky-900 text-sky-300',
  ACKED: 'bg-emerald-900 text-emerald-300',
  FAILED: 'bg-red-900 text-red-300',
};

/** Recent command/activity history for one agent (surfaces /computers/:id/commands). */
export function CommandHistoryModal({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['commands', computer.id],
    queryFn: () => api.get<CommandRow[]>(`/computers/${computer.id}/commands`),
    refetchInterval: 10_000,
  });

  return (
    <Modal title={`Command history — ${computer.hostname}`} onClose={onClose} wide>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.length > 0 ? (
        <div className="max-h-[65vh] overflow-auto rounded border border-ink-800">
          <table className="w-full">
            <thead className="sticky top-0 border-b border-ink-800 bg-ink-850">
              <tr>
                <th className="th">Command</th>
                <th className="th">Status</th>
                <th className="th">Issued by</th>
                <th className="th">Created</th>
                <th className="th">Acked</th>
                <th className="th">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-ink-850 last:border-0">
                  <td className="td font-mono text-xs text-slate-200">{c.type.replace(/_/g, ' ')}</td>
                  <td className="td">
                    <span className={`badge ${STATUS_STYLE[c.status]}`}>{c.status.toLowerCase()}</span>
                  </td>
                  <td className="td text-xs text-slate-400">{c.createdBy || 'system'}</td>
                  <td className="td whitespace-nowrap text-xs text-slate-500" title={formatDate(c.createdAt)}>
                    {relativeTime(c.createdAt)}
                  </td>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{c.ackedAt ? relativeTime(c.ackedAt) : '—'}</td>
                  <td className="td max-w-xs truncate text-xs text-red-300" title={c.error}>
                    {c.error || (payloadSummary(c.payload) ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No commands have been issued to this agent yet.</EmptyState>
      )}
    </Modal>
  );
}

function payloadSummary(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.mode === 'string') return `mode: ${p.mode}`;
  if (typeof p.snapshotId === 'string') return `snapshot: ${(p.snapshotId as string).slice(0, 8)}`;
  return null;
}
