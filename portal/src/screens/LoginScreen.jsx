import { useState } from 'react';
import api from '../api';

export default function LoginScreen({ marina, tokenError }) {
  const [tab, setTab] = useState('guest'); // 'guest' | 'member'

  // Guest tab state
  const [gEmail, setGEmail] = useState('');
  const [gRef,   setGRef]   = useState('');
  const [gState, setGState] = useState('idle'); // 'idle' | 'submitting' | 'error'
  const [gError, setGError] = useState('');

  // Member tab state
  const [mEmail, setMEmail] = useState('');
  const [mState, setMState] = useState('idle'); // 'idle' | 'submitting' | 'sent'
  const [mError, setMError] = useState('');

  async function handleGuestSubmit(e) {
    e.preventDefault();
    setGState('submitting');
    setGError('');
    try {
      const res = await api.post('/portal/auth/guest-instant/', {
        email: gEmail,
        booking_reference: gRef.trim().toUpperCase(),
      });
      const data = res.data;
      localStorage.setItem('portal_session_token', data.token);
      localStorage.setItem('portal_token_type',    'guest');
      localStorage.setItem('portal_booking_id',    String(data.booking_id));
      localStorage.setItem('portal_marina_slug',   data.marina_slug);
      window.location.reload();
    } catch {
      setGError('No booking found for that email and reference. Check your confirmation email for your Booking ID (e.g. BK-1042).');
      setGState('error');
    }
  }

  async function handleMemberSubmit(e) {
    e.preventDefault();
    setMState('submitting');
    setMError('');
    try {
      await api.post('/portal/auth/request-link/', { email: mEmail });
      setMState('sent');
    } catch {
      setMError('Something went wrong. Please try again.');
      setMState('idle');
    }
  }

  const logoUrl = marina?.logo_url;

  return (
    <div className="p-login">
      {logoUrl && <img src={logoUrl} alt={marina.name} className="p-login__logo" />}
      <div className="p-login__marina-name">{marina?.name || 'Boater Portal'}</div>

      <div className="p-login__card">
        {tokenError && (
          <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16, padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: 6 }}>
            {tokenError}
          </div>
        )}

        <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 20 }}>
          {[['guest', 'I have a Booking'], ['member', 'Marina Member']].map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: 13,
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? 'var(--navy)' : 'rgba(0,0,0,0.45)',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--navy)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'guest' && (
          <form onSubmit={handleGuestSubmit}>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginTop: 0, marginBottom: 16 }}>
              Enter the email you booked with and your Booking ID from your confirmation email (e.g. BK-1042).
            </p>
            <label className="p-label" htmlFor="g-email">Email address</label>
            <input
              id="g-email"
              type="email"
              className="p-input"
              style={{ marginTop: 4, marginBottom: 12 }}
              value={gEmail}
              onChange={e => setGEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
            />
            <label className="p-label" htmlFor="g-ref">Booking ID</label>
            <input
              id="g-ref"
              type="text"
              className="p-input"
              style={{ marginTop: 4, marginBottom: 16 }}
              value={gRef}
              onChange={e => setGRef(e.target.value)}
              placeholder="BK-1042"
              required
              autoComplete="off"
            />
            {gState === 'error' && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{gError}</div>
            )}
            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={gState === 'submitting' || !gEmail || !gRef}
            >
              {gState === 'submitting' ? 'Looking up…' : 'View Boarding Pass'}
            </button>
          </form>
        )}

        {tab === 'member' && (
          <>
            {mState === 'sent' ? (
              <>
                <h2 style={{ margin: '0 0 12px', fontSize: 17 }}>Check your email</h2>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', margin: '0 0 16px' }}>
                  If an account exists for <strong>{mEmail}</strong>, a secure link has been sent. The link expires in 24 hours.
                </p>
                <button className="p-btn p-btn--ghost" style={{ marginTop: 8 }} onClick={() => setMState('idle')}>
                  Use a different email
                </button>
              </>
            ) : (
              <form onSubmit={handleMemberSubmit}>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginTop: 0, marginBottom: 16 }}>
                  Enter your email and we'll send you a secure sign-in link — no password needed.
                </p>
                <label className="p-label" htmlFor="m-email">Email address</label>
                <input
                  id="m-email"
                  type="email"
                  className="p-input"
                  style={{ marginTop: 4, marginBottom: 16 }}
                  value={mEmail}
                  onChange={e => setMEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
                {mError && (
                  <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{mError}</div>
                )}
                <button
                  type="submit"
                  className="p-btn p-btn--primary"
                  disabled={mState === 'submitting' || !mEmail}
                >
                  {mState === 'submitting' ? 'Sending…' : 'Send Secure Link'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
