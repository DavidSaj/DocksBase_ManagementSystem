import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import Login from './screens/Login.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Accounts from './screens/Accounts.jsx';
import Finance from './screens/Finance.jsx';
import FeatureFlags from './screens/FeatureFlags.jsx';
import AuditLog from './screens/AuditLog.jsx';

function ProtectedRoute({ element }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AdminLayout>{element}</AdminLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/"        element={<ProtectedRoute element={<Dashboard />} />} />
      <Route path="/accounts" element={<ProtectedRoute element={<Accounts />} />} />
      <Route path="/finance"  element={<ProtectedRoute element={<Finance />} />} />
      <Route path="/flags"    element={<ProtectedRoute element={<FeatureFlags />} />} />
      <Route path="/audit"    element={<ProtectedRoute element={<AuditLog />} />} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  );
}
