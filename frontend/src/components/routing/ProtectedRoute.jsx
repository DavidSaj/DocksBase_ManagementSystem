import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const ROLE_HOME = { staff: '/field', owner: '/', manager: '/' };

export default function ProtectedRoute({ element, allowedRoles }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <AuthSplash />;
  if (!user)     return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role] ?? '/'} replace />;
  }

  return element;
}

function AuthSplash() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a39e98" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="3"/>
        <line x1="12" y1="8" x2="12" y2="22"/>
        <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
      </svg>
    </div>
  );
}
