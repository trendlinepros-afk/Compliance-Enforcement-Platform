import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Trash2, Settings2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { AssignmentRow, Computer, Group, PolicyListItem, Tenant } from '../../lib/types';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

export function PoliciesTab({ tenant }: { tenant: Tenant }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [creating, setCreating] = useState(false);
  const [cloneFrom, setCloneFrom] = useState<PolicyListItem[] | null>(null);
  const [assigning, setAssigning] = useState(false);

  const policiesQ = useQuery({ queryKey: ['policies', tenant.id], queryFn: () => api.get<PolicyListItem[]>(`/tenants/${tenant.id}/policies`) });
  const globalsQ = useQuery({ queryKey: ['policies', 'global'], queryFn: () => api.get<PolicyListItem[]>('/policies/global') });
  const assignmentsQ = useQuery({ queryKey: ['assignments', tenant.id], queryFn: () => api.get<AssignmentRow[]>(`/tenants/${tenant.id}/assignments`) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['policies', tenant.id] });
    qc.invalidateQueries({ queryKey: ['assignments', tenant.id] });
    qc.invalidateQueries({ queryKey: ['computers', tenant.id] });
  };

  const [newName, setNewName] = useState('');
  const createMut = useMutation({
    mutationFn: () => api.post<PolicyListItem>('/policies', { name: newName, tenantId: tenant.id }),
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setNewName('');
      show('Sub-policy created');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const cloneMut = useMutation({
    mutationFn: (policyId: string) => api.post(`/policies/${policyId}/clone`, { tenantId: tenant.id }),
    onSuccess: () => {
      invalidate();
      setCloneFrom(null);
      show('Policy cloned into tenant');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/policies/${id}`),
    onSuccess: () => {
      invalidate();
      show('Policy deleted');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const deleteAssignmentMut = useMutation({
    mutationFn: (id: string) => api.del(`/assignments/${id}`),
    onSuccess: () => {
      invalidate();
      show('Assignment removed');
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Sub-policies</h3>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setCloneFrom(globalsQ.data ?? [])}>
              <Copy size={14} /> Clone from global
            </button>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New sub-policy
            </button>
          </div>
        </div>
        {policiesQ.isLoading ? (
          <Spinner />
        ) : policiesQ.error ? (
          <ErrorBanner error={policiesQ.error} />
        ) : policiesQ.data && policiesQ.data.length > 0 ? (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-ink-800 bg-ink-850">
                <tr>
                  <th className="th">Policy</th>
                  <th className="th">Settings</th>
                  <th className="th">Assignments</th>
                  <th className="th">Origin</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policiesQ.data.map((p) => (
                  <tr key={p.id} className="border-b border-ink-850 last:border-0 hover:bg-ink-850/40">
                    <td className="td">
                      <Link className="link font-medium" to={`/policies/${p.id}`}>
                        {p.name}
                      </Link>
                      {p.description && <div className="text-xs text-slate-500">{p.description}</div>}
                    </td>
                    <td className="td">{p._count.settings}</td>
                    <td className="td">{p._count.assignments}</td>
                    <td className="td text-xs text-slate-400">{p.clonedFromId ? 'cloned' : 'custom'}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <Link className="btn-ghost p-1" to={`/policies/${p.id}`} title="Edit">
                          <Settings2 size={14} />
                        </Link>
                        <button className="btn-ghost p-1" title="Delete" onClick={() => deleteMut.mutate(p.id)}>
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No sub-policies. Create one from scratch or clone a global compliance standard.</EmptyState>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Assignments</h3>
          <button className="btn-primary" onClick={() => setAssigning(true)}>
            <Plus size={15} /> New assignment
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Precedence: computer &gt; group &gt; tenant default, resolved per setting. When two groups cover the same computer, the
          higher <b>priority</b> wins.
        </p>
        {assignmentsQ.data && assignmentsQ.data.length > 0 ? (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-ink-800 bg-ink-850">
                <tr>
                  <th className="th">Policy</th>
                  <th className="th">Scope</th>
                  <th className="th">Target</th>
                  <th className="th">Priority</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignmentsQ.data.map((a) => (
                  <tr key={a.id} className="border-b border-ink-850 last:border-0">
                    <td className="td">{a.policy?.name}</td>
                    <td className="td">
                      <span className="badge bg-ink-700 text-slate-300">{a.scope}</span>
                    </td>
                    <td className="td text-slate-400">{a.scope === 'GROUP' ? a.group?.name : a.scope === 'COMPUTER' ? a.computer?.hostname : 'All computers'}</td>
                    <td className="td font-mono">{a.scope === 'GROUP' ? a.priority : '—'}</td>
                    <td className="td text-right">
                      <button className="btn-ghost p-1" title="Remove" onClick={() => deleteAssignmentMut.mutate(a.id)}>
                        <Trash2 size={14} className="text-red-400" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No assignments. Assign a policy as the tenant default, to a group, or to an individual computer.</EmptyState>
        )}
      </div>

      {creating && (
        <Modal title="New sub-policy" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus placeholder="Policy name" />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!newName || createMut.isPending} onClick={() => createMut.mutate()}>
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}

      {cloneFrom && (
        <Modal title="Clone a global policy into this tenant" onClose={() => setCloneFrom(null)}>
          <div className="max-h-96 space-y-1 overflow-auto">
            {cloneFrom.map((p) => (
              <button
                key={p.id}
                className="card flex w-full items-center justify-between p-3 text-left hover:border-accent-600"
                disabled={cloneMut.isPending}
                onClick={() => cloneMut.mutate(p.id)}
              >
                <div>
                  <div className="font-medium text-slate-100">{p.name}</div>
                  <div className="text-xs text-slate-500">{p._count.settings} settings</div>
                </div>
                <Copy size={15} className="text-slate-400" />
              </button>
            ))}
          </div>
        </Modal>
      )}

      {assigning && (
        <AssignModal
          tenant={tenant}
          policies={[...(policiesQ.data ?? []), ...(globalsQ.data ?? [])]}
          onClose={() => setAssigning(false)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function AssignModal({
  tenant,
  policies,
  onClose,
  onDone,
}: {
  tenant: Tenant;
  policies: PolicyListItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { show } = useToast();
  const [policyId, setPolicyId] = useState('');
  const [scope, setScope] = useState<'TENANT' | 'GROUP' | 'COMPUTER'>('TENANT');
  const [groupId, setGroupId] = useState('');
  const [computerId, setComputerId] = useState('');
  const [priority, setPriority] = useState(0);

  const groupsQ = useQuery({ queryKey: ['groups', tenant.id], queryFn: () => api.get<Group[]>(`/tenants/${tenant.id}/groups`) });
  const computersQ = useQuery({ queryKey: ['computers', tenant.id], queryFn: () => api.get<Computer[]>(`/tenants/${tenant.id}/computers`) });

  const mut = useMutation({
    mutationFn: () =>
      api.post(`/tenants/${tenant.id}/assignments`, {
        policyId,
        scope,
        groupId: scope === 'GROUP' ? groupId : undefined,
        computerId: scope === 'COMPUTER' ? computerId : undefined,
        priority,
      }),
    onSuccess: () => {
      show('Assignment created');
      onDone();
      onClose();
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const valid = policyId && (scope === 'TENANT' || (scope === 'GROUP' && groupId) || (scope === 'COMPUTER' && computerId));

  return (
    <Modal title="New assignment" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">Policy</label>
          <select className="input" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            <option value="">Select a policy…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.type === 'GLOBAL' ? '(global)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Scope</label>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)}>
            <option value="TENANT">Tenant default (all computers)</option>
            <option value="GROUP">Group</option>
            <option value="COMPUTER">Individual computer</option>
          </select>
        </div>
        {scope === 'GROUP' && (
          <>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Group</label>
              <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Select…</option>
                {(groupsQ.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Priority (higher wins between overlapping groups)</label>
              <input className="input" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            </div>
          </>
        )}
        {scope === 'COMPUTER' && (
          <div>
            <label className="mb-1 block text-xs text-slate-400">Computer</label>
            <select className="input" value={computerId} onChange={(e) => setComputerId(e.target.value)}>
              <option value="">Select…</option>
              {(computersQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.hostname}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
            Assign
          </button>
        </div>
      </div>
    </Modal>
  );
}
