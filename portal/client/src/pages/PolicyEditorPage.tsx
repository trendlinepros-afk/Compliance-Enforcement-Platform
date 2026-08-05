import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { PolicyDetail, Setting } from '../lib/types';
import { ConfirmDialog, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { SettingExplainer, MechanismBadge, TargetPath } from '../components/SettingExplainer';
import { ValueEditor } from '../components/ValueEditor';
import { SettingPicker } from '../components/SettingPicker';

interface DraftRow {
  settingId: string;
  setting: Setting;
  value: unknown;
  enabled: boolean;
}

export function PolicyEditorPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['policy', policyId],
    queryFn: () => api.get<PolicyDetail>(`/policies/${policyId}`),
    enabled: !!policyId,
  });

  useEffect(() => {
    if (data) {
      setRows(data.settings.map((s) => ({ settingId: s.settingId, setting: s.setting, value: s.value, enabled: s.enabled })));
      setDirty(false);
    }
  }, [data]);

  const existingIds = useMemo(() => new Set(rows.map((r) => r.settingId)), [rows]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.put(`/policies/${policyId}/settings`, {
        mode: 'replace',
        settings: rows.map((r) => ({ settingId: r.settingId, value: r.value, enabled: r.enabled })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', policyId] });
      // The setting count shown on the policy lists changed — refresh them too.
      qc.invalidateQueries({ queryKey: ['policies', 'global'] });
      if (data?.tenantId) qc.invalidateQueries({ queryKey: ['policies', data.tenantId] });
      setDirty(false);
      show('Policy saved');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const resetMut = useMutation({
    mutationFn: () => api.post(`/policies/${policyId}/reset-to-seed`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', policyId] });
      // Reset changes name/description/count shown on the lists too.
      qc.invalidateQueries({ queryKey: ['policies', 'global'] });
      if (data?.tenantId) qc.invalidateQueries({ queryKey: ['policies', data.tenantId] });
      setConfirmReset(false);
      show('Policy reset to default');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const backLink = data.tenantId ? `/tenants/${data.tenantId}/policies` : '/policies';
  const canEdit = user?.role === 'ADMIN' || data.type === 'SUB';

  const addSetting = (s: Setting) => {
    if (existingIds.has(s.id)) return;
    setRows((prev) => [...prev, { settingId: s.id, setting: s, value: s.defaultValue, enabled: true }]);
    setDirty(true);
  };
  const updateRow = (settingId: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.settingId === settingId ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const removeRow = (settingId: string) => {
    setRows((prev) => prev.filter((r) => r.settingId !== settingId));
    setDirty(true);
  };

  // Group rows by top-level category for readability.
  const grouped = new Map<string, DraftRow[]>();
  for (const r of rows) {
    const top = r.setting.category.split(' > ').slice(0, 2).join(' > ');
    (grouped.get(top) ?? grouped.set(top, []).get(top)!).push(r);
  }

  return (
    <div className="space-y-4">
      <Link to={backLink} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ChevronLeft size={14} /> Back
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-100">{data.name}</h1>
            <span className="badge bg-ink-700 text-slate-300">{data.type}</span>
            {data.isSeeded && (
              <span className="badge bg-sky-900 text-sky-300" title="Ships with the platform — a ready-made compliance baseline.">
                Built-in
              </span>
            )}
          </div>
          {data.description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{data.description}</p>}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {data.isSeeded && data.seedKey && (
              <button className="btn-secondary" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={14} /> Reset to default
              </button>
            )}
            <button className="btn-secondary" onClick={() => setPicking(true)}>
              <Plus size={15} /> Add settings
            </button>
            <button className="btn-primary" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()}>
              <Save size={15} /> {dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500">{rows.length} settings in this policy</div>

      {rows.length === 0 ? (
        <EmptyState>No settings yet. Click "Add settings" to build this policy from the catalog.</EmptyState>
      ) : (
        <div className="space-y-5">
          {[...grouped.entries()].map(([cat, catRows]) => (
            <div key={cat}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat}</div>
              <div className="space-y-2">
                {catRows.map((r) => (
                  <div key={r.settingId} className={`card p-3 ${!r.enabled ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-100">{r.setting.name}</span>
                          <MechanismBadge mechanism={r.setting.mechanism} />
                          {r.setting.cisRef && <span className="badge bg-ink-700 text-slate-400">CIS {r.setting.cisRef}</span>}
                        </div>
                        <TargetPath setting={r.setting} />
                        <div className="mt-2">
                          <SettingExplainer setting={r.setting} compact />
                        </div>
                      </div>
                      <div className="w-56 flex-shrink-0 space-y-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Desired value</label>
                          {canEdit ? (
                            <ValueEditor setting={r.setting} value={r.value} onChange={(v) => updateRow(r.settingId, { value: v })} />
                          ) : (
                            <div className="font-mono text-sm text-slate-300">{String(r.value)}</div>
                          )}
                        </div>
                        {canEdit && (
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 text-xs text-slate-400">
                              <input
                                type="checkbox"
                                checked={r.enabled}
                                onChange={(e) => updateRow(r.settingId, { enabled: e.target.checked })}
                              />
                              Enabled
                            </label>
                            <button className="btn-ghost p-1" title="Remove from policy" onClick={() => removeRow(r.settingId)}>
                              <Trash2 size={14} className="text-red-400" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {picking && <SettingPicker existingSettingIds={existingIds} onAdd={addSetting} onClose={() => setPicking(false)} />}

      {confirmReset && (
        <ConfirmDialog
          title="Reset to default"
          message="Discard all edits and restore this policy to its built-in default settings and values?"
          confirmLabel="Reset to default"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => resetMut.mutate()}
        />
      )}
    </div>
  );
}
