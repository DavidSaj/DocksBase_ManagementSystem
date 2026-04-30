import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import usePortalInvoices from '../hooks/usePortalInvoices.js';
import usePortalCraneRequests from '../hooks/usePortalCraneRequests.js';
import api from '../api.js';

const STATUS_BADGE = {
  unpaid:    'badge badge-gold',
  overdue:   'badge badge-red',
  paid:      'badge badge-green',
  requested: 'badge badge-gold',
  approved:  'badge badge-green',
  rejected:  'badge badge-red',
};

function formatCurrency(amount) {
  return Number(amount).toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
}

// ── Invoices Tab ──────────────────────────────────────────────
function InvoicesTab() {
  const { invoices, loading } = usePortalInvoices();

  if (loading) return <div className="portal-loading">Loading invoices…</div>;
  if (!invoices.length) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div className="portal-empty-text">No invoices.</div>
    </div>
  );

  return (
    <div className="portal-list">
      {invoices.map(inv => (
        <div key={inv.id} className="card portal-invoice-card">
          <div className="portal-invoice-row">
            <div>
              <div className="portal-invoice-ref">{`INV-${inv.id}`}</div>
              <div className="portal-invoice-amount">{formatCurrency(inv.amount)}</div>
              {inv.due && <div className="portal-invoice-meta">Due {inv.due}</div>}
            </div>
            <span className={STATUS_BADGE[inv.status] || 'badge'}>{inv.status}</span>
          </div>
          {inv.status !== 'paid' && (
            <button className="abtn abtn-gold portal-full-btn">Pay Now</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Absence Tab ───────────────────────────────────────────────
function AbsenceTab() {
  const [form, setForm]             = useState({ absence_type: 'day_trip', departure: '', return_date: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]       = useState(false);
  const [error, setError]           = useState('');

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/portal/absence/', form);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setForm({ absence_type: 'day_trip', departure: '', return_date: '', notes: '' });
      }, 2500);
    } catch {
      setError('Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="portal-list">
      <div className="card portal-form-card">
        {success ? (
          <div className="portal-success">
            <span className="badge badge-green">Absence reported</span>
            <p className="portal-success-text">The marina has been notified.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="portal-form">
            <div className="portal-field">
              <label className="portal-label">Absence type</label>
              <select className="login-input" value={form.absence_type} onChange={e => set('absence_type', e.target.value)}>
                <option value="day_trip">Day trip</option>
                <option value="overnight">Overnight</option>
                <option value="extended">Extended</option>
              </select>
            </div>
            <div className="portal-field-row">
              <div className="portal-field">
                <label className="portal-label">Departure</label>
                <input type="date" className="login-input" value={form.departure} onChange={e => set('departure', e.target.value)} required />
              </div>
              <div className="portal-field">
                <label className="portal-label">Return</label>
                <input type="date" className="login-input" value={form.return_date} onChange={e => set('return_date', e.target.value)} required />
              </div>
            </div>
            <div className="portal-field">
              <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
              <textarea className="login-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any details for the harbour master…" />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="abtn abtn-primary portal-full-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Report Absence'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Crane Tab ─────────────────────────────────────────────────
function CraneTab() {
  const { requests, loading, submitRequest } = usePortalCraneRequests();
  const [form, setForm]             = useState({ service_type: 'haul_out', requested_date: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await submitRequest(form);
      setForm({ service_type: 'haul_out', requested_date: '', notes: '' });
    } catch {
      setError('Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="portal-list">
      <div className="card portal-form-card">
        <form onSubmit={handleSubmit} className="portal-form">
          <div className="portal-field">
            <label className="portal-label">Service</label>
            <select className="login-input" value={form.service_type} onChange={e => set('service_type', e.target.value)}>
              <option value="launch">Launch</option>
              <option value="haul_out">Haul-out</option>
              <option value="both">Launch & Haul-out</option>
            </select>
          </div>
          <div className="portal-field">
            <label className="portal-label">Requested date</label>
            <input type="date" className="login-input" value={form.requested_date} onChange={e => set('requested_date', e.target.value)} required />
          </div>
          <div className="portal-field">
            <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
            <textarea className="login-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Vessel condition, timing requirements…" />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="abtn abtn-primary portal-full-btn" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Request Crane Lift'}
          </button>
        </form>
      </div>

      {!loading && requests.length > 0 && (
        <>
          <div className="portal-section-label">Your requests</div>
          {requests.map(r => (
            <div key={r.id} className="card portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">{r.service_type.replace('_', '-')}</div>
                  <div className="portal-invoice-meta">{r.requested_date}</div>
                </div>
                <span className={STATUS_BADGE[r.status] || 'badge'}>{r.status}</span>
              </div>
              {r.notes && <div className="portal-request-notes">{r.notes}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────
export default function BoaterPortal() {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState('invoices');

  return (
    <div className="portal-shell">
      <div className="portal-header">
        <div className="portal-header-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <div>
            <div className="portal-marina-name">DockBase</div>
            <div className="portal-boater-name">{user?.first_name || user?.email}</div>
          </div>
        </div>
        <button className="portal-signout" onClick={signOut}>Sign out</button>
      </div>

      <div className="tabs portal-tabs">
        <button className={`tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => setTab('invoices')}>Invoices</button>
        <button className={`tab${tab === 'absence'  ? ' active' : ''}`} onClick={() => setTab('absence')}>Absence</button>
        <button className={`tab${tab === 'crane'    ? ' active' : ''}`} onClick={() => setTab('crane')}>Crane</button>
      </div>

      <div className="portal-content">
        {tab === 'invoices' && <InvoicesTab />}
        {tab === 'absence'  && <AbsenceTab />}
        {tab === 'crane'    && <CraneTab />}
      </div>
    </div>
  );
}
