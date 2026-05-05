import { useState } from 'react';
import { login } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const ALLOWED_ROLES = new Set(['staff', 'manager', 'owner']);

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (!ALLOWED_ROLES.has(user.role)) {
        setError('This app is for marina staff only.');
        return;
      }
      signIn(user);
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1a2d4a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>DocksBase</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Field App — Staff Login</div>
      </div>
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input
          type="email" placeholder="Email" autoComplete="email"
          value={email} onChange={e => setEmail(e.target.value)} required
          style={{ height: 52, borderRadius: 12, border: 'none', padding: '0 18px', fontSize: 16, background: 'rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}
        />
        <input
          type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)} required
          style={{ height: 52, borderRadius: 12, border: 'none', padding: '0 18px', fontSize: 16, background: 'rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}
        />
        {error && <div style={{ fontSize: 13, color: '#e74c3c', textAlign: 'center' }}>{error}</div>}
        <button type="submit" disabled={loading}
          style={{ height: 56, borderRadius: 12, background: '#d4b07a', border: 'none', fontSize: 17, fontWeight: 700, color: '#1a2d4a', cursor: 'pointer', marginTop: 4 }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
