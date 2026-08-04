import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { User } from '../lib/types';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

export function UsersPage() {
  const { user: me } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [pwFor, setPwFor] = useState<User | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const toggleMut = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => api.patch(`/users/${id}`, { disabled }),
    onSuccess: () => { invalidate(); show('User updated'); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });
  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'ADMIN' | 'TECH' }) => api.patch(`/users/${id}`, { role }),
    onSuccess: () => { invalidate(); show('Role updated'); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Users</h1>
          <p className="text-sm text-slate-500">MSP staff accounts. No email flows — admins create and manage users directly.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New user
        </button>
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
                <th className="th">Username</th>
                <th className="th">Role</th>
                <th className="th">Status</th>
                <th className="th">Created</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="border-b border-ink-850 last:border-0">
                  <td className="td font-medium text-slate-100">
                    {u.username}
                    {u.id === me?.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}
                  </td>
                  <td className="td">
                    <select
                      className="input w-auto py-1"
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => roleMut.mutate({ id: u.id, role: e.target.value as 'ADMIN' | 'TECH' })}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="TECH">TECH</option>
                    </select>
                  </td>
                  <td className="td">
                    {u.disabled ? <span className="badge bg-red-900 text-red-300">Disabled</span> : <span className="badge bg-emerald-900 text-emerald-300">Active</span>}
                  </td>
                  <td className="td text-xs text-slate-400">{formatDate(u.createdAt)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost p-1" title="Set password" onClick={() => setPwFor(u)}>
                        <KeyRound size={14} />
                      </button>
                      {u.id !== me?.id && (
                        <button className="btn-ghost text-xs" onClick={() => toggleMut.mutate({ id: u.id, disabled: !u.disabled })}>
                          {u.disabled ? 'Enable' : 'Disable'}
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
        <EmptyState>No users.</EmptyState>
      )}

      {creating && <CreateUserModal onClose={() => setCreating(false)} onDone={invalidate} />}
      {pwFor && <PasswordModal user={pwFor} onClose={() => setPwFor(null)} />}
    </div>
  );
}

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'TECH'>('TECH');

  const mut = useMutation({
    mutationFn: () => api.post('/users', { username, password, role }),
    onSuccess: () => { show('User created'); onDone(); onClose(); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal title="New user" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="mb-1 block text-xs text-slate-400">Username</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></div>
        <div><label className="mb-1 block text-xs text-slate-400">Password (min 10 chars)</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'TECH')}>
            <option value="TECH">TECH — read + operate</option>
            <option value="ADMIN">ADMIN — full control</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={mut.isPending || !username || password.length < 10} onClick={() => mut.mutate()}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { show } = useToast();
  const [password, setPassword] = useState('');
  const mut = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}`, { password }),
    onSuccess: () => { show('Password updated'); onClose(); },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });
  return (
    <Modal title={`Set password — ${user.username}`} onClose={onClose}>
      <div className="space-y-3">
        <input className="input" type="password" placeholder="New password (min 10 chars)" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={mut.isPending || password.length < 10} onClick={() => mut.mutate()}>Set password</button>
        </div>
      </div>
    </Modal>
  );
}
