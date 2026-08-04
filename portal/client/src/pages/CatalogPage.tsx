import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Upload, Plus, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { Framework, Setting } from '../lib/types';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';
import { MechanismBadge, SettingExplainer, TargetPath } from '../components/SettingExplainer';

interface CatalogResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Setting[];
}

export function CatalogPage() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [framework, setFramework] = useState('');
  const [mechanism, setMechanism] = useState('');
  const [needsDescription, setNeedsDescription] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Setting | null>(null);
  const [importing, setImporting] = useState(false);

  const catsQ = useQuery({ queryKey: ['catalog-categories'], queryFn: () => api.get<{ category: string; count: number }[]>('/catalog/categories') });
  const frameworksQ = useQuery({ queryKey: ['frameworks'], queryFn: () => api.get<Framework[]>('/frameworks') });

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (framework) params.set('framework', framework);
  if (mechanism) params.set('mechanism', mechanism);
  if (needsDescription) params.set('needsDescription', '1');
  params.set('page', String(page));
  params.set('pageSize', '40');

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalog', q, category, framework, mechanism, needsDescription, page],
    queryFn: () => api.get<CatalogResponse>(`/catalog?${params.toString()}`),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Settings catalog</h1>
          <p className="text-sm text-slate-500">The master library of GPO settings with plain-English explanations and framework mappings.</p>
        </div>
        {user?.role === 'ADMIN' && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setImporting(true)}>
              <Upload size={14} /> Baseline importer
            </button>
            <button className="btn-primary" onClick={() => setEditing({ mechanism: 'REGISTRY_POL', scope: 'MACHINE', dataType: 'dword' } as Setting)}>
              <Plus size={15} /> Add setting
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input className="input pl-8" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select className="input w-auto" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {(catsQ.data ?? []).map((c) => (
            <option key={c.category} value={c.category}>
              {c.category} ({c.count})
            </option>
          ))}
        </select>
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
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={needsDescription} onChange={(e) => { setNeedsDescription(e.target.checked); setPage(1); }} />
          Needs description
        </label>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="text-xs text-slate-500">{data.total} settings</div>
          <div className="space-y-2">
            {data.items.map((s) => (
              <div key={s.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-100">{s.name}</span>
                      <MechanismBadge mechanism={s.mechanism} />
                      {s.cisRef && <span className="badge bg-ink-700 text-slate-400">CIS {s.cisRef}</span>}
                      {s.scope === 'USER' && <span className="badge bg-ink-700 text-slate-400">per-user</span>}
                      {!s.isSeeded && <span className="badge bg-violet-900 text-violet-300">custom</span>}
                      <code className="text-xs text-slate-600">{s.key}</code>
                    </div>
                    <TargetPath setting={s} />
                    <div className="mt-2">
                      <SettingExplainer setting={s} />
                    </div>
                  </div>
                  {user?.role === 'ADMIN' && (
                    <button className="btn-ghost p-1" title="Edit" onClick={() => setEditing(s)}>
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Page {page} / {totalPages}</span>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState>No settings match your filters.</EmptyState>
      )}

      {editing && <SettingEditModal setting={editing} onClose={() => setEditing(null)} />}
      {importing && <ImporterModal onClose={() => setImporting(false)} />}
    </div>
  );
}

function SettingEditModal({ setting, onClose }: { setting: Setting; onClose: () => void }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const isNew = !setting.id;
  const [form, setForm] = useState<Partial<Setting>>({ ...setting });

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        key: form.key,
        category: form.category,
        name: form.name,
        description: form.description ?? '',
        riskNote: form.riskNote ?? '',
        mechanism: form.mechanism,
        scope: form.scope ?? 'MACHINE',
        registryHive: form.registryHive,
        registryKey: form.registryKey,
        registryValueName: form.registryValueName,
        registryValueType: form.registryValueType,
        seceditArea: form.seceditArea,
        seceditKey: form.seceditKey,
        auditSubcategory: form.auditSubcategory,
        auditGuid: form.auditGuid,
        dataType: form.dataType ?? 'dword',
        defaultValue: form.defaultValue ?? 0,
        cisRef: form.cisRef,
      };
      return isNew ? api.post('/catalog', body) : api.patch(`/catalog/${setting.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog'] });
      qc.invalidateQueries({ queryKey: ['catalog-categories'] });
      show(isNew ? 'Setting created' : 'Setting updated');
      onClose();
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const set = (patch: Partial<Setting>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal title={isNew ? 'Add custom setting' : `Edit: ${setting.name}`} onClose={onClose} wide>
      <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
        {isNew && (
          <Field label="Key (immutable)">
            <input className="input" value={form.key ?? ''} onChange={(e) => set({ key: e.target.value })} placeholder="my_custom_setting" />
          </Field>
        )}
        <Field label="Name">
          <input className="input" value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Category" span>
          <input className="input" value={form.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="Security Settings > ..." />
        </Field>
        <Field label="What it does" span>
          <textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="What it can break" span>
          <textarea className="input" rows={2} value={form.riskNote ?? ''} onChange={(e) => set({ riskNote: e.target.value })} />
        </Field>
        <Field label="Mechanism">
          <select className="input" value={form.mechanism} onChange={(e) => set({ mechanism: e.target.value as Setting['mechanism'] })}>
            <option value="REGISTRY_POL">Registry.pol</option>
            <option value="SECEDIT">SecEdit</option>
            <option value="AUDITPOL">AuditPol</option>
          </select>
        </Field>
        <Field label="Data type">
          <select className="input" value={form.dataType} onChange={(e) => set({ dataType: e.target.value })}>
            <option value="dword">dword</option>
            <option value="qword">qword</option>
            <option value="string">string</option>
            <option value="multi">multi</option>
            <option value="binary">binary</option>
          </select>
        </Field>
        {form.mechanism === 'REGISTRY_POL' && (
          <>
            <Field label="Hive"><input className="input" value={form.registryHive ?? 'HKLM'} onChange={(e) => set({ registryHive: e.target.value })} /></Field>
            <Field label="Value type"><input className="input" value={form.registryValueType ?? 'REG_DWORD'} onChange={(e) => set({ registryValueType: e.target.value })} /></Field>
            <Field label="Key path" span><input className="input font-mono text-xs" value={form.registryKey ?? ''} onChange={(e) => set({ registryKey: e.target.value })} /></Field>
            <Field label="Value name"><input className="input" value={form.registryValueName ?? ''} onChange={(e) => set({ registryValueName: e.target.value })} /></Field>
          </>
        )}
        {form.mechanism === 'SECEDIT' && (
          <>
            <Field label="Area"><input className="input" value={form.seceditArea ?? ''} onChange={(e) => set({ seceditArea: e.target.value })} placeholder="System Access" /></Field>
            <Field label="Key"><input className="input font-mono text-xs" value={form.seceditKey ?? ''} onChange={(e) => set({ seceditKey: e.target.value })} /></Field>
          </>
        )}
        {form.mechanism === 'AUDITPOL' && (
          <>
            <Field label="Subcategory"><input className="input" value={form.auditSubcategory ?? ''} onChange={(e) => set({ auditSubcategory: e.target.value })} /></Field>
            <Field label="GUID"><input className="input font-mono text-xs" value={form.auditGuid ?? ''} onChange={(e) => set({ auditGuid: e.target.value })} /></Field>
          </>
        )}
        <Field label="Default value">
          <input className="input font-mono" value={String(form.defaultValue ?? '')} onChange={(e) => set({ defaultValue: form.dataType === 'dword' ? Number(e.target.value) : e.target.value })} />
        </Field>
        <Field label="CIS ref"><input className="input" value={form.cisRef ?? ''} onChange={(e) => set({ cisRef: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={mut.isPending || !form.name || !form.category} onClick={() => mut.mutate()}>Save</button>
      </div>
    </Modal>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function ImporterModal({ onClose }: { onClose: () => void }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [policyName, setPolicyName] = useState('');
  const [report, setReport] = useState<any>(null);

  const mut = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('Choose a .PolicyRules file or LGPO backup .zip');
      const form = new FormData();
      form.append('file', file);
      if (policyName) form.append('policyName', policyName);
      return api.upload<any>('/catalog/import', form);
    },
    onSuccess: (r) => {
      setReport(r);
      qc.invalidateQueries({ queryKey: ['catalog'] });
      qc.invalidateQueries({ queryKey: ['catalog-categories'] });
      show('Import complete');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal title="Baseline importer" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Upload a Microsoft Security Compliance Toolkit <code className="text-slate-300">.PolicyRules</code> file, or an LGPO
          backup <code className="text-slate-300">.zip</code> (Registry.pol + GptTmpl.inf + audit CSV). Matching settings update
          the catalog; unknown ones are created and flagged <i>needs description</i>.
        </p>
        <div>
          <label className="mb-1 block text-xs text-slate-400">File</label>
          <input ref={fileRef} type="file" accept=".PolicyRules,.xml,.zip" className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Also create a global policy from imported values (optional)</label>
          <input className="input" value={policyName} onChange={(e) => setPolicyName(e.target.value)} placeholder="e.g. MS Windows Server 2022 Baseline" />
        </div>
        {report && (
          <div className="rounded border border-ink-700 bg-ink-950 p-3 text-xs text-slate-300">
            <div>Matched existing: <b>{report.matchedExisting}</b></div>
            <div>New settings created: <b>{report.createdSettings}</b></div>
            {report.policyName && <div>Policy created: <b>{report.policyName}</b> ({report.policyValueCount} values)</div>}
            {report.skipped?.length > 0 && <div className="text-amber-400">Skipped: {report.skipped.length}</div>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
