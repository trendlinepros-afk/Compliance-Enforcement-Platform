import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Framework } from '../lib/types';
import { EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { FRAMEWORK_COLORS, displayValue } from '../lib/format';

interface FrameworkDetail extends Framework {
  controls: {
    id: string;
    controlId: string;
    title: string;
    settingMaps: {
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      recommendedValue: unknown;
      setting: { id: string; key: string; name: string; category: string; mechanism: string };
    }[];
  }[];
}

export function FrameworksPage() {
  const [active, setActive] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['frameworks'], queryFn: () => api.get<Framework[]>('/frameworks') });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Compliance frameworks</h1>
        <p className="text-sm text-slate-500">Control structures and their setting mappings, with per-framework recommended values and mapping confidence.</p>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((f) => (
            <button key={f.key} className="card p-4 text-left transition-colors hover:border-accent-600" onClick={() => setActive(f.key)}>
              <span className={`badge ${FRAMEWORK_COLORS[f.key] ?? 'bg-ink-700 text-slate-300'}`}>{f.name}</span>
              <div className="mt-2 text-xs text-slate-500">{f.version}</div>
              <p className="mt-2 line-clamp-3 text-xs text-slate-400">{f.description}</p>
              <div className="mt-3 text-xs text-slate-400">{f._count?.controls ?? 0} controls</div>
            </button>
          ))}
        </div>
      ) : null}

      {/* Key by framework so the internal control-search filter resets when
          switching from one framework to another. */}
      {active && <FrameworkDetailView key={active} frameworkKey={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function FrameworkDetailView({ frameworkKey, onClose }: { frameworkKey: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['framework', frameworkKey], queryFn: () => api.get<FrameworkDetail>(`/frameworks/${frameworkKey}`) });
  const [q, setQ] = useState('');

  const controls = (data?.controls ?? []).filter(
    (c) => !q || c.controlId.toLowerCase().includes(q.toLowerCase()) || c.title.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-200">{data?.name ?? '…'}</h3>
        <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="p-4">
        <input className="input mb-3 max-w-sm" placeholder="Filter controls…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isLoading ? (
          <Spinner />
        ) : controls.length === 0 ? (
          <EmptyState>No controls match.</EmptyState>
        ) : (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto">
            {controls.map((c) => (
              <div key={c.id} className="rounded border border-ink-800 p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-accent-300">{c.controlId}</span>
                  <span className="text-sm text-slate-200">{c.title}</span>
                  <span className="ml-auto text-xs text-slate-500">{c.settingMaps.length} settings</span>
                </div>
                {c.settingMaps.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {c.settingMaps.map((m) => (
                      <div key={m.setting.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={`badge ${
                            m.confidence === 'HIGH' ? 'bg-emerald-900 text-emerald-300' : m.confidence === 'LOW' ? 'bg-ink-700 text-slate-400' : 'bg-amber-900 text-amber-300'
                          }`}
                        >
                          {m.confidence.toLowerCase()}
                        </span>
                        <span className="text-slate-300">{m.setting.name}</span>
                        {m.recommendedValue !== null && m.recommendedValue !== undefined && (
                          <span className="font-mono text-slate-500">→ {displayValue(m.recommendedValue)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
