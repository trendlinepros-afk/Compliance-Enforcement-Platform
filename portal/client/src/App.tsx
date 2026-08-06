import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { TenantsPage } from './pages/TenantsPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { ComputerDetailPage } from './pages/ComputerDetailPage';
import { GlobalPoliciesPage } from './pages/GlobalPoliciesPage';
import { PolicyEditorPage } from './pages/PolicyEditorPage';
import { CatalogPage } from './pages/CatalogPage';
import { FrameworksPage } from './pages/FrameworksPage';
import { ReleasesPage } from './pages/ReleasesPage';
import { UsersPage } from './pages/UsersPage';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />
        <Route path="/tenants/:tenantId/:tab" element={<TenantDetailPage />} />
        <Route path="/computers/:computerId" element={<ComputerDetailPage />} />
        <Route path="/policies" element={<GlobalPoliciesPage />} />
        <Route path="/policies/:policyId" element={<PolicyEditorPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/frameworks" element={<FrameworksPage />} />
        <Route path="/releases" element={<ReleasesPage />} />
        <Route path="/users" element={user.role === 'ADMIN' ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
