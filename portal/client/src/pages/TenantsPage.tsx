import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { TenantSummary } from '../lib/types';
import { CompliancePill, EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';

export function TenantsPage() {
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const { data, isLoading, error } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<TenantSummary[]>('/tenants') });

  const createMut = useMutation({
    mutationFn: () => api.post<TenantSummary>('/tenants', { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setCreating(false);
      setName('');
      show('Tenant created');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Tenants</h1>
        {user?.role === 'ADMIN' && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New tenant
          </button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-ink-800 bg-ink-850">
              <tr>
                <th className="th">Tenant</th>
                <th className="th">Computers</th>
                <th className="th">Online</th>
                <th className="th">Policies</th>
                <th className="th">Groups</th>
                <th className="th">Avg compliance</th>
                <th className="th">Enforcement</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-b border-ink-850 last:border-0 hover:bg-ink-850/50">
                  <td className="td">
                    <Link className="link font-medium" to={`/tenants/${t.id}`}>
                      {t.name}
                    </Link>
                    <div className="text-xs text-slate-500">{t.slug}</div>
                  </td>
                  <td className="td">{t.computerCount}</td>
                  <td className="td">
                    <span className="font-mono">{t.onlineCount}</span>
                    <span className="text-slate-500">/{t.computerCount}</span>
                  </td>
                  <td className="td">{t.policyCount}</td>
                  <td className="td">{t.groupCount}</td>
                  <td className="td">
                    <CompliancePill percent={t.avgCompliance} />
                  </td>
                  <td className="td">
                    {t.enforcementPaused ? (
                      <span className="badge bg-amber-900 text-amber-300">Kill switch on</span>
                    ) : (
                      <span className="badge bg-emerald-900 text-emerald-300">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No tenants yet. Create one to start enrolling agents.</EmptyState>
      )}

      {creating && (
        <Modal title="New tenant" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Acme Corporation" />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!name || createMut.isPending} onClick={() => createMut.mutate()}>
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
