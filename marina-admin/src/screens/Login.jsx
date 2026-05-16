import { useState } from 'react';
import { login, mfaLoginVerify } from '../api.js';

export default function Login({ onLogin }) {
  const [step, setStep]         = useState('password'); // 'password' | 'mfa' | 'enroll-blocked'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaCode, setMfaCode]   = useState('');
  const [trustDevice, setTrust] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email, password);
      if (data.mfa_required) {
        setMfaChallenge(data.mfa_challenge_token);
        setStep('mfa');
        return;
      }
      if (data.mfa_enrollment_required) {
        setStep('enroll-blocked');
        return;
      }
      onLogin();
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'email_not_verified') {
        setError('Please verify your email before signing in.');
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await mfaLoginVerify({
        mfa_challenge_token: mfaChallenge,
        code: mfaCode,
        trust_device: trustDevice,
      });
      onLogin();
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DocksBase Enterprise</span>
        </div>

        {step === 'password' && (
          <>
            <h2 className="login-title">Sign in</h2>
            <form onSubmit={handlePasswordSubmit} className="login-form">
              <div className="login-field">
                <label className="login-label">Email</label>
                <input type="email" className="login-input" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
              </div>
              <div className="login-field">
                <label className="login-label">Password</label>
                <input type="password" className="login-input" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </>
        )}

        {step === 'mfa' && (
          <>
            <h2 className="login-title">Two-factor code</h2>
            <form onSubmit={handleMfaSubmit} className="login-form">
              <div className="login-field">
                <label className="login-label">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="login-input"
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.trim())}
                  required
                  autoFocus
                />
              </div>
              <label style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'center', marginTop: 4 }}>
                <input type="checkbox" checked={trustDevice} onChange={e => setTrust(e.target.checked)} />
                Trust this device for 30 days
              </label>
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="abtn abtn-primary login-submit" disabled={loading || !mfaCode}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>
          </>
        )}

        {step === 'enroll-blocked' && (
          <>
            <h2 className="login-title">MFA setup required</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', lineHeight: 1.5 }}>
              Your marina requires two-factor authentication. Please sign in to the marina app
              first to enroll, then return here.
            </p>
            <button
              type="button"
              className="abtn abtn-primary login-submit"
              style={{ marginTop: 16 }}
              onClick={() => { setStep('password'); setPassword(''); setError(''); }}
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
