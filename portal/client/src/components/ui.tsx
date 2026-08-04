import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { FRAMEWORK_COLORS, complianceColor } from '../lib/format';
import type { FrameworkBadge } from '../lib/types';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink-600 border-t-accent-500" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <div className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">{message}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function OnlineBadge({ online }: { online: boolean }) {
  return (
    <span className={`badge ${online ? 'bg-emerald-900 text-emerald-300' : 'bg-ink-700 text-slate-400'}`}>
      <span className={`mr-1 h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

export function CompliancePill({ percent }: { percent: number | null }) {
  return (
    <span className={`font-mono text-sm font-semibold ${complianceColor(percent)}`}>
      {percent === null ? '—' : `${percent}%`}
    </span>
  );
}

export function EnforcementBadge({ paused, tenantPaused }: { paused: boolean; tenantPaused?: boolean }) {
  if (tenantPaused) return <span className="badge bg-amber-900 text-amber-300">Tenant paused</span>;
  return paused ? (
    <span className="badge bg-amber-900 text-amber-300">Paused</span>
  ) : (
    <span className="badge bg-emerald-900 text-emerald-300">Active</span>
  );
}

export function FrameworkBadges({ maps, max = 20 }: { maps?: FrameworkBadge[]; max?: number }) {
  if (!maps || maps.length === 0) return null;
  // One badge per framework, showing the count of mapped controls.
  const byFramework = new Map<string, { name: string; key: string; count: number; conf: string }>();
  for (const m of maps) {
    const k = m.control.framework.key;
    const existing = byFramework.get(k);
    if (existing) existing.count++;
    else byFramework.set(k, { name: m.control.framework.name, key: k, count: 1, conf: m.confidence });
  }
  return (
    <div className="flex flex-wrap gap-1">
      {[...byFramework.values()].slice(0, max).map((f) => (
        <span key={f.key} className={`badge ${FRAMEWORK_COLORS[f.key] ?? 'bg-ink-700 text-slate-300'}`} title={`${f.count} mapped control(s)`}>
          {f.name}
          <span className="ml-1 opacity-70">{f.count}</span>
        </span>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-4 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="space-y-4">
        <div className="text-sm text-slate-300">{message}</div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Toast({ message, kind }: { message: string; kind: 'success' | 'error' }) {
  return (
    <div
      className={`fixed bottom-4 right-4 z-50 rounded px-4 py-2 text-sm shadow-lg ${
        kind === 'success' ? 'bg-emerald-700 text-white' : 'bg-red-700 text-white'
      }`}
    >
      {message}
    </div>
  );
}
