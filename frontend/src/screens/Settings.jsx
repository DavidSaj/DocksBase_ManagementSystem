import { useState, useEffect, useRef } from 'react';
import api from '../api.js';
import useMarina from '../hooks/useMarina.js';
import Ic from '../components/ui/Icon.jsx';

// ── Utility helpers ────────────────────────────────────────────────────────

function getInitials(u) {
  const f = u.first_name?.[0] ?? '';
  const l = u.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || u.email[0].toUpperCase();
}

function displayName(u) {
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return full || u.email;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function capitalize(s) {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Shared UI components ───────────────────────────────────────────────────

function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
        background: on ? 'var(--teal)' : 'rgba(0,0,0,0.15)',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

function FieldRow({ label, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>{hint}</div>}
    </div>
  );
}

function ComingSoonBanner() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.07)',
      borderRadius: 7, padding: '10px 14px', marginBottom: 16,
      fontSize: 12, color: 'rgba(0,0,0,0.4)',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
        background: 'rgba(0,0,0,0.08)', borderRadius: 3, padding: '2px 6px',
      }}>Coming soon</span>
      <span>This feature is under development and will be available in a future release.</span>
    </div>
  );
}

// Inline style for modal form inputs (kept as a constant to avoid repetition)
const MI = {
  width: '100%', border: 'var(--border)', borderRadius: 5,
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)',
};

// ── Constants ──────────────────────────────────────────────────────────────

const FLAG_DEFS = [
  { key: 'restaurant',  label: 'Restaurant module',            desc: 'Enable F&B screens' },
  { key: 'events',      label: 'Events module',                desc: 'Event and venue hire' },
  { key: 'portal',      label: 'Customer self-service portal', desc: 'Boater web portal' },
  { key: 'ais',         label: 'AIS map overlay',              desc: 'Show live vessel positions' },
  { key: 'multimarina', label: 'Multi-marina mode',            desc: 'Group reporting' },
];

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', staff: 'Staff', boater: 'Boater' };

// Placeholder notification groups — displayed in disabled/coming-soon state
const NOTIF_GROUPS = [
  { group: 'Bookings', items: [
    { label: 'New booking confirmation' },
    { label: 'Arrival reminder (24h before)' },
    { label: 'Departure reminder' },
    { label: 'Overstay alert' },
  ]},
  { group: 'Payments', items: [
    { label: 'Invoice issued' },
    { label: 'Payment received' },
    { label: 'Payment overdue (7 days)' },
    { label: 'Payment overdue (30 days)' },
  ]},
  { group: 'Operations', items: [
    { label: 'Critical defect logged' },
    { label: 'Incident reported' },
    { label: 'Document expiry (30 days)' },
    { label: 'Insurance expiry (30 days)' },
  ]},
];

// ── Main component ─────────────────────────────────────────────────────────

