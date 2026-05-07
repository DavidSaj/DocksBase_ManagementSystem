import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import usePortalInvoices from '../hooks/usePortalInvoices.js';
import usePortalCraneRequests from '../hooks/usePortalCraneRequests.js';
import usePortalBerth from '../hooks/usePortalBerth.js';
import usePortalVessel from '../hooks/usePortalVessel.js';
import PaymentModal from '../components/portal/PaymentModal.jsx';
import api from '../api.js';

const STATUS_BADGE = {
  open:      'badge badge-portal-unpaid',
  unpaid:    'badge badge-portal-unpaid',
  paid:      'badge badge-portal-paid',
  void:      'badge badge-portal-void',
  draft:     'badge badge-portal-void',
  requested: 'badge badge-portal-unpaid',
  approved:  'badge badge-portal-paid',
  rejected:  'badge badge-portal-overdue',
};

const STATUS_LABEL = {
  open: 'Unpaid', unpaid: 'Unpaid', paid: 'Paid', void: 'Void', draft: 'Draft',
  requested: 'Requested', approved: 'Approved', rejected: 'Rejected',
};

const BERTH_BADGE = {
  checked_in: 'badge badge-portal-paid',
  pending:    'badge badge-portal-unpaid',
};

const CERT_BADGE = {
  valid:    'badge badge-portal-paid',
  due_soon: 'badge badge-portal-unpaid',
  expired:  'badge badge-portal-overdue',
};

function formatCurrency(amount) {
  return Number(amount).toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
}

