import { useState } from 'react';
import { useAuth, ALLOWED_ROLES } from './context/AuthContext.jsx';
import Login from './screens/Login.jsx';
import Field from './screens/Field.jsx';
import Setup from './screens/Setup.jsx';

function getSetupParams() {
  const match = window.location.pathname.match(/^\/setup\/([^/]+)\/([^/]+)\/?$/);
  if (match) return { uidb64: match[1], token: match[2] };
  return null;
}

export default function App() {
  const { user, isLoading, signIn } = useAuth();
  const [setupParams] = useState(getSetupParams);

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0c1f3d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (setupParams) {
    return (
      <Setup
        uidb64={setupParams.uidb64}
        token={setupParams.token}
        onComplete={newUser => {
          signIn(newUser);
          window.history.replaceState(null, '', '/');
        }}
      />
    );
  }

  if (!user || !ALLOWED_ROLES.has(user.role)) return <Login />;

  return <Field />;
}
