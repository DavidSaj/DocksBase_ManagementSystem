import { useEffect, useState } from 'react';
import api, { storeUser } from '../api.js';
import Brand from '../components/Brand.jsx';

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
  expiredCard: { width: '100%', maxWidth: 360, background: 'var(--db-card-bg)', border: 'var(--db-card-border)', borderRadius: 'var(--db-radius-md)', padding: '36px 28px', textAlign: 'center' },
  anchor: { width: 52, height: 52, borderRadius: '50%', background: 'rgba(212,176,122,0.12)', border: '1px solid rgba(212,176,122,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 22 },
};

export default function Setup({ uidb64, token, onComplete }) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid]       = useState(false);

  useEffect(() => {
    api.get(`/staff/setup/${uidb64}/${token}/`)
      .then(res => { setEmail(res.data.email); setLoading(false); })
      .catch(() => { setInvalid(true); setLoading(false); });
  }, [uidb64, token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/staff/setup/${uidb64}/${token}/`, { password });
      localStorage.setItem('field_access_token', data.access);
      localStorage.setItem('field_refresh_token', data.refresh);
      storeUser(data.user);
      onComplete(data.user);
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const BrandBlock = () => (
    <div style={S.brand}>
      <BrandBlock />
      <div style={S.sub}>Staff Portal</div>
    </div>
  );

  if (loading) {
    return (
      <div style={S.page}>
        <BrandBlock />
        <div style={{ color: 'var(--db-on-dark-muted)', fontFamily: 'var(--db-font-sans)', fontSize: 14 }}>Checking link…</div>
      </div>
    );
  }

  if (invalid) {
    return (
      <div style={S.page}>
        <BrandBlock />
        <div style={S.expiredCard}>
          <div style={S.anchor}>⚓</div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 10 }}>Link expired</div>
          <div style={{ fontFamily: 'var(--db-font-sans)', fontSize: 14, color: 'var(--db-on-dark-muted)', lineHeight: 1.6 }}>
            Setup links are single-use and expire after a few days. Ask your marina manager to send a new invite.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <BrandBlock />
      <div style={S.card}>
        <h2 style={S.h2}>Set up your account</h2>
        <p style={S.p}>Choose a password to complete your registration.</p>
        {error && <div style={S.err}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={S.field}>
            <label style={S.label}>Email</label>
            <input className="f-input" type="email" value={email} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input className="f-input" type="password" placeholder="At least 8 characters" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div style={S.field}>
            <label style={S.label}>Confirm Password</label>
            <input className="f-input" type="password" placeholder="Repeat your password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          <button className="f-btn-primary" style={{ width: '100%', marginTop: 4, opacity: submitting ? 0.6 : 1 }} type="submit" disabled={submitting}>
            {submitting ? 'Setting up…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
