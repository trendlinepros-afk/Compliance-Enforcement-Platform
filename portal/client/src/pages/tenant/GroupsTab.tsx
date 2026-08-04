import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Computer, Group, Tenant } from '../../lib/types';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

export function GroupsTab({ tenant }: { tenant: Tenant }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addMembersFor, setAddMembersFor] = useState<Group | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['groups', tenant.id], queryFn: () => api.get<Group[]>(`/tenants/${tenant.id}/groups`) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['groups', tenant.id] });

  const createMut = useMutation({
    mutationFn: () => api.post(`/tenants/${tenant.id}/groups`, { name, description }),
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setName('');
      setDescription('');
      show('Group created');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/groups/${id}`),
    onSuccess: () => {
      invalidate();
      show('Group deleted');
    },
  });

  const removeMemberMut = useMutation({
    mutationFn: ({ groupId, computerId }: { groupId: string; computerId: string }) => api.del(`/groups/${groupId}/members/${computerId}`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New group
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((g) => (
            <div key={g.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-slate-100">{g.name}</div>
                  {g.description && <div className="text-xs text-slate-500">{g.description}</div>}
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost p-1" title="Add members" onClick={() => setAddMembersFor(g)}>
                    <UserPlus size={15} />
                  </button>
                  <button className="btn-ghost p-1" title="Delete group" onClick={() => deleteMut.mutate(g.id)}>
                    <Trash2 size={15} className="text-red-400" />
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Members ({g.members.length})</div>
                {g.members.length === 0 ? (
                  <div className="text-xs text-slate-500">No members</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {g.members.map((m) => (
                      <span key={m.id} className="badge bg-ink-700 text-slate-300">
                        {m.hostname}
                        <button
                          className="ml-1 text-slate-500 hover:text-red-400"
                          onClick={() => removeMemberMut.mutate({ groupId: g.id, computerId: m.id })}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {g.assignments.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Assigned policies</div>
                  <div className="flex flex-wrap gap-1">
                    {g.assignments.map((a) => (
                      <span key={a.id} className="badge bg-sky-900 text-sky-300">
                        {a.policy.name} · pri {a.priority}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No groups yet. Groups let you assign policies to a subset of a tenant's computers.</EmptyState>
      )}

      {creating && (
        <Modal title="New group" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Servers" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Description</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
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

      {addMembersFor && <AddMembersModal tenant={tenant} group={addMembersFor} onClose={() => setAddMembersFor(null)} onDone={invalidate} />}
    </div>
  );
}

function AddMembersModal({ tenant, group, onClose, onDone }: { tenant: Tenant; group: Group; onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data } = useQuery({ queryKey: ['computers', tenant.id], queryFn: () => api.get<Computer[]>(`/tenants/${tenant.id}/computers`) });
  const memberIds = new Set(group.members.map((m) => m.id));
  const candidates = (data ?? []).filter((c) => !memberIds.has(c.id));

  const addMut = useMutation({
    mutationFn: () => api.post(`/groups/${group.id}/members`, { computerIds: [...selected] }),
    onSuccess: () => {
      show('Members added');
      onDone();
      onClose();
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal title={`Add members to ${group.name}`} onClose={onClose}>
      <div className="space-y-3">
        {candidates.length === 0 ? (
          <div className="text-sm text-slate-500">All computers are already members.</div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-auto">
            {candidates.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-ink-850">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                    setSelected(next);
                  }}
                />
                <span className="text-sm text-slate-200">{c.hostname}</span>
                <span className="text-xs text-slate-500">{c.osName}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={selected.size === 0 || addMut.isPending} onClick={() => addMut.mutate()}>
            Add {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
