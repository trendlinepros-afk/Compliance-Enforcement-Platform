import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Power, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { Tenant } from '../lib/types';
import { ConfirmDialog, ErrorBanner, Spinner } from '../components/ui';
import { AgentsTab } from './tenant/AgentsTab';
import { GroupsTab } from './tenant/GroupsTab';
import { PoliciesTab } from './tenant/PoliciesTab';
import { ComplianceTab } from './tenant/ComplianceTab';
import { DriftTab } from './tenant/DriftTab';
import { SnapshotsTab } from './tenant/SnapshotsTab';

const TABS = ['agents', 'groups', 'policies', 'compliance', 'drift', 'snapshots'] as const;
type Tab = (typeof TABS)[number];

export function TenantDetailPage() {
  const { tenantId, tab } = useParams<{ tenantId: string; tab?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeTab: Tab = (TABS.includes(tab as Tab) ? tab : 'agents') as Tab;

  const { data, isLoading, error } = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api.get<Tenant>(`/tenants/${tenantId}`),
    enabled: !!tenantId,
  });

  const killMut = useMutation({
    mutationFn: (paused: boolean) => api.patch(`/tenants/${tenantId}`, { enforcementPaused: paused }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
      qc.invalidateQueries({ queryKey: ['computers', tenantId] });
      show('Tenant enforcement updated');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.del(`/tenants/${tenantId}`),
    onSuccess: () => {
      show('Tenant deleted');
      navigate('/tenants');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/tenants" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
          <ChevronLeft size={14} /> All tenants
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">{data.name}</h1>
            <div className="text-xs text-slate-500">{data.slug}</div>
          </div>
          {user?.role === 'ADMIN' && (
            <div className="flex items-center gap-2">
              <button
                className={data.enforcementPaused ? 'btn-primary' : 'btn-secondary'}
                onClick={() => killMut.mutate(!data.enforcementPaused)}
              >
                <Power size={14} />
                {data.enforcementPaused ? 'Resume tenant enforcement' : 'Pause tenant (kill switch)'}
              </button>
              <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
        {data.enforcementPaused && (
          <div className="mt-2 rounded border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            Tenant-wide kill switch is ON — agents audit but write nothing until resumed.
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-ink-800">
        {TABS.map((t) => (
          <button
            key={t}
            className={`tab ${activeTab === t ? 'tab-active' : ''}`}
            onClick={() => navigate(`/tenants/${tenantId}/${t}`)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'agents' && <AgentsTab tenant={data} />}
        {activeTab === 'groups' && <GroupsTab tenant={data} />}
        {activeTab === 'policies' && <PoliciesTab tenant={data} />}
        {activeTab === 'compliance' && <ComplianceTab tenant={data} />}
        {activeTab === 'drift' && <DriftTab tenant={data} />}
        {activeTab === 'snapshots' && <SnapshotsTab tenant={data} />}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete tenant"
          danger
          confirmLabel="Delete tenant and all data"
          message={
            <span>
              This permanently deletes <b>{data.name}</b>, all its computers, policies, snapshots, and audit history. This cannot be
              undone.
            </span>
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => deleteMut.mutate()}
        />
      )}
    </div>
  );
}
