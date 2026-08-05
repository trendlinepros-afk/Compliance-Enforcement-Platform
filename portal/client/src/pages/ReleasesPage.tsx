import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, Star, Trash2, Download, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { AgentRelease } from '../lib/types';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

interface ReleasesResponse {
  releases: AgentRelease[];
  sourceRepo: string;
}

export function ReleasesPage() {
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [registering, setRegistering] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['releases'],
    queryFn: () => api.get<ReleasesResponse>('/releases'),
    // Auto-refresh so a CI build that finishes while this page is open appears.
    refetchInterval: 30_000,
  });
  const releases = data?.releases ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['releases'] });

  const syncMut = useMutation({
    mutationFn: () => api.post<{ created: number; latestVersion: string | null }>('/releases/sync'),
    onSuccess: (r) => {
      invalidate();
      show(r.created > 0 ? `Synced ${r.created} release(s) — latest ${r.latestVersion}` : 'Up to date with GitHub');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const markLatestMut = useMutation({
    mutationFn: (id: string) => api.patch(`/releases/${id}`, { isLatest: true }),
    onSuccess: () => { invalidate(); show('Marked as latest'); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/releases/${id}`),
    onSuccess: () => { invalidate(); show('Release deleted'); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Agent releases</h1>
          <p className="text-sm text-slate-500">
            Releases published by CI are pulled in automatically from{' '}
            <code className="text-slate-400">{data?.sourceRepo ?? 'GitHub'}</code> — no manual step needed. You can also register a
            URL or upload an MSI directly. The portal proxies downloads at{' '}
            <code className="text-slate-400">/api/agent/msi/:version</code>, so agents only ever hit the portal URL.
          </p>
        </div>
        {user?.role === 'ADMIN' && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
              <RefreshCw size={14} className={syncMut.isPending ? 'animate-spin' : ''} /> Sync from GitHub
            </button>
            <button className="btn-secondary" onClick={() => setUploading(true)}>
              <Upload size={14} /> Upload MSI
            </button>
            <button className="btn-primary" onClick={() => setRegistering(true)}>
              <Plus size={15} /> Register URL
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : releases.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="border-b border-ink-800 bg-ink-850">
              <tr>
                <th className="th">Version</th>
                <th className="th">Source</th>
                <th className="th">SHA-256</th>
                <th className="th">Registered</th>
                <th className="th">Latest</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id} className="border-b border-ink-850 last:border-0">
                  <td className="td font-mono font-medium text-slate-100">{r.version}</td>
                  <td className="td">
                    <span className="badge bg-ink-700 text-slate-300">{r.source === 'UPLOADED' ? 'Uploaded' : 'GitHub URL'}</span>
                  </td>
                  <td className="td font-mono text-xs text-slate-500">{r.sha256.slice(0, 16)}…</td>
                  <td className="td text-xs text-slate-400">{formatDate(r.createdAt)}</td>
                  <td className="td">
                    {r.isLatest ? (
                      <span className="badge bg-emerald-900 text-emerald-300"><Star size={11} className="mr-1" /> latest</span>
                    ) : user?.role === 'ADMIN' ? (
                      <button className="link text-xs" onClick={() => markLatestMut.mutate(r.id)}>Mark latest</button>
                    ) : null}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <a className="btn-ghost p-1" href={`/api/agent/msi/${encodeURIComponent(r.version)}`} title="Download MSI">
                        <Download size={14} />
                      </a>
                      {user?.role === 'ADMIN' && !r.isLatest && (
                        <button className="btn-ghost p-1" title="Delete" onClick={() => deleteMut.mutate(r.id)}>
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          No releases yet. Push a <code className="text-slate-400">v*</code> tag to trigger the CI build — the published MSI is
          pulled in here automatically. Or click <b>Sync from GitHub</b>, register a URL, or upload an MSI.
        </EmptyState>
      )}

      {registering && <RegisterModal onClose={() => setRegistering(false)} onDone={invalidate} />}
      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={invalidate} />}
    </div>
  );
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const [version, setVersion] = useState('');
  const [url, setUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/releases', { version, url, sha256, notes, markLatest: true }),
    onSuccess: () => { show('Release registered'); onDone(); onClose(); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal title="Register release from GitHub URL" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="mb-1 block text-xs text-slate-400">Version</label><input className="input font-mono" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" /></div>
        <div><label className="mb-1 block text-xs text-slate-400">MSI asset URL</label><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/.../cep-agent-1.2.0.msi" /></div>
        <div><label className="mb-1 block text-xs text-slate-400">SHA-256 (64 hex)</label><input className="input font-mono text-xs" value={sha256} onChange={(e) => setSha256(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-slate-400">Release notes</label><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={mut.isPending || !version || !url || sha256.length !== 64} onClick={() => mut.mutate()}>Register & mark latest</button>
        </div>
      </div>
    </Modal>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('Choose an MSI file');
      if (!version) throw new Error('Version is required');
      const form = new FormData();
      form.append('msi', file);
      form.append('version', version);
      form.append('notes', notes);
      form.append('markLatest', 'true');
      return api.upload('/releases/upload', form);
    },
    onSuccess: () => { show('MSI uploaded'); onDone(); onClose(); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal title="Upload MSI" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="mb-1 block text-xs text-slate-400">Version</label><input className="input font-mono" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" /></div>
        <div><label className="mb-1 block text-xs text-slate-400">MSI file</label><input ref={fileRef} type="file" accept=".msi" className="input" /></div>
        <div><label className="mb-1 block text-xs text-slate-400">Release notes</label><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Uploading…' : 'Upload & mark latest'}</button>
        </div>
      </div>
    </Modal>
  );
}
