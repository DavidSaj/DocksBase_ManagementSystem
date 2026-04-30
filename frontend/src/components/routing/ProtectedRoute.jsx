import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const ROLE_HOME = { boater: '/portal', staff: '/field', owner: '/', manager: '/' };

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
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    </div>
  );
}
