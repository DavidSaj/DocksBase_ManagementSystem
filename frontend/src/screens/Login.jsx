import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const ROLE_HOME = { boater: '/portal', staff: '/field', owner: '/', manager: '/' };

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      signIn(user);
      navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setLoading(false);
    }
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

          <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
