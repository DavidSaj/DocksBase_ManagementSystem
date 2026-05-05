import { useAuth, ALLOWED_ROLES } from './context/AuthContext.jsx';
import Login from './screens/Login.jsx';
import Field from './screens/Field.jsx';

export default function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a2d4a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (!user || !ALLOWED_ROLES.has(user.role)) return <Login />;

  return <Field />;
}
