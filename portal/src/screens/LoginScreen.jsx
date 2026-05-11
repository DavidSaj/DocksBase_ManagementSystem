import { useState } from 'react';
import api from '../api';

// state: 'idle' | 'submitting' | 'sent' | 'error'

export default function LoginScreen({ marina }) {
  const [email, setEmail]   = useState('');
  const [state, setState]   = useState('idle');
  const [error, setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setState('submitting');
    setError('');
    try {
      await api.post('/portal/auth/member-magic/request/', { email });
      setState('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setState('error');
    }
  }

  const logoUrl = marina?.logo_url;

  return (
    <div className="p-login">
      {logoUrl && <img src={logoUrl} alt={marina.name} className="p-login__logo" />}
      <div className="p-login__marina-name">{marina?.name || 'Boater Portal'}</div>
      <div className="p-login__tagline">Member sign-in</div>

      <div className="p-login__card">
        {state === 'sent' ? (
          <>
            <h2>Check your email</h2>
            <p>
              We sent a sign-in link to <strong>{email}</strong>. The link
              expires in 24 hours.
            </p>
            <button
              className="p-btn p-btn--ghost"
              style={{ marginTop: 8 }}
              onClick={() => setState('idle')}
            >
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Sign in</h2>
            <p>Enter your email and we'll send you a secure sign-in link — no password needed.</p>

            <label className="p-label" htmlFor="email-input">Email address</label>
            <input
              id="email-input"
              type="email"
              className="p-input"
              style={{ marginTop: 4, marginBottom: 16 }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
            />

            {error && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={state === 'submitting' || !email}
            >
              {state === 'submitting' ? 'Sending…' : 'Send me a link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
