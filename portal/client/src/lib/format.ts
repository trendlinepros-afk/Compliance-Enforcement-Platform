export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Render an arbitrary setting value (dword/string/multi/binary) for display. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Map an allowedValues list to a human label if present. */
export function labelForValue(value: unknown, allowed?: { value: unknown; label: string }[] | null): string {
  if (allowed) {
    const match = allowed.find((a) => String(a.value) === String(value));
    if (match) return match.label;
  }
  return displayValue(value);
}

export function complianceColor(percent: number | null): string {
  if (percent === null) return 'text-slate-500';
  if (percent >= 95) return 'text-emerald-400';
  if (percent >= 80) return 'text-lime-400';
  if (percent >= 60) return 'text-amber-400';
  return 'text-red-400';
}

/** Escape a CSV cell (RFC 4180) and build+download a CSV file client-side. */
export function downloadCsv(filename: string, rows: (string | number | null)[][]): void {
  const esc = (v: string | number | null): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const FRAMEWORK_COLORS: Record<string, string> = {
  cis: 'bg-sky-900 text-sky-300',
  cmmc: 'bg-violet-900 text-violet-300',
  nist_800_171: 'bg-emerald-900 text-emerald-300',
  nist_800_53: 'bg-teal-900 text-teal-300',
  hipaa: 'bg-rose-900 text-rose-300',
  soc2: 'bg-amber-900 text-amber-300',
};
