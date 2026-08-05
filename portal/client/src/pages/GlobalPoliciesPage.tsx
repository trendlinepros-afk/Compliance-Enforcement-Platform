import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { PolicyListItem } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';

function PolicyCard({ p }: { p: PolicyListItem }) {
  return (
    <Link to={`/policies/${p.id}`} className="card p-4 transition-colors hover:border-accent-600">
      <div className="mb-2 flex items-start justify-between">
        <ShieldCheck size={18} className="text-accent-400" />
        {p.isSeeded ? (
          <span className="badge bg-sky-900 text-sky-300" title="Ships with the platform — a ready-made compliance baseline you can clone into any tenant.">
            Built-in
          </span>
        ) : (
          <span className="badge bg-violet-900 text-violet-300" title="A policy you created.">
            Custom
          </span>
        )}
      </div>
      <div className="font-medium text-slate-100">{p.name}</div>
      <div className="mt-1 line-clamp-3 text-xs text-slate-500">{p.description || 'No description.'}</div>
      <div className="mt-3 flex gap-3 text-xs text-slate-400">
        <span>{p._count.settings} settings</span>
        <span>{p._count.assignments} assignments</span>
      </div>
    </Link>
  );
}

function NewPolicyTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card flex min-h-[120px] flex-col items-center justify-center gap-1.5 border-dashed p-4 text-slate-400 transition-colors hover:border-accent-600 hover:text-slate-200"
    >
      <Plus size={22} />
      <span className="text-sm font-medium">New custom policy</span>
      <span className="text-center text-xs text-slate-500">Start an empty baseline and add settings</span>
    </button>
  );
}

export function GlobalPoliciesPage() {
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['policies', 'global'],
    queryFn: () => api.get<PolicyListItem[]>('/policies/global'),
  });

  const createMut = useMutation({
    mutationFn: () => api.post<{ id: string }>('/policies', { name: name.trim(), description: description.trim() }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['policies', 'global'] });
      setCreating(false);
      setName('');
      setDescription('');
      show('Custom policy created — add settings to it now');
      navigate(`/policies/${created.id}`);
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed to create policy', 'error'),
  });

  const builtIn = (data ?? []).filter((p) => p.isSeeded);
  const custom = (data ?? []).filter((p) => !p.isSeeded);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Global policies</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Ready-made compliance baselines maintained at the MSP level. Open one to browse its settings, edit it, or clone it into a
            tenant as a sub-policy. <span className="text-slate-400">Built-in</span> baselines ship with the platform; build your own
            under <span className="text-slate-400">Custom policies</span>.
          </p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New custom policy
          </button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Built-in baselines</h2>
            {builtIn.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {builtIn.map((p) => (
                  <PolicyCard key={p.id} p={p} />
                ))}
              </div>
            ) : (
              <EmptyState>No built-in baselines.</EmptyState>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Custom policies{custom.length > 0 && <span className="ml-2 text-slate-500">{custom.length}</span>}
            </h2>
            {custom.length > 0 || isAdmin ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {custom.map((p) => (
                  <PolicyCard key={p.id} p={p} />
                ))}
                {isAdmin && <NewPolicyTile onClick={() => setCreating(true)} />}
              </div>
            ) : (
              <EmptyState>No custom policies yet.</EmptyState>
            )}
          </section>
        </>
      )}

      {creating && (
        <Modal title="New custom policy" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="e.g. Acme Standard Workstation Hardening"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Description <span className="text-slate-500">(optional)</span></label>
              <textarea
                className="input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this baseline is for."
              />
            </div>
            <p className="text-xs text-slate-500">
              Creates an empty global policy. You&apos;ll be taken straight to its editor to add settings from the catalog.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
                Create &amp; edit
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
