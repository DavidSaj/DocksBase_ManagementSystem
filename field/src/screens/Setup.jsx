import { useEffect, useState } from 'react';
import api, { storeUser } from '../api.js';
import Brand from '../components/Brand.jsx';

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
  expiredCard: { width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: '36px 28px', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', textAlign: 'center' },
  anchor: { width: 52, height: 52, borderRadius: '50%', background: 'rgba(12,31,61,0.06)', border: '1.5px solid rgba(12,31,61,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 22 },
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
        <div style={{ color: 'rgba(245,240,230,0.4)', fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 14 }}>Checking link…</div>
      </div>
    );
  }

  if (invalid) {
    return (
      <div style={S.page}>
        <BrandBlock />
        <div style={S.expiredCard}>
          <div style={S.anchor}>⚓</div>
          <div style={{ fontFamily: 'Jost, system-ui, sans-serif', fontSize: 17, fontWeight: 700, color: '#0c1f3d', marginBottom: 10 }}>Link expired</div>
          <div style={{ fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.45)', lineHeight: 1.6 }}>
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
            <input style={{ ...S.input, background: '#f4f3f0', color: 'rgba(0,0,0,0.45)', cursor: 'not-allowed' }} type="email" value={email} readOnly />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" placeholder="At least 8 characters" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div style={S.field}>
            <label style={S.label}>Confirm Password</label>
            <input style={S.input} type="password" placeholder="Repeat your password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          <button style={{ ...S.btn, opacity: submitting ? 0.6 : 1 }} type="submit" disabled={submitting}>
            {submitting ? 'Setting up…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
