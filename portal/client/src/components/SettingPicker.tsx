import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, Check } from 'lucide-react';
import { api } from '../lib/api';
import type { Framework, Setting } from '../lib/types';
import { Modal, Spinner } from './ui';
import { MechanismBadge, SettingExplainer, TargetPath } from './SettingExplainer';

interface CatalogResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Setting[];
}

/** Full setting picker over the catalog: search, category, framework filter. */
export function SettingPicker({
  existingSettingIds,
  onAdd,
  onClose,
}: {
  existingSettingIds: Set<string>;
  onAdd: (setting: Setting) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [framework, setFramework] = useState('');
  const [mechanism, setMechanism] = useState('');
  const [page, setPage] = useState(1);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const catsQ = useQuery({ queryKey: ['catalog-categories'], queryFn: () => api.get<{ category: string; count: number }[]>('/catalog/categories') });
  const frameworksQ = useQuery({ queryKey: ['frameworks'], queryFn: () => api.get<Framework[]>('/frameworks') });

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (framework) params.set('framework', framework);
  if (mechanism) params.set('mechanism', mechanism);
  params.set('page', String(page));
  params.set('pageSize', '25');

  const { data, isLoading } = useQuery({
    queryKey: ['catalog', q, category, framework, mechanism, page],
    queryFn: () => api.get<CatalogResponse>(`/catalog?${params.toString()}`),
  });

  const add = (s: Setting) => {
    onAdd(s);
    setAdded(new Set(added).add(s.id));
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Modal title="Add settings from the catalog" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              className="input pl-8"
              placeholder="Search name, key, registry path…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select className="input w-auto" value={mechanism} onChange={(e) => { setMechanism(e.target.value); setPage(1); }}>
            <option value="">All mechanisms</option>
            <option value="REGISTRY_POL">Registry.pol</option>
            <option value="SECEDIT">SecEdit</option>
            <option value="AUDITPOL">AuditPol</option>
          </select>
          <select className="input w-auto" value={framework} onChange={(e) => { setFramework(e.target.value); setPage(1); }}>
            <option value="">All frameworks</option>
            {(frameworksQ.data ?? []).map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="hidden w-56 flex-shrink-0 overflow-y-auto md:block" style={{ maxHeight: '55vh' }}>
            <button
              className={`block w-full rounded px-2 py-1 text-left text-xs ${category === '' ? 'bg-ink-800 text-slate-100' : 'text-slate-400 hover:bg-ink-850'}`}
              onClick={() => { setCategory(''); setPage(1); }}
            >
              All categories
            </button>
            {(catsQ.data ?? []).map((c) => (
              <button
                key={c.category}
                className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${category === c.category ? 'bg-ink-800 text-slate-100' : 'text-slate-400 hover:bg-ink-850'}`}
                title={c.category}
                onClick={() => { setCategory(c.category); setPage(1); }}
              >
                {c.category.split(' > ').pop()} <span className="text-slate-600">({c.count})</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto" style={{ maxHeight: '55vh' }}>
            {isLoading ? (
              <Spinner />
            ) : data && data.items.length > 0 ? (
              <div className="space-y-2">
                {data.items.map((s) => {
                  const isIn = existingSettingIds.has(s.id) || added.has(s.id);
                  return (
                    <div key={s.id} className="card p-3">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-100">{s.name}</span>
                            <MechanismBadge mechanism={s.mechanism} />
                            {s.cisRef && <span className="badge bg-ink-700 text-slate-400">CIS {s.cisRef}</span>}
                          </div>
                          <TargetPath setting={s} />
                        </div>
                        <button
                          className={isIn ? 'btn-secondary flex-shrink-0' : 'btn-primary flex-shrink-0'}
                          disabled={isIn}
                          onClick={() => add(s)}
                        >
                          {isIn ? <><Check size={14} /> Added</> : <><Plus size={14} /> Add</>}
                        </button>
                      </div>
                      <SettingExplainer setting={s} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-slate-500">No settings match.</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-ink-800 pt-2 text-xs text-slate-400">
          <span>{data?.total ?? 0} settings</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
            <button className="btn-primary ml-2" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
