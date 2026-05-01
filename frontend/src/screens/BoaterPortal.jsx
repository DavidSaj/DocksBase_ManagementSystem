import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import usePortalInvoices from '../hooks/usePortalInvoices.js';
import usePortalCraneRequests from '../hooks/usePortalCraneRequests.js';
import usePortalBerth from '../hooks/usePortalBerth.js';
import usePortalVessel from '../hooks/usePortalVessel.js';
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
  const { invoices, loading, error } = usePortalInvoices();

  if (loading) return <div className="portal-loading">Loading invoices…</div>;
  if (error)   return <div className="portal-loading">{error}</div>;
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
            <button type="button" className="abtn abtn-gold portal-full-btn">Pay Now</button>
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

// ── Berth Tab ─────────────────────────────────────────────────
function BerthTab() {
  const { berths, loading, error } = usePortalBerth();

  if (loading) return <div className="portal-loading">Loading berth info…</div>;
  if (error)   return <div className="portal-loading">{error}</div>;
  if (!berths.length) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <div className="portal-empty-text">No berth currently assigned. Contact the marina to make a booking.</div>
    </div>
  );

  const STATUS_BADGE_CLASS = { checked_in: 'badge badge-green', pending: 'badge badge-gold' };

  const [active, ...upcoming] = berths;

  return (
    <div className="portal-list">
      {active && (
        <div className="card portal-invoice-card">
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>
              Berth {active.berth_code}
            </div>
            {active.pier_label && (
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>{active.pier_label}</div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className={STATUS_BADGE_CLASS[active.status] || 'badge'}>{active.status.replace('_', ' ')}</span>
            </div>
            <div className="portal-invoice-meta">Arrival: {active.check_in}</div>
            <div className="portal-invoice-meta">Departure: {active.check_out}</div>
            {active.nights_remaining !== null && (
              <div className="portal-invoice-meta">{active.nights_remaining} night{active.nights_remaining !== 1 ? 's' : ''} remaining</div>
            )}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="portal-section-label">Upcoming</div>
          {upcoming.map(b => (
            <div key={b.id} className="card portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">Berth {b.berth_code}</div>
                  <div className="portal-invoice-meta">{b.check_in} → {b.check_out}</div>
                </div>
                <span className={STATUS_BADGE_CLASS[b.status] || 'badge'}>{b.status.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Vessel Tab ────────────────────────────────────────────────
function VesselTab() {
  const { vessel, loading, error } = usePortalVessel();

  if (loading) return <div className="portal-loading">Loading vessel info…</div>;
  if (error)   return <div className="portal-loading">{error}</div>;
  if (!vessel) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 20l20-8-20-8v6l14 2-14 2v6z"/></svg>
      </div>
      <div className="portal-empty-text">No vessel on file. Contact the marina.</div>
    </div>
  );

  const CERT_STATUS_COLOR = { valid: '#27ae60', due_soon: '#e67e22', expired: '#c0392b' };
  const CERT_STATUS_DOT = { valid: '🟢', due_soon: '🟡', expired: '🔴' };

  return (
    <div className="portal-list">
      <div className="card portal-invoice-card">
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vessel.name}</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{vessel.vessel_type}</div>
        {vessel.loa   && <div className="portal-invoice-meta">Length: {vessel.loa} m</div>}
        {vessel.beam  && <div className="portal-invoice-meta">Beam: {vessel.beam} m</div>}
        {vessel.reg   && <div className="portal-invoice-meta">Reg: {vessel.reg}</div>}
        {vessel.flag  && <div className="portal-invoice-meta">Flag: {vessel.flag}</div>}
      </div>

      {vessel.certificates.length > 0 && (
        <>
          <div className="portal-section-label">Certificates</div>
          {vessel.certificates.map(cert => (
            <div key={cert.id} className="card portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">{cert.name}</div>
                  {cert.expires && (
                    <div className="portal-invoice-meta">Expires: {cert.expires}</div>
                  )}
                </div>
                <span style={{ fontSize: 18 }}>{CERT_STATUS_DOT[cert.cert_status] || '⚪'}</span>
              </div>
              {(cert.cert_status === 'expired' || cert.cert_status === 'due_soon') && vessel.marina_contact_email && (
                <a
                  href={`mailto:${vessel.marina_contact_email}?subject=${encodeURIComponent(`Certificate renewal: ${cert.name} — ${vessel.name}`)}`}
                  style={{
                    display: 'block', marginTop: 8, padding: '8px 0',
                    textAlign: 'center', fontSize: 13, fontWeight: 600,
                    color: CERT_STATUS_COLOR[cert.cert_status],
                    textDecoration: 'none',
                    border: `1px solid ${CERT_STATUS_COLOR[cert.cert_status]}30`,
                    borderRadius: 8, background: `${CERT_STATUS_COLOR[cert.cert_status]}08`,
                  }}
                >
                  📧 Email marina about this certificate
                </a>
              )}
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
        <button type="button" className="portal-signout" onClick={signOut}>Sign out</button>
      </div>

      <div className="tabs portal-tabs">
        <button type="button" className={`tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => setTab('invoices')}>Invoices</button>
        <button type="button" className={`tab${tab === 'absence'  ? ' active' : ''}`} onClick={() => setTab('absence')}>Absence</button>
        <button type="button" className={`tab${tab === 'crane'    ? ' active' : ''}`} onClick={() => setTab('crane')}>Crane</button>
        <button type="button" className={`tab${tab === 'berth'    ? ' active' : ''}`} onClick={() => setTab('berth')}>Berth</button>
        <button type="button" className={`tab${tab === 'vessel'   ? ' active' : ''}`} onClick={() => setTab('vessel')}>Vessel</button>
      </div>

      <div className="portal-content">
        {tab === 'invoices' && <InvoicesTab />}
        {tab === 'absence'  && <AbsenceTab />}
        {tab === 'crane'    && <CraneTab />}
        {tab === 'berth'    && <BerthTab />}
        {tab === 'vessel'   && <VesselTab />}
      </div>
    </div>
  );
}
