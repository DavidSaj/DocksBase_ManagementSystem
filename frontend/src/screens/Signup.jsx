import { useState } from 'react';
import { signup, resendVerification } from '../api.js';

export default function Signup() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', marinaName: '',
  });
  const [errors, setErrors]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [resendLoading, setResendLoading]   = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setLoading(true);
    try {
      await signup(form.firstName, form.lastName, form.email, form.password, form.marinaName);
      setConfirmed(true);
    } catch (err) {
      const data = err.response?.data || {};
      if (typeof data === 'object') {
        setErrors(data);
      } else {
        setErrors({ non_field_errors: ['Something went wrong. Please try again.'] });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendLoading(true);
    try {
      await resendVerification(form.email);
    } catch { /* ignore */ } finally {
      setResendLoading(false);
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown(c => {
          if (c <= 1) { clearInterval(interval); return 0; }
          return c - 1;
        });
      }, 1000);
    }
  }

  if (confirmed) {
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
          <h2 className="login-title">Check your inbox</h2>
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20, lineHeight: 1.5 }}>
            We sent a confirmation link to <strong>{form.email}</strong>. Click it to activate your account.
          </p>
          <button
            type="button"
            className="abtn abtn-primary login-submit"
            onClick={handleResend}
            disabled={resendLoading || resendCooldown > 0}
          >
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : resendLoading ? 'Sending…' : 'Resend email'}
          </button>
        </div>
      </div>
    );
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

        <h2 className="login-title">Create your marina</h2>

        <form onSubmit={handleSubmit} className="login-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="login-field">
              <label className="login-label">First name</label>
              <input type="text" className="login-input" value={form.firstName} onChange={set('firstName')} required />
              {errors.first_name && <p className="login-error">{errors.first_name[0]}</p>}
            </div>
            <div className="login-field">
              <label className="login-label">Last name</label>
              <input type="text" className="login-input" value={form.lastName} onChange={set('lastName')} required />
              {errors.last_name && <p className="login-error">{errors.last_name[0]}</p>}
            </div>
          </div>

          <div className="login-field">
            <label className="login-label">Marina name</label>
            <input type="text" className="login-input" value={form.marinaName} onChange={set('marinaName')} placeholder="e.g. Port de Vidy" required />
            {errors.marina_name && <p className="login-error">{errors.marina_name[0]}</p>}
          </div>

          <div className="login-field">
            <label className="login-label">Email</label>
            <input type="email" className="login-input" value={form.email} onChange={set('email')} placeholder="you@example.com" required />
            {errors.email && <p className="login-error">{errors.email[0]}</p>}
          </div>

          <div className="login-field">
            <label className="login-label">Password</label>
            <input type="password" className="login-input" value={form.password} onChange={set('password')} placeholder="At least 8 characters" required minLength={8} />
            {errors.password && <p className="login-error">{errors.password[0]}</p>}
          </div>

          {errors.non_field_errors && (
            <p className="login-error">{errors.non_field_errors[0]}</p>
          )}

          <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 16 }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--navy)', textDecoration: 'none', fontWeight: 600 }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}
