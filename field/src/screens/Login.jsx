import { useState } from 'react';
import { login } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Brand from '../components/Brand.jsx';

const ALLOWED_ROLES = new Set(['staff', 'manager', 'owner']);

const S = {
  page:  { minHeight: '100vh', background: '#0c1f3d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' },
  brand: { marginBottom: 36 },
  sub:   { fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 12, color: 'rgba(245,240,230,0.45)', marginTop: 10, letterSpacing: '1.5px', textTransform: 'uppercase' },
  card:  { width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' },
  h2:    { fontFamily: 'Jost, system-ui, sans-serif', fontSize: 16, fontWeight: 700, color: '#0c1f3d', marginBottom: 4 },
  p:     { fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.45)', marginBottom: 20, lineHeight: 1.5 },
  label: { display: 'block', fontFamily: 'Jost, system-ui, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'rgba(0,0,0,0.4)', marginBottom: 6 },
  input: { width: '100%', padding: '11px 13px', fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 15, border: '1.5px solid rgba(0,0,0,0.15)', borderRadius: 8, outline: 'none', boxSizing: 'border-box', color: '#1a1a1a', background: '#fff' },
  field: { marginBottom: 16 },
  btn:   { width: '100%', padding: '14px 0', borderRadius: 8, background: '#0c1f3d', color: '#fff', border: 'none', fontFamily: 'Jost, system-ui, sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: '0.3px', cursor: 'pointer', marginTop: 4 },
  err:   { fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 13, color: '#c0392b', background: 'rgba(192,57,43,0.07)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 },
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
            <input style={S.input} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