// ── Invoices Tab ──────────────────────────────────────────────
function InvoicesTab({ invoices, loading, error, onPay }) {
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
        <div key={inv.id} className="portal-invoice-card">
          <div className="portal-invoice-row">
            <div>
              <div className="portal-invoice-ref">{inv.invoice_number || `INV-${inv.id}`}</div>
              <div className="portal-invoice-amount">{formatCurrency(inv.total)}</div>
              {inv.due_date && <div className="portal-invoice-meta">Due {inv.due_date}</div>}
            </div>
            <span className={STATUS_BADGE[inv.status] || 'badge'}>
              {STATUS_LABEL[inv.status] || inv.status}
            </span>
          </div>
          {(inv.status === 'open' || inv.status === 'unpaid') && (
            <button
              type="button"
              className="abtn abtn-gold portal-full-btn"
              onClick={() => onPay(inv)}
            >
              Pay Now
            </button>
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
      <div className="portal-form-card">
        {success ? (
          <div className="portal-success">
            <span className="badge badge-portal-paid">Absence reported</span>
            <p className="portal-success-text">The marina has been notified.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="portal-form">
            <div className="portal-field">
              <label className="portal-label">Absence type</label>
              <select className="portal-input" value={form.absence_type} onChange={e => set('absence_type', e.target.value)}>
                <option value="day_trip">Day trip</option>
                <option value="overnight">Overnight</option>
                <option value="extended">Extended</option>
              </select>
            </div>
            <div className="portal-field-row">
              <div className="portal-field">
                <label className="portal-label">Departure</label>
                <input type="date" className="portal-input" value={form.departure} onChange={e => set('departure', e.target.value)} required />
              </div>
              <div className="portal-field">
                <label className="portal-label">Return</label>
                <input type="date" className="portal-input" value={form.return_date} onChange={e => set('return_date', e.target.value)} required />
              </div>
            </div>
            <div className="portal-field">
              <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
              <textarea className="portal-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any details for the harbour master…" />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="abtn abtn-gold portal-full-btn" disabled={submitting}>
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
      <div className="portal-form-card">
        <form onSubmit={handleSubmit} className="portal-form">
          <div className="portal-field">
            <label className="portal-label">Service</label>
            <select className="portal-input" value={form.service_type} onChange={e => set('service_type', e.target.value)}>
              <option value="launch">Launch</option>
              <option value="haul_out">Haul-out</option>
              <option value="both">Launch & Haul-out</option>
            </select>
          </div>
          <div className="portal-field">
            <label className="portal-label">Requested date</label>
            <input type="date" className="portal-input" value={form.requested_date} onChange={e => set('requested_date', e.target.value)} required />
          </div>
          <div className="portal-field">
            <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
            <textarea className="portal-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Vessel condition, timing requirements…" />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="abtn abtn-gold portal-full-btn" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Request Crane Lift'}
          </button>
        </form>
      </div>

      {!loading && requests.length > 0 && (
        <>
          <div className="portal-section-label">Your requests</div>
          {requests.map(r => (
            <div key={r.id} className="portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">{r.service_type.replace('_', '-')}</div>
                  <div className="portal-invoice-meta">{r.requested_date}</div>
                </div>
                <span className={STATUS_BADGE[r.status] || 'badge'}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
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

  const [active, ...upcoming] = berths;

  return (
    <div className="portal-list">
      {active && (
        <div className="portal-invoice-card">
          <div className="portal-invoice-ref">{active.pier_label || 'Berth'}</div>
          <div className="portal-invoice-amount">Berth {active.berth_code}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
            <span className={BERTH_BADGE[active.status] || 'badge'}>
              {active.status.replace('_', ' ')}
            </span>
          </div>
          <div className="portal-invoice-meta">Arrival: {active.check_in}</div>
          <div className="portal-invoice-meta">Departure: {active.check_out}</div>
          {active.nights_remaining !== null && (
            <div className="portal-invoice-meta">{active.nights_remaining} night{active.nights_remaining !== 1 ? 's' : ''} remaining</div>
          )}
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="portal-section-label">Upcoming</div>
          {upcoming.map(b => (
            <div key={b.id} className="portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">Berth {b.berth_code}</div>
                  <div className="portal-invoice-meta">{b.check_in} → {b.check_out}</div>
                </div>
                <span className={BERTH_BADGE[b.status] || 'badge'}>{b.status.replace('_', ' ')}</span>
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

  return (
    <div className="portal-list">
      <div className="portal-invoice-card">
        <div className="portal-invoice-amount">{vessel.name}</div>
        <div className="portal-invoice-meta" style={{ marginBottom: 4 }}>{vessel.vessel_type}</div>
        {vessel.loa   && <div className="portal-invoice-meta">Length: {vessel.loa} m</div>}
        {vessel.beam  && <div className="portal-invoice-meta">Beam: {vessel.beam} m</div>}
        {vessel.reg   && <div className="portal-invoice-meta">Reg: {vessel.reg}</div>}
        {vessel.flag  && <div className="portal-invoice-meta">Flag: {vessel.flag}</div>}
      </div>

      {vessel.certificates.length > 0 && (
        <>
          <div className="portal-section-label">Certificates</div>
          {vessel.certificates.map(cert => (
            <div key={cert.id} className="portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">{cert.name}</div>
                  {cert.expires && <div className="portal-invoice-meta">Expires: {cert.expires}</div>}
                </div>
                <span className={CERT_BADGE[cert.cert_status] || 'badge'}>
                  {cert.cert_status === 'due_soon' ? 'Due Soon' : cert.cert_status.charAt(0).toUpperCase() + cert.cert_status.slice(1)}
                </span>
              </div>
              {(cert.cert_status === 'expired' || cert.cert_status === 'due_soon') && vessel.marina_contact_email && (
                <a
                  href={`mailto:${vessel.marina_contact_email}?subject=${encodeURIComponent(`Certificate renewal: ${cert.name} — ${vessel.name}`)}`}
                  style={{ display: 'block', marginTop: 8, padding: '8px 0', textAlign: 'center',
                    fontSize: 13, fontWeight: 600, color: 'var(--gold)', textDecoration: 'none',
                    border: '1px solid rgba(184,150,90,0.25)', borderRadius: 8,
                    background: 'rgba(184,150,90,0.08)' }}
                >
                  Email marina about this certificate
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
  const [payingInvoice, setPayingInvoice] = useState(null);
  const { invoices, loading: invoicesLoading, error: invoicesError, markPaid, refetch } = usePortalInvoices();

  // Handle SCA/3DS redirect return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectStatus = params.get('redirect_status');
    if (redirectStatus === 'succeeded') {
      refetch();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (redirectStatus === 'failed') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="portal-shell">
      <div className="portal-header">
        <div className="portal-header-left">
          <div className="portal-logo-wrap">
            <div className="portal-logo-ring" />
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="var(--gold, #b8965a)" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="22"/>
              <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
            </svg>
          </div>
          <div>
            <div className="portal-marina-name">DocksBase</div>
            <div className="portal-boater-name">{user?.first_name || user?.email}</div>
          </div>
        </div>
        <button type="button" className="portal-signout" onClick={signOut}>Sign out</button>
      </div>

      <div className="portal-tabs">
        {[
          ['invoices', 'Invoices'],
          ['absence',  'Absence'],
          ['crane',    'Crane'],
          ['berth',    'Berth'],
          ['vessel',   'Vessel'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="portal-content">
        <div key={tab} className="portal-tab-content">
          {tab === 'invoices' && (
            <InvoicesTab
              invoices={invoices}
              loading={invoicesLoading}
              error={invoicesError}
              onPay={setPayingInvoice}
            />
          )}
          {tab === 'absence'  && <AbsenceTab />}
          {tab === 'crane'    && <CraneTab />}
          {tab === 'berth'    && <BerthTab />}
          {tab === 'vessel'   && <VesselTab />}
        </div>
      </div>

      {payingInvoice && (
        <PaymentModal
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
          onPaid={markPaid}
        />
      )}
    </div>
  );
}
