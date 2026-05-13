import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api.js';

export default function StaffSetup() {
  const { uidb64, token } = useParams();
  const navigate = useNavigate();

  const [phase, setPhase]       = useState('verifying'); // 'verifying' | 'form' | 'done' | 'error'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    api.get(`/staff/setup/${uidb64}/${token}/`)
      .then(r => {
        setEmail(r.data.email);
        setPhase('form');
      })
      .catch(() => {
        setPhase('error');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      await api.post(`/staff/setup/${uidb64}/${token}/`, { password });
      setPhase('done');
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not activate account. The link may have expired.');
    } finally {
      setSaving(false);
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
          <span className="login-brand">DocksBase</span>
        </div>

        {phase === 'verifying' && (
          <p style={{ textAlign: 'center', color: 'rgba(0,0,0,0.45)', fontSize: 14, marginTop: 24 }}>
            Verifying your invite link…
          </p>
        )}

        {phase === 'error' && (
          <>
            <h2 className="login-title">Link expired</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6 }}>
              This setup link is invalid or has already been used. Ask your manager to send a new invite.
            </p>
          </>
        )}

        {phase === 'done' && (
          <>
            <h2 className="login-title">Account activated</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6, marginBottom: 20 }}>
              Your password has been set. You can now sign in.
            </p>
            <button className="login-btn" onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </button>
          </>
        )}

        {phase === 'form' && (
          <>
            <h2 className="login-title">Set your password</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20 }}>
              Setting up account for <strong>{email}</strong>
            </p>

            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label className="login-label">Password</label>
                <input
                  type="password"
                  className="login-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoFocus
                />
              </div>

              <div className="login-field">
                <label className="login-label">Confirm password</label>
                <input
                  type="password"
                  className="login-input"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                />
              </div>

              {error && (
                <div className="login-error">{error}</div>
              )}

              <button type="submit" className="login-btn" disabled={saving}>
                {saving ? 'Activating…' : 'Activate account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
