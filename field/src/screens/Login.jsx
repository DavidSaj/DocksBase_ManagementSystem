import { useState } from 'react';
import { login } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Brand from '../components/Brand.jsx';

const ALLOWED_ROLES = new Set(['staff', 'manager', 'owner']);

const S = {
  page:  { minHeight: '100vh', background: 'var(--db-screen)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' },
  brand: { marginBottom: 36, textAlign: 'center' },
  sub:   { fontFamily: 'var(--db-font-sans)', fontSize: 12, color: 'var(--db-gold-light)', marginTop: 10, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 600 },
  card:  { width: '100%', maxWidth: 360, background: 'var(--db-card-bg)', border: 'var(--db-card-border)', borderRadius: 'var(--db-radius-md)', padding: '28px 24px' },
  h2:    { fontFamily: 'var(--db-font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 },
  p:     { fontFamily: 'var(--db-font-sans)', fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 20, lineHeight: 1.5 },
  label: { display: 'block', fontFamily: 'var(--db-font-sans)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--db-gold-light)', marginBottom: 6 },
  field: { marginBottom: 16 },
  err:   { fontFamily: 'var(--db-font-sans)', fontSize: 13, color: 'var(--db-status-red)', background: 'rgba(224,85,85,0.12)', border: '1px solid rgba(224,85,85,0.3)', borderRadius: 'var(--db-radius-sm)', padding: '8px 12px', marginBottom: 12 },
};

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (!ALLOWED_ROLES.has(user.role)) { setError('This app is for marina staff only.'); return; }
      signIn(user);
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.brand}>
        <Brand />
        <div style={S.sub}>Staff Portal</div>
      </div>
      <div style={S.card}>
        <h2 style={S.h2}>Sign in</h2>
        <p style={S.p}>Enter your credentials to access the field app.</p>
        {error && <div style={S.err}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={S.field}>
            <label style={S.label}>Email</label>
            <input className="f-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input className="f-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button className="f-btn-primary" style={{ width: '100%', marginTop: 4, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
