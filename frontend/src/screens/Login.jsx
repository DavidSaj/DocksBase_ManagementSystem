import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, mfaLoginVerify, mfaEnrollComplete, resendVerification } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import QRCode from 'qrcode';

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

  // step: 'password' | 'mfa' | 'enroll' | 'backup-codes'
  const [step, setStep] = useState('password');

  // MFA verify state
  const [mfaState, setMfaState] = useState(null); // { challengeToken }
  const [mfaCode, setMfaCode]   = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice]     = useState(false);

  // MFA enroll state
  const [enrollState, setEnrollState] = useState(null); // { enrollmentToken, secret, qrUri }
  const [enrollCode, setEnrollCode]   = useState('');
  const [enrollQrDataUrl, setEnrollQrDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [enrolledUser, setEnrolledUser] = useState(null);

  useEffect(() => {
    if (enrollState?.qrUri) {
      QRCode.toDataURL(enrollState.qrUri).then(setEnrollQrDataUrl).catch(() => {});
    }
  }, [enrollState?.qrUri]);

  function handleNavigateAfterLogin(user) {
    signIn(user);
    if (user.role === 'boater') {
      window.location.href = import.meta.env.VITE_PORTAL_URL || 'https://booking.docksbase.com';
      return;
    }
    navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.mfa_required) {
        setMfaState({ challengeToken: result.mfa_challenge_token });
        setStep('mfa');
        return;
      }
      if (result.mfa_enrollment_required) {
        setEnrollState({
          enrollmentToken: result.mfa_enrollment_token,
          secret: result.mfa_secret,
          qrUri: result.mfa_qr_uri,
        });
        setStep('enroll');
        return;
      }
      // Case A — normal login
      handleNavigateAfterLogin(result.user);
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

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await mfaLoginVerify({
        mfa_challenge_token: mfaState.challengeToken,
        code: mfaCode,
        trust_device: trustDevice,
      });
      handleNavigateAfterLogin(result.user);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.detail || data?.code || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleEnrollSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await mfaEnrollComplete({
        mfa_enrollment_token: enrollState.enrollmentToken,
        code: enrollCode,
      });
      setBackupCodes(result.backup_codes || []);
      setEnrolledUser(result.user);
      setStep('backup-codes');
    } catch (err) {
      const data = err.response?.data;
      setError(data?.detail || data?.code || 'Invalid code. Please try again.');
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

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n')).catch(() => {});
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  if (step === 'backup-codes') {
    return (
      <div className="login-shell">
        <div className="login-card" style={{ maxWidth: 420 }}>
          <div className="login-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="22"/>
              <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
            </svg>
            <span className="login-brand">DockBase</span>
          </div>
          <h2 className="login-title">Save your backup codes</h2>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 16, lineHeight: 1.6 }}>
            Store these codes somewhere safe. Each code can only be used once if you lose access to your authenticator app.
          </p>
          <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg)', borderRadius: 7, padding: '14px 16px', lineHeight: 2, marginBottom: 16 }}>
            {backupCodes.map(c => <div key={c}>{c}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="abtn abtn-secondary" style={{ flex: 1 }} onClick={copyBackupCodes}>Copy all</button>
          </div>
          <button className="abtn abtn-primary login-submit" onClick={() => handleNavigateAfterLogin(enrolledUser)}>
            I saved these — continue
          </button>
        </div>
      </div>
    );
  }

  if (step === 'enroll') {
    return (
      <div className="login-shell">
        <div className="login-card" style={{ maxWidth: 420 }}>
          <div className="login-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="22"/>
              <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
            </svg>
            <span className="login-brand">DockBase</span>
          </div>
          <h2 className="login-title">Set up two-factor authentication</h2>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 16, lineHeight: 1.6 }}>
            Your marina requires MFA. Scan this QR code with Microsoft Authenticator, Google Authenticator, or Authy.
          </p>
          {enrollQrDataUrl && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <img src={enrollQrDataUrl} alt="QR code" style={{ width: 180, height: 180, borderRadius: 8 }} />
            </div>
          )}
          {enrollState?.secret && (
            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 16, wordBreak: 'break-all', textAlign: 'center' }}>
              Or enter manually: <span style={{ fontFamily: 'monospace', color: 'rgba(0,0,0,0.65)' }}>{enrollState.secret}</span>
            </p>
          )}
          <form onSubmit={handleEnrollSubmit} className="login-form">
            <div className="login-field">
              <label className="login-label">6-digit code from your app</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                className="login-input"
                value={enrollCode}
                onChange={e => setEnrollCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify & activate MFA'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'mfa') {
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
          <h2 className="login-title">Two-factor authentication</h2>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 16, lineHeight: 1.6 }}>
            {useBackupCode
              ? 'Enter one of your 10-digit backup codes.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
          <form onSubmit={handleMfaSubmit} className="login-form">
            <div className="login-field">
              <label className="login-label">{useBackupCode ? 'Backup code' : 'Authenticator code'}</label>
              <input
                type="text"
                inputMode="numeric"
                pattern={useBackupCode ? '[0-9a-zA-Z]{10}' : '[0-9]{6}'}
                maxLength={useBackupCode ? 10 : 6}
                className="login-input"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
                placeholder={useBackupCode ? 'xxxxxxxxxx' : '000000'}
                required
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <input
                type="checkbox"
                id="trust-device"
                checked={trustDevice}
                onChange={e => setTrustDevice(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="trust-device" style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', cursor: 'pointer' }}>
                Trust this device for 30 days
              </label>
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setUseBackupCode(v => !v); setMfaCode(''); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--navy)', fontSize: 12, cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}
            >
              {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Default: password step
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