export default function Settings() {
  const [tab, setTab] = useState('marina');
  const { marina, loading: marinaLoading, updateMarina } = useMarina();
  const initialized = useRef(false);

  // ── Marina profile form ────────────────────────────────────────────────

  const [mf, setMf] = useState(null);
  const [marinaSaving, setMarinaSaving] = useState(false);

  useEffect(() => {
    if (!marina || initialized.current) return;
    initialized.current = true;
    setMf({
      name:              marina.name             ?? '',
      address:           marina.address          ?? '',
      lat:               marina.lat              ?? '',
      lng:               marina.lng              ?? '',
      timezone:          marina.timezone         ?? 'Europe/London',
      contact_email:     marina.contact_email    ?? '',
      phone:             marina.phone            ?? '',
      currency:          marina.currency         ?? 'EUR',
      vat_number:        marina.vat_number       ?? '',
      payment_terms:     String(marina.payment_terms ?? 7),
      total_berths:      marina.total_berths     ?? '',
      dry_storage_slots: marina.dry_storage_slots ?? '',
      max_loa:           marina.max_loa          ?? '',
      max_draft:         marina.max_draft        ?? '',
    });
    setFlags({
      restaurant:  marina.features?.restaurant  ?? false,
      events:      marina.features?.events      ?? false,
      portal:      marina.features?.portal      ?? false,
      ais:         marina.features?.ais         ?? false,
      multimarina: marina.features?.multimarina ?? false,
    });
  }, [marina]);

  function fm(field) { return mf?.[field] ?? ''; }
  function setM(field, val) { setMf(f => ({ ...f, [field]: val })); }

  async function saveMarinaProfile() {
    if (!mf) return;
    setMarinaSaving(true);
    try {
      await updateMarina({ ...mf, payment_terms: Number(mf.payment_terms) });
    } finally {
      setMarinaSaving(false);
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [inviteForm, setInviteForm] = useState(null);
  const [inviteSaving, setInviteSaving] = useState(false);

  useEffect(() => {
    if (tab !== 'users') return;
    setUsersLoading(true);
    api.get('/marina/users/')
      .then(r => setUsers(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  }, [tab]);

  async function inviteUser(form) {
    setInviteSaving(true);
    try {
      const { data } = await api.post('/marina/users/invite/', form);
      setUsers(prev => [...prev, data]);
      setInviteForm(null);
    } catch {
      // error handling — TODO: toast
    } finally {
      setInviteSaving(false);
    }
  }

  async function deactivateUser(id) {
    if (!window.confirm('Deactivate this user? They will lose access to the system.')) return;
    try {
      const { data } = await api.patch(`/marina/users/${id}/`, { is_active: false });
      setUsers(prev => prev.map(u => u.id === id ? data : u));
    } catch {
      // error handling — TODO: toast
    }
  }

  // ── Feature flags ──────────────────────────────────────────────────────

  const [flags, setFlags] = useState({});
  const [flagsSaving, setFlagsSaving] = useState(false);

  async function saveFlags() {
    setFlagsSaving(true);
    try {
      await updateMarina({ features: flags });
    } finally {
      setFlagsSaving(false);
    }
  }

  // ── Service catalog ────────────────────────────────────────────────────

  const [catalog, setCatalog]           = useState([]);
  const [catalogLoading, setCatLoading] = useState(true);
  const [catalogForm, setCatalogForm]   = useState(null);
  const [catalogSaving, setCatSaving]   = useState(false);

  useEffect(() => {
    api.get('/billing/service-catalog/')
      .then(r => setCatalog(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setCatLoading(false));
  }, []);

  function saveCatalogItem(form) {
    setCatSaving(true);
    const payload = {
      name: form.name, category: form.category, pricing_model: form.pricing_model,
      unit_price: form.unit_price, tax_rate: form.tax_rate, is_active: form.is_active,
    };
    const req = form.id
      ? api.patch(`/billing/service-catalog/${form.id}/`, payload)
      : api.post('/billing/service-catalog/', payload);
    req
      .then(r => {
        setCatalog(prev => form.id
          ? prev.map(i => i.id === form.id ? r.data : i)
          : [...prev, r.data]);
        setCatalogForm(null);
      })
      .catch(() => {})
      .finally(() => setCatSaving(false));
  }

  function deleteCatalogItem(id) {
    if (!window.confirm('Delete this catalog item?')) return;
    api.delete(`/billing/service-catalog/${id}/`)
      .then(() => setCatalog(prev => prev.filter(i => i.id !== id)))
      .catch(() => {});
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Tab bar */}
      <div className="tabs">
        {[
          ['marina',        'Marina Profile',   false],
          ['catalog',       'Service Catalog',  false],
          ['users',         'Users & Roles',    false],
          ['notifications', 'Notifications',    true],
          ['system',        'System',           false],
        ].map(([v, l, cs]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>
            {l}
            {cs && (
              <span style={{
                marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px',
                textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)',
                background: 'rgba(0,0,0,0.07)', borderRadius: 3, padding: '1px 5px',
              }}>Soon</span>
            )}
          </div>
        ))}
      </div>

      {/* ── MARINA PROFILE ──────────────────────────────────────────── */}
      {tab === 'marina' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Marina Identity</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {marinaLoading ? (
                  <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
                ) : (
                  <>
                    <FieldRow label="Marina Name">
                      <input type="text" value={fm('name')} onChange={e => setM('name', e.target.value)} />
                    </FieldRow>
                    <FieldRow label="Time Zone">
                      <select value={fm('timezone')} onChange={e => setM('timezone', e.target.value)}>
                        <option value="Europe/London">Europe/London</option>
                        <option value="Europe/Paris">Europe/Paris</option>
                        <option value="Europe/Madrid">Europe/Madrid</option>
                        <option value="Europe/Rome">Europe/Rome</option>
                        <option value="Europe/Amsterdam">Europe/Amsterdam</option>
                        <option value="America/New_York">America/New_York</option>
                        <option value="America/Chicago">America/Chicago</option>
                        <option value="America/Los_Angeles">America/Los_Angeles</option>
                      </select>
                    </FieldRow>
                    <FieldRow label="Address">
                      <input type="text" value={fm('address')} onChange={e => setM('address', e.target.value)} />
                    </FieldRow>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="Latitude">
                        <input type="text" value={fm('lat')} onChange={e => setM('lat', e.target.value)} placeholder="e.g. 51.9458" />
                      </FieldRow>
                      <FieldRow label="Longitude">
                        <input type="text" value={fm('lng')} onChange={e => setM('lng', e.target.value)} placeholder="e.g. 1.2829" />
                      </FieldRow>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Contact & Billing</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {marinaLoading ? (
                  <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="Contact Email">
                        <input type="email" value={fm('contact_email')} onChange={e => setM('contact_email', e.target.value)} />
                      </FieldRow>
                      <FieldRow label="Contact Phone">
                        <input type="tel" value={fm('phone')} onChange={e => setM('phone', e.target.value)} />
                      </FieldRow>
                    </div>
                    <FieldRow label="VAT Number">
                      <input type="text" value={fm('vat_number')} onChange={e => setM('vat_number', e.target.value)} />
                    </FieldRow>
                    <FieldRow label="Billing Currency">
                      <select value={fm('currency')} onChange={e => setM('currency', e.target.value)}>
                        <option value="EUR">EUR — Euro (€)</option>
                        <option value="GBP">GBP — British Pound (£)</option>
                        <option value="USD">USD — US Dollar ($)</option>
                      </select>
                    </FieldRow>
                    <FieldRow label="Payment Terms" hint="Number of days from invoice issue date">
                      <select value={fm('payment_terms')} onChange={e => setM('payment_terms', e.target.value)}>
                        <option value="3">Net 3 days</option>
                        <option value="7">Net 7 days</option>
                        <option value="14">Net 14 days</option>
                        <option value="30">Net 30 days</option>
                      </select>
                    </FieldRow>
                    <button
                      className="btn btn-primary"
                      style={{ alignSelf: 'flex-start' }}
                      disabled={marinaSaving}
                      onClick={saveMarinaProfile}
                    >
                      {marinaSaving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </>
                )}
              </div>
            </div>

          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Capacity</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {marinaLoading ? (
                  <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="Total Berths">
                        <input type="number" value={fm('total_berths')} onChange={e => setM('total_berths', e.target.value)} />
                      </FieldRow>
                      <FieldRow label="Dry Storage Slots">
                        <input type="number" value={fm('dry_storage_slots')} onChange={e => setM('dry_storage_slots', e.target.value)} />
                      </FieldRow>
                    </div>
                    <FieldRow label="Max Vessel LOA" hint="Metres">
                      <input type="text" value={fm('max_loa')} onChange={e => setM('max_loa', e.target.value)} placeholder="e.g. 30" />
                    </FieldRow>
                    <FieldRow label="Max Draft" hint="Metres">
                      <input type="text" value={fm('max_draft')} onChange={e => setM('max_draft', e.target.value)} placeholder="e.g. 4.5" />
                    </FieldRow>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Subscription</div></div>
              <div className="card-body">
                {marinaLoading ? (
                  <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ background: 'var(--navy)', borderRadius: 8, padding: '16px 20px', color: '#fff', marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 6 }}>Current Plan</div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>{capitalize(marina?.plan)}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                        {marina?.status === 'trial'
                          ? `Trial ends ${formatDate(marina.trial_ends)}`
                          : 'All modules · Priority support'}
                      </div>
                      {marina?.next_renewal && marina.status !== 'trial' && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                          Renews <b style={{ color: 'rgba(255,255,255,0.75)' }}>{formatDate(marina.next_renewal)}</b>
                        </div>
                      )}
                    </div>
                    {[
                      ['Plan Status', capitalize(marina?.status)],
                      ['Active Berths', `${marina?.total_berths ?? '—'} / ${marina?.max_staff != null ? marina.max_staff : 'unlimited'}`],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'rgba(0,0,0,0.45)' }}>{k}</span>
                        <span style={{ fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── SERVICE CATALOG ─────────────────────────────────────────── */}
      {tab === 'catalog' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Service Catalog — Price Book</div>
            <button className="btn btn-primary" onClick={() => setCatalogForm({ name: '', category: 'service', pricing_model: 'flat_fee', unit_price: '', tax_rate: '0', is_active: true })}>
              + Add Item
            </button>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Category</th><th>Pricing Model</th><th>Unit Price</th><th>Tax Rate</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {catalogLoading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</td></tr>
                ) : catalog.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>No items yet. Add your first service to the price book.</td></tr>
                ) : catalog.map(item => (
                  <tr key={item.id}>
                    <td className="tbl-name">{item.name}</td>
                    <td><span className="badge badge-navy">{item.category_display}</span></td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{item.pricing_model_display}</td>
                    <td style={{ fontWeight: 600 }}>€{Number(item.unit_price).toFixed(2)}</td>
                    <td style={{ fontSize: 12 }}>{item.tax_rate}%</td>
                    <td><span className={`badge ${item.is_active ? 'badge-green' : 'badge-gray'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setCatalogForm({ ...item, unit_price: String(item.unit_price), tax_rate: String(item.tax_rate) })}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteCatalogItem(item.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {catalogForm && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={e => e.target === e.currentTarget && setCatalogForm(null)}
            >
              <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>{catalogForm.id ? 'Edit Item' : 'New Price Book Item'}</div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>NAME</div>
                  <input style={MI} value={catalogForm.name} onChange={e => setCatalogForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Visitor Slip, Shore Power" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>CATEGORY</div>
                    <select style={{ ...MI, padding: '7px 8px' }} value={catalogForm.category} onChange={e => setCatalogForm(f => ({ ...f, category: e.target.value }))}>
                      {[['berth','Berth'],['utility','Utility'],['service','Service'],['retail','Retail']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>PRICING MODEL</div>
                    <select style={{ ...MI, padding: '7px 8px' }} value={catalogForm.pricing_model} onChange={e => setCatalogForm(f => ({ ...f, pricing_model: e.target.value }))}>
                      {[['flat_fee','Flat Fee'],['per_night','Per Night'],['per_meter_per_night','Per Meter / Night'],['per_kwh','Per kWh'],['per_hour','Per Hour'],['per_meter_flat','Per Meter (flat)']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>UNIT PRICE (€)</div>
                    <input type="number" step="0.01" min="0" style={MI} value={catalogForm.unit_price} onChange={e => setCatalogForm(f => ({ ...f, unit_price: e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>TAX RATE (%)</div>
                    <input type="number" step="0.01" min="0" max="100" style={MI} value={catalogForm.tax_rate} onChange={e => setCatalogForm(f => ({ ...f, tax_rate: e.target.value }))} />
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 24, cursor: 'pointer' }}>
                  <input type="checkbox" checked={catalogForm.is_active} onChange={e => setCatalogForm(f => ({ ...f, is_active: e.target.checked }))} />
                  Active — visible in invoice line item picker
                </label>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setCatalogForm(null)}>Cancel</button>
                  <button className="btn btn-primary" disabled={catalogSaving || !catalogForm.name || !catalogForm.unit_price} onClick={() => saveCatalogItem(catalogForm)}>
                    {catalogSaving ? 'Saving…' : 'Save Item'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── USERS & ROLES ───────────────────────────────────────────── */}
      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Staff Accounts</div>
            <button className="btn btn-primary" onClick={() => setInviteForm({ first_name: '', last_name: '', email: '', role: 'staff' })}>
              <Ic n="plus" s={12} />Invite Staff
            </button>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>No users yet. Invite your first team member.</td></tr>
                ) : users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', border: 'none' }}>{getInitials(u)}</div>
                        <div className="tbl-name">{displayName(u)}</div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{u.email}</td>
                    <td><span className="badge badge-navy">{ROLE_LABELS[u.role] ?? u.role}</span></td>
                    <td><span className={`badge ${u.is_active ? 'badge-green' : 'badge-gray'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      {u.is_active && u.role !== 'owner' && (
                        <button className="btn btn-danger btn-sm" onClick={() => deactivateUser(u.id)}>Deactivate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-header-title">Role Permissions</div></div>
            <div className="card-body">
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ minWidth: 540 }}>
                  <thead>
                    <tr><th>Module</th><th>Owner</th><th>Manager</th><th>Staff</th></tr>
                  </thead>
                  <tbody>
                    {[
                      ['Marina Map',   true,  true,  true ],
                      ['Reservations', true,  true,  true ],
                      ['Boatyard',     true,  true,  false],
                      ['Billing',      true,  true,  false],
                      ['Members',      true,  true,  true ],
                      ['Maintenance',  true,  true,  true ],
                      ['Settings',     true,  false, false],
                    ].map(([module, ...perms]) => (
                      <tr key={module}>
                        <td style={{ fontWeight: 600 }}>{module}</td>
                        {perms.map((p, i) => (
                          <td key={i} style={{ textAlign: 'center' }}>
                            {p
                              ? <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 14 }}>✓</span>
                              : <span style={{ color: 'rgba(0,0,0,0.18)', fontSize: 12 }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS (Coming Soon) ──────────────────────────────── */}
      {tab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ComingSoonBanner />

          <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
            <div className="card">
              <div className="card-header">
                <div className="card-header-title">Automated Notification Rules</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Configure which events trigger email and SMS alerts</div>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {NOTIF_GROUPS.map(group => (
                  <div key={group.group}>
                    <div style={{ padding: '12px 18px 6px', background: 'var(--bg)', fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: 'var(--border)' }}>
                      {group.group}
                    </div>
                    {group.items.map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: 'var(--border)', gap: 16 }}>
                        <div style={{ flex: 1, fontSize: 12.5, color: 'rgba(0,0,0,0.8)' }}>{item.label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', width: 32 }}>Email</span>
                          <Toggle on={false} onChange={() => {}} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', width: 24 }}>SMS</span>
                          <Toggle on={false} onChange={() => {}} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header"><div className="card-header-title">Email Provider</div></div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <FieldRow label="Provider">
                  <select disabled><option>SendGrid</option></select>
                </FieldRow>
                <FieldRow label="From Address">
                  <input type="email" disabled placeholder="noreply@yourmarina.com" />
                </FieldRow>
                <FieldRow label="API Key">
                  <input type="password" disabled placeholder="••••••••••••••••••••" />
                </FieldRow>
                <FieldRow label="SMS Provider">
                  <select disabled><option>Twilio</option></select>
                </FieldRow>
                <div style={{ gridColumn: '1 / -1' }}>
                  <button className="btn btn-primary" disabled>Save Provider Settings</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM ──────────────────────────────────────────────────── */}
      {tab === 'system' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Integrations — Coming Soon */}
            <div className="card">
              <div className="card-header"><div className="card-header-title">Integrations</div></div>
              <div className="card-body" style={{ paddingBottom: 8 }}>
                <ComingSoonBanner />
              </div>
              <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
                {[
                  { name: 'Stripe Payments',    desc: 'Card payments and invoicing' },
                  { name: 'Xero Accounting',    desc: 'Invoice and payment sync' },
                  { name: 'AIS Vessel Tracking',desc: 'MarineTraffic API' },
                  { name: 'OpenWeatherMap',     desc: 'Live weather conditions' },
                  { name: 'DocuSign',           desc: 'Electronic signatures' },
                ].map(int => (
                  <div key={int.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: 'var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{int.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{int.desc}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="badge badge-gray">Not set up</span>
                      <button className="btn btn-ghost btn-sm" disabled>Connect</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Feature Flags — real */}
            <div className="card">
              <div className="card-header"><div className="card-header-title">Feature Flags</div></div>
              <div className="card-body" style={{ padding: 0 }}>
                {marinaLoading ? (
                  <div style={{ padding: '16px 18px', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
                ) : FLAG_DEFS.map(f => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', padding: '13px 18px', borderBottom: 'var(--border)', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{f.label}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{f.desc}</div>
                    </div>
                    <Toggle on={flags[f.key] ?? false} onChange={v => setFlags(prev => ({ ...prev, [f.key]: v }))} />
                  </div>
                ))}
                <div style={{ padding: '12px 18px' }}>
                  <button className="btn btn-primary btn-sm" disabled={flagsSaving || marinaLoading} onClick={saveFlags}>
                    {flagsSaving ? 'Saving…' : 'Save Flags'}
                  </button>
                </div>
              </div>
            </div>

          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Security — Coming Soon */}
            <div className="card">
              <div className="card-header"><div className="card-header-title">Security</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <ComingSoonBanner />
                <div style={{ opacity: 0.5, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>Two-factor authentication</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>Required for Owners & Managers</div>
                    </div>
                    <span className="badge badge-gray">Not configured</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>Session timeout</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>Auto-logout after idle period</div>
                    </div>
                    <span className="badge badge-gray">—</span>
                  </div>
                  <FieldRow label="IP Allowlist" hint="Leave blank to allow all IPs">
                    <input type="text" disabled placeholder="e.g. 192.168.1.0/24" />
                  </FieldRow>
                  <button className="btn btn-ghost btn-sm" disabled style={{ alignSelf: 'flex-start' }}>View Audit Log</button>
                </div>
              </div>
            </div>

            {/* Data & Backup — Coming Soon */}
            <div className="card">
              <div className="card-header"><div className="card-header-title">Data & Backup</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ComingSoonBanner />
                <div style={{ opacity: 0.5, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    ['Last backup',       '—',    null],
                    ['Backup retention',  '—',    null],
                    ['Database size',     '—',    null],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                      <span style={{ color: 'rgba(0,0,0,0.45)' }}>{k}</span>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button className="btn btn-ghost btn-sm" disabled>Export All Data</button>
                    <button className="btn btn-ghost btn-sm" disabled>Point-in-time Restore</button>
                  </div>
                </div>
              </div>
            </div>

            {/* API Access — Coming Soon */}
            <div className="card">
              <div className="card-header"><div className="card-header-title">API Access</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ComingSoonBanner />
                <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Production key</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 3, fontFamily: 'monospace', letterSpacing: '0.3px' }}>No key generated</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" disabled>Copy</button>
                      <button className="btn btn-danger btn-sm" disabled>Revoke</button>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" disabled style={{ alignSelf: 'flex-start', marginTop: 12 }}><Ic n="plus" s={11} />Generate New Key</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Invite modal ─────────────────────────────────────────────── */}
      {inviteForm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setInviteForm(null)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>Invite Staff Member</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>FIRST NAME</div>
                <input style={MI} value={inviteForm.first_name} onChange={e => setInviteForm(f => ({ ...f, first_name: e.target.value }))} placeholder="Jane" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>LAST NAME</div>
                <input style={MI} value={inviteForm.last_name} onChange={e => setInviteForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Smith" />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>EMAIL</div>
              <input type="email" style={MI} value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@yourmarina.com" />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>ROLE</div>
              <select style={{ ...MI, padding: '7px 8px' }} value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setInviteForm(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={inviteSaving || !inviteForm.email} onClick={() => inviteUser(inviteForm)}>
                {inviteSaving ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
