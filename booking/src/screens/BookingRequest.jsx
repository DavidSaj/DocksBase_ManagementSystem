import { useState } from 'react';
import api from '@docksbase/portal-ui/api';

export default function BookingRequest({ marina, onSubmitted }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    check_in: '',
    check_out: '',
    guest_name: '',
    guest_email: '',
    boat_loa: '',
    boat_beam: '',
    boat_draft: '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post('/public/bookings/', {
        ...form,
        boat_loa: form.boat_loa !== '' ? parseFloat(form.boat_loa) : undefined,
        boat_beam: form.boat_beam !== '' ? parseFloat(form.boat_beam) : undefined,
        boat_draft: form.boat_draft !== '' ? parseFloat(form.boat_draft) : undefined,
      });
      onSubmitted();
    } catch (err) {
      setErrors(err.response?.data || { non_field_errors: ['Something went wrong. Please try again.'] });
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, type = 'text', extra = {}) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </label>
      <input
        type={type}
        value={form[key]}
        min={type === 'date' ? today : undefined}
        onChange={e => set(key, e.target.value)}
        required
        {...extra}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, border: `1px solid ${errors[key] ? '#dc2626' : 'rgba(0,0,0,0.2)'}`, borderRadius: 6 }}
      />
      {errors[key] && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{[].concat(errors[key]).join(' ')}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{marina?.name}</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 28px' }}>Request a transient berth</p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 0 }}>
            <div>{field('Check-in', 'check_in', 'date')}</div>
            <div>{field('Check-out', 'check_out', 'date', { min: form.check_in || today })}</div>
          </div>
          {field('Your name', 'guest_name')}
          {field('Email address', 'guest_email', 'email')}

          <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12, marginTop: 8 }}>
            Vessel dimensions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>{field('LOA (m)', 'boat_loa', 'number', { step: '0.1', min: '0', placeholder: '12.5' })}</div>
            <div>{field('Beam (m)', 'boat_beam', 'number', { step: '0.1', min: '0', placeholder: '4.2' })}</div>
            <div>{field('Draft (m)', 'boat_draft', 'number', { step: '0.1', min: '0', placeholder: '1.8' })}</div>
          </div>

          {errors.non_field_errors && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{[].concat(errors.non_field_errors).join(' ')}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: busy ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 8 }}
          >
            {busy ? 'Submitting…' : 'Request a berth'}
          </button>
        </form>
      </div>
    </div>
  );
}
