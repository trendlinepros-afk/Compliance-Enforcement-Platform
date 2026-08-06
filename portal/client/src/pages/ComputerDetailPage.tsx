import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  RefreshCw,
  ArrowUpCircle,
  Pause,
  Play,
  RotateCcw,
  Download,
} from 'lucide-react';
import { api } from '../lib/api';
import { CompliancePill, EmptyState, ErrorBanner, OnlineBadge, Spinner } from '../components/ui';
import { relativeTime } from '../lib/format';
import { useToast } from '../lib/toast';

interface Disk {
  name: string;
  totalBytes: number;
  freeBytes: number;
}
interface Metrics {
  cpuPercent?: number;
  cpuCores?: number;
  memTotalBytes?: number;
  memUsedBytes?: number;
  uptimeSeconds?: number;
  disks?: Disk[];
}
interface ComputerDetail {
  id: string;
  tenant: { id: string; name: string };
  hostname: string;
  ipAddresses: string[];
  osName: string;
  osVersion: string;
  osBuild: string;
  agentVersion: string;
  lastSeenAt: string | null;
  online: boolean;
  status: string;
  enforcementPaused: boolean;
  enforcementState: 'ACTIVE' | 'PAUSED' | 'TENANT_PAUSED' | 'PENDING_DEPLOYMENT' | 'ROLLED_BACK';
  effectiveSettingCount: number;
  effectivePolicyNames: string[];
  policyUpToDate: boolean;
  firstEnforcedAt: string | null;
  createdAt: string;
  groups: { id: string; name: string }[];
  compliance: { percent: number | null; total: number; compliant: number; lastCheckedAt: string | null } | null;
  metrics: Metrics | null;
  metricsAt: string | null;
}
interface AuditRow {
  settingId: string;
  setting: { key: string; name: string; category: string; description: string; riskNote: string; mechanism: string };
  currentValue: unknown;
  requiredValue: unknown;
  compliant: boolean;
  checkedAt: string;
}
interface DriftRow {
  id: string;
  beforeValue: unknown;
  afterValue: unknown;
  remediatedAt: string;
  setting: { key: string; name: string; category: string };
}
interface SnapshotRow {
  id: string;
  sizeBytes: number;
  sha256: string;
  note: string;
  createdAt: string;
}

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtUptime(s?: number): string {
  if (!s || s <= 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(empty)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const STATE: Record<ComputerDetail['enforcementState'], { label: string; cls: string }> = {
  ACTIVE: { label: 'Enforcing', cls: 'bg-emerald-900 text-emerald-300' },
  PAUSED: { label: 'Enforcement paused', cls: 'bg-amber-900 text-amber-300' },
  TENANT_PAUSED: { label: 'Tenant kill switch', cls: 'bg-amber-900 text-amber-300' },
  PENDING_DEPLOYMENT: { label: 'Pending deployment', cls: 'bg-sky-900 text-sky-300' },
  ROLLED_BACK: { label: 'Rolled back', cls: 'bg-rose-900 text-rose-300' },
};

function Bar({ used, total, warn }: { used: number; total: number; warn?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const danger = pct >= 90;
  const color = danger ? 'bg-red-400' : warn || pct >= 75 ? 'bg-amber-400' : 'bg-accent-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-ink-800">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ComputerDetailPage() {
  const { computerId } = useParams<{ computerId: string }>();
  const qc = useQueryClient();
  const { show } = useToast();

  const detail = useQuery({
    queryKey: ['computer', computerId],
    queryFn: () => api.get<ComputerDetail>(`/computers/${computerId}`),
    enabled: !!computerId,
    refetchInterval: 20_000,
  });
  const audit = useQuery({
    queryKey: ['computer', computerId, 'audit'],
    queryFn: () => api.get<AuditRow[]>(`/computers/${computerId}/audit?noncompliant=1`),
    enabled: !!computerId,
  });
  const drift = useQuery({
    queryKey: ['computer', computerId, 'drift'],
    queryFn: () => api.get<DriftRow[]>(`/computers/${computerId}/drift`),
    enabled: !!computerId,
  });
  const snaps = useQuery({
    queryKey: ['computer', computerId, 'snapshots'],
    queryFn: () => api.get<SnapshotRow[]>(`/computers/${computerId}/snapshots`),
    enabled: !!computerId,
  });

  const cmdMut = useMutation({
    mutationFn: (type: string) => api.post(`/computers/${computerId}/commands`, { type }),
    onSuccess: (_r, type) => {
      show(`${type.replace(/_/g, ' ').toLowerCase()} queued`);
      qc.invalidateQueries({ queryKey: ['computer', computerId] });
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  if (!detail.data) return null;
  const c = detail.data;
  const m = c.metrics;
  const st = STATE[c.enforcementState];

  return (
    <div className="space-y-4">
      <div>
        <Link
          to={`/tenants/${c.tenant.id}/agents`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
        >
          <ChevronLeft size={14} /> {c.tenant.name} / Agents
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-100">{c.hostname}</h1>
              <OnlineBadge online={c.online} />
              <span className={`badge ${st.cls}`}>{st.label}</span>
              {!c.policyUpToDate && c.agentVersion && (
                <span className="badge bg-amber-900 text-amber-300">policy stale</span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {c.osName} {c.osVersion} ({c.osBuild}) · agent {c.agentVersion || '—'} · {c.ipAddresses.join(', ') || 'no IP'} · last
              seen {relativeTime(c.lastSeenAt)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => cmdMut.mutate('REAUDIT')}>
              <RefreshCw size={14} /> Re-audit
            </button>
            <button className="btn-secondary" onClick={() => cmdMut.mutate('UPDATE_NOW')}>
              <ArrowUpCircle size={14} /> Update
            </button>
            {c.enforcementPaused ? (
              <button className="btn-secondary" onClick={() => cmdMut.mutate('RESUME_ENFORCEMENT')}>
                <Play size={14} /> Resume
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => cmdMut.mutate('PAUSE_ENFORCEMENT')}>
                <Pause size={14} /> Pause
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="text-xs text-slate-500">Compliance</div>
          <div className="mt-1">
            <CompliancePill percent={c.compliance?.percent ?? null} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {c.compliance ? `${c.compliance.compliant}/${c.compliance.total} settings` : 'not audited yet'}
          </div>
        </div>
        <Tile label="Effective settings" value={String(c.effectiveSettingCount)} sub={c.effectivePolicyNames.join(', ') || 'none'} />
        <Tile label="Drift events" value={String(drift.data?.length ?? 0)} sub="remediations logged" />
        <Tile
          label="First enforced"
          value={c.firstEnforcedAt ? relativeTime(c.firstEnforcedAt) : 'never'}
          sub={c.firstEnforcedAt ? 'snapshot captured' : 'no changes yet'}
        />
      </div>

      {/* System resources */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">System resources</h3>
        {m ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-slate-400">
                    <Cpu size={13} className="text-accent-400" /> CPU {m.cpuCores ? `(${m.cpuCores} cores)` : ''}
                  </span>
                  <span className="font-mono text-slate-300">{(m.cpuPercent ?? 0).toFixed(0)}%</span>
                </div>
                <Bar used={m.cpuPercent ?? 0} total={100} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-slate-400">
                    <MemoryStick size={13} className="text-accent-400" /> Memory
                  </span>
                  <span className="font-mono text-slate-300">
                    {fmtBytes(m.memUsedBytes)} / {fmtBytes(m.memTotalBytes)}
                  </span>
                </div>
                <Bar used={m.memUsedBytes ?? 0} total={m.memTotalBytes ?? 0} />
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Clock size={13} className="text-accent-400" /> Uptime{' '}
                <span className="font-mono text-slate-300">{fmtUptime(m.uptimeSeconds)}</span>
              </div>
            </div>
            <div className="space-y-3">
              {(m.disks ?? []).length === 0 && <div className="text-xs text-slate-500">No fixed disks reported.</div>}
              {(m.disks ?? []).map((d) => {
                const used = d.totalBytes - d.freeBytes;
                return (
                  <div key={d.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-slate-400">
                        <HardDrive size={13} className="text-accent-400" /> {d.name}
                      </span>
                      <span className="font-mono text-slate-300">
                        {fmtBytes(used)} / {fmtBytes(d.totalBytes)} ({fmtBytes(d.freeBytes)} free)
                      </span>
                    </div>
                    <Bar used={used} total={d.totalBytes} />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No metrics yet. CPU, memory, and disk usage appear once this machine runs an agent that reports them (v1.0.2+) and checks
            in.
          </p>
        )}
        {c.metricsAt && <div className="mt-3 text-xs text-slate-500">reported {relativeTime(c.metricsAt)}</div>}
      </div>

      {/* Non-compliant settings */}
      <Section title={`Non-compliant settings${audit.data ? ` (${audit.data.length})` : ''}`}>
        {audit.isLoading ? (
          <Spinner />
        ) : !audit.data || audit.data.length === 0 ? (
          <EmptyState>Every audited setting on this machine is compliant.</EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-800 bg-ink-850 text-xs text-slate-400">
                <tr>
                  <th className="th">Setting</th>
                  <th className="th">Current</th>
                  <th className="th">Required</th>
                  <th className="th">What it can break</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((r) => (
                  <tr key={r.settingId} className="border-b border-ink-850 last:border-0">
                    <td className="td">
                      <div className="text-slate-200">{r.setting.name}</div>
                      <div className="text-xs text-slate-500">{r.setting.category}</div>
                    </td>
                    <td className="td font-mono text-xs text-amber-400">{fmtVal(r.currentValue)}</td>
                    <td className="td font-mono text-xs text-emerald-400">{fmtVal(r.requiredValue)}</td>
                    <td className="td text-xs text-slate-400">{r.setting.riskNote || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Drift history */}
      <Section title="Recent drift remediations">
        {!drift.data || drift.data.length === 0 ? (
          <EmptyState>No drift has been remediated on this machine.</EmptyState>
        ) : (
          <div className="card divide-y divide-ink-850">
            {drift.data.slice(0, 25).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <span className="text-slate-200">{d.setting.name}</span>{' '}
                  <span className="text-xs text-slate-500">{d.setting.category}</span>
                </div>
                <div className="font-mono text-xs">
                  <span className="text-amber-400">{fmtVal(d.beforeValue)}</span>
                  <span className="text-slate-500"> → </span>
                  <span className="text-emerald-400">{fmtVal(d.afterValue)}</span>
                  <span className="ml-2 text-slate-500">{relativeTime(d.remediatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Snapshots */}
      <Section title="Snapshots">
        {!snaps.data || snaps.data.length === 0 ? (
          <EmptyState>No snapshots captured yet (the first is taken before the first enforcement).</EmptyState>
        ) : (
          <div className="card divide-y divide-ink-850">
            {snaps.data.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <span className="text-slate-200">{relativeTime(s.createdAt)}</span>{' '}
                  <span className="text-xs text-slate-500">{s.note || 'snapshot'} · {fmtBytes(s.sizeBytes)}</span>
                </div>
                <a className="btn-ghost text-slate-400" href={`/api/snapshots/${s.id}/download`} download>
                  <Download size={14} /> Download
                </a>
              </div>
            ))}
          </div>
        )}
      </Section>

      {c.status !== 'ACTIVE' && (
        <div className="rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          This computer is {c.status.toLowerCase()}.
        </div>
      )}
      <div className="pt-2 text-xs text-slate-600">
        <RotateCcw size={12} className="mr-1 inline" /> Rollback and uninstall live on the tenant&apos;s Agents tab.
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-slate-100">{value}</div>
      {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {children}
    </div>
  );
}
