import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Building2, LayoutDashboard, ShieldCheck, Library, BadgeCheck, Package, Users, LogOut, Server } from 'lucide-react';
import { useAuth } from '../lib/auth';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tenants', label: 'Tenants', icon: Building2, end: false },
  { to: '/policies', label: 'Global Policies', icon: ShieldCheck, end: false },
  { to: '/catalog', label: 'Settings Catalog', icon: Library, end: false },
  { to: '/frameworks', label: 'Frameworks', icon: BadgeCheck, end: false },
  { to: '/releases', label: 'Agent Releases', icon: Package, end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
          <Server size={18} className="text-accent-400" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-100">CEP</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Compliance Enforcement</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded px-3 py-2 text-sm ${
                  isActive ? 'bg-ink-800 text-slate-100' : 'text-slate-400 hover:bg-ink-850 hover:text-slate-200'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
          {user?.role === 'ADMIN' && (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `flex items-center gap-2 rounded px-3 py-2 text-sm ${
                  isActive ? 'bg-ink-800 text-slate-100' : 'text-slate-400 hover:bg-ink-850 hover:text-slate-200'
                }`
              }
            >
              <Users size={16} />
              Users
            </NavLink>
          )}
        </nav>
        <div className="border-t border-ink-800 p-3">
          <div className="mb-2 px-1 text-xs text-slate-400">
            {user?.username} · <span className="uppercase">{user?.role}</span>
          </div>
          <button
            className="btn-ghost w-full justify-start text-slate-400"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] p-6">{children}</div>
      </main>
    </div>
  );
}
