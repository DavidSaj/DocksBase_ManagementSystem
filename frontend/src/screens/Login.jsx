import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, resendVerification } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const ROLE_HOME = { staff: '/field', owner: '/', manager: '/' };

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setLoading(true);
    try {
      const user = await login(email, password);
      signIn(user);
      if (user.role === 'boater') {
        window.location.href = import.meta.env.VITE_PORTAL_URL || 'https://booking.docksbase.com';
        return;
      }
      navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'email_not_verified') {
        setUnverified(true);
      } else {
        setError('Incorrect email or password.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    try {
      await resendVerification(email);
      setResendSent(true);
    } catch { /* ignore */ }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DockBase</span>
        </div>

        <h2 className="login-title">Sign in</h2>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">Email</label>
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div className="login-field">
            <label className="login-label">Password</label>
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          {unverified && (
            <div style={{ background: '#fff8e7', border: '1px solid #f0c040', borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5 }}>
              Please verify your email before logging in.{' '}
              {resendSent
                ? <span style={{ color: '#38a860', fontWeight: 600 }}>Verification email sent!</span>
                : <button type="button" onClick={handleResend} style={{ background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12 }}>Resend verification email</button>
              }
            </div>
          )}

          <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

      </div>
    </div>
  );
}
