import { useState, useEffect, useRef } from 'react';
import api from '../api.js';
import useMarina from '../hooks/useMarina.js';
import Ic from '../components/ui/Icon.jsx';
import TaxRatesSettings from './TaxRatesSettings.jsx';
import MobileConfigTab from './settings/MobileConfigTab.jsx';
import BasinPolygonEditor from './BasinPolygonEditor.jsx';

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

const PLAN_OPTIONS = [
  { key: 'starter',      name: 'Starter',      monthlyPrice: 149, tagline: 'For small marinas getting started' },
  { key: 'professional', name: 'Professional',  monthlyPrice: 349, tagline: 'For growing marinas', badge: 'Most popular' },
  { key: 'enterprise',   name: 'Enterprise',    monthlyPrice: 899, tagline: 'For large marinas & groups' },
];

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

// ── Accounting integrations card ──────────────────────────────────────────

const ACCOUNTING_PLATFORMS = [
  { slug: 'xero',                kind: 'oauth',             label: 'Xero',                            desc: 'UK / AU / NZ / global',  authorizePath: '/xero/authorize/',          disconnectPath: '/xero/disconnect/',          tenantLabel: 'Organisation' },
  { slug: 'qbo',                 kind: 'oauth',             label: 'QuickBooks Online',               desc: 'US / UK / CA / global',  authorizePath: '/qbo/authorize/',           disconnectPath: '/qbo/disconnect/',           tenantLabel: 'Company' },
  { slug: 'sage_business_cloud', kind: 'oauth',             label: 'Sage Business Cloud Accounting',  desc: 'UK / IE / FR / DE / ES', authorizePath: '/sage/authorize/',          disconnectPath: '/sage/disconnect/',          tenantLabel: 'Business' },
  { slug: 'dynamics365',         kind: 'oauth',             label: 'Dynamics 365 Business Central',   desc: 'Global · Microsoft 365', authorizePath: '/d365/authorize/',          disconnectPath: '/d365/disconnect/',          tenantLabel: 'Environment' },
  { slug: 'myob',                kind: 'oauth',             label: 'MYOB AccountRight Live',          desc: 'AU / NZ',                authorizePath: '/myob/authorize/',          disconnectPath: '/myob/disconnect/',          tenantLabel: 'Company file' },
  { slug: 'netsuite',            kind: 'oauth-with-prompt', label: 'Oracle NetSuite',                 desc: 'US / global enterprise', authorizePath: '/netsuite/authorize/',      disconnectPath: '/netsuite/disconnect/',      tenantLabel: 'Account ID',
    promptLabel: 'NetSuite Account ID', promptHelp: 'Found under Setup → Company → Company Information (e.g. TSTDRV1234567).', promptParam: 'account_id' },
  { slug: 'sage_intacct',        kind: 'credentials',       label: 'Sage Intacct',                    desc: 'US / UK mid-market',     connectPath:   '/sage-intacct/connect/',    disconnectPath: '/sage-intacct/disconnect/',  tenantLabel: 'Company ID',
    fields: [
      { name: 'company_id',    label: 'Company ID',     placeholder: 'YOURCO',         type: 'text',     required: true },
      { name: 'user_id',       label: 'User ID',        placeholder: 'docksbase_user', type: 'text',     required: true },
      { name: 'user_password', label: 'User Password',  placeholder: '',               type: 'password', required: true },
      { name: 'location_id',   label: 'Location ID',    placeholder: 'optional',       type: 'text',     required: false },
    ] },
];

function AccountingIntegrationsCard() {
  const [configs, setConfigs] = useState(undefined); // undefined=loading, array=loaded
  const [busy, setBusy] = useState({}); // { [slug]: 'connect'|'test'|'sync'|'disconnect' }
  const [msg, setMsg]  = useState(null); // { type, text }

  const load = () =>
    api.get('/billing/accounting-configs/')
      .then(r => setConfigs(r.data.results ?? r.data))
      .catch(() => setConfigs([]));

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('integration');
    if (!slug) return;
    const platform = ACCOUNTING_PLATFORMS.find(p => p.slug === slug);
    const status = params.get('status');
    if (status === 'connected' && platform) {
      setMsg({ type: 'ok', text: `${platform.label} connected.` });
      load();
    } else if (status === 'error') {
      setMsg({ type: 'error', text: params.get('error') || 'Connection failed.' });
    }
    const url = new URL(window.location.href);
    ['integration', 'status', 'error'].forEach(k => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.toString());
  }, []);

  function setRowBusy(slug, value) {
    setBusy(b => ({ ...b, [slug]: value }));
  }

  const [credForm, setCredForm] = useState(null); // { platform, values: {…} } | null
  const [credSaving, setCredSaving] = useState(false);

  async function handleConnect(platform) {
    if (platform.kind === 'credentials') {
      const initial = {};
      platform.fields.forEach(f => { initial[f.name] = ''; });
      setCredForm({ platform, values: initial });
      setMsg(null);
      return;
    }
    if (platform.kind === 'oauth-with-prompt') {
      const value = window.prompt(`${platform.promptLabel}\n\n${platform.promptHelp || ''}`);
      if (!value) return;
      setRowBusy(platform.slug, 'connect');
      setMsg(null);
      try {
        const { data } = await api.get(platform.authorizePath, { params: { [platform.promptParam]: value } });
        window.location.href = data.authorize_url;
      } catch (err) {
        setMsg({ type: 'error', text: err?.response?.data?.detail || `Could not start ${platform.label} authorization.` });
        setRowBusy(platform.slug, '');
      }
      return;
    }
    setRowBusy(platform.slug, 'connect');
    setMsg(null);
    try {
      const { data } = await api.get(platform.authorizePath);
      window.location.href = data.authorize_url;
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || `Could not start ${platform.label} authorization.` });
      setRowBusy(platform.slug, '');
    }
  }

  async function submitCredentials() {
    if (!credForm) return;
    setCredSaving(true);
    setMsg(null);
    try {
      await api.post(credForm.platform.connectPath, credForm.values);
      setMsg({ type: 'ok', text: `${credForm.platform.label} connected.` });
      setCredForm(null);
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || 'Connection failed.' });
    } finally {
      setCredSaving(false);
    }
  }

  async function handleTest(platform, config) {
    setRowBusy(platform.slug, 'test');
    setMsg(null);
    try {
      const { data } = await api.post(`/billing/accounting-configs/${config.id}/test/`);
      setMsg({ type: 'ok', text: data.detail || 'Connection OK.' });
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || 'Connection test failed.' });
    } finally {
      setRowBusy(platform.slug, '');
    }
  }

  async function handleSyncNow(platform, config) {
    setRowBusy(platform.slug, 'sync');
    setMsg(null);
    try {
      await api.post(`/billing/accounting-configs/${config.id}/sync-now/`);
      setMsg({ type: 'ok', text: 'Sync dispatched. Records will appear in the sync log shortly.' });
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || 'Could not dispatch sync.' });
    } finally {
      setRowBusy(platform.slug, '');
    }
  }

  async function handleDisconnect(platform) {
    if (!window.confirm(`Disconnect ${platform.label}? Stored tokens will be cleared.`)) return;
    setRowBusy(platform.slug, 'disconnect');
    setMsg(null);
    try {
      await api.post(platform.disconnectPath);
      setMsg({ type: 'ok', text: `${platform.label} disconnected.` });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || 'Disconnect failed.' });
    } finally {
      setRowBusy(platform.slug, '');
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Accounting Integrations</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Invoice, payment, and journal sync</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 0 }}>
        {msg && (
          <div style={{
            fontSize: 12, padding: '8px 12px', margin: '12px 16px 0', borderRadius: 6,
            color:      msg.type === 'ok' ? '#0a7d3a' : '#b91c1c',
            background: msg.type === 'ok' ? '#ecfdf3' : '#fff5f5',
            border:     `1px solid ${msg.type === 'ok' ? '#a7f3d0' : '#fecaca'}`,
          }}>{msg.text}</div>
        )}
        {configs === undefined && (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', padding: '14px 18px' }}>Loading…</div>
        )}
        {credForm && (
          <div style={{ borderTop: 'var(--border)', padding: '14px 18px', background: '#fafafa' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Connect {credForm.platform.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {credForm.platform.fields.map(f => (
                <div key={f.name}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>
                    {f.label}{f.required && ' *'}
                  </label>
                  <input
                    className="input"
                    type={f.type}
                    placeholder={f.placeholder}
                    value={credForm.values[f.name] || ''}
                    onChange={e => setCredForm(c => ({ ...c, values: { ...c.values, [f.name]: e.target.value } }))}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button className="btn btn-ghost btn-sm" disabled={credSaving} onClick={() => setCredForm(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={credSaving} onClick={submitCredentials}>
                  {credSaving ? 'Testing & saving…' : 'Connect'}
                </button>
              </div>
            </div>
          </div>
        )}
        {configs !== undefined && ACCOUNTING_PLATFORMS.map(platform => {
          const config = configs.find(c => c.platform === platform.slug);
          const connected = config && config.is_active;
          const rowBusy = busy[platform.slug] || '';
          return (
            <div key={platform.slug} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderTop: 'var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{platform.label}</div>
                {!connected && (
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{platform.desc}</div>
                )}
                {connected && (
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                    {platform.tenantLabel}: <span style={{ fontWeight: 600 }}>{config.base_url || '—'}</span>
                    {config.last_synced_at && (
                      <> · Last sync {new Date(config.last_synced_at).toLocaleString()}</>
                    )}
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                {!connected && (
                  <button className="btn btn-primary btn-sm" disabled={!!rowBusy} onClick={() => handleConnect(platform)}>
                    {rowBusy === 'connect' ? 'Connecting…' : 'Connect'}
                  </button>
                )}
                {connected && (
                  <>
                    <span className="badge badge-teal">Connected</span>
                    <button className="btn btn-ghost btn-sm" disabled={!!rowBusy} onClick={() => handleTest(platform, config)}>
                      {rowBusy === 'test' ? 'Testing…' : 'Test'}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={!!rowBusy} onClick={() => handleSyncNow(platform, config)}>
                      {rowBusy === 'sync' ? 'Dispatching…' : 'Sync now'}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={!!rowBusy} onClick={() => handleDisconnect(platform)} style={{ color: '#b91c1c' }}>
                      {rowBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stripe Connect card ────────────────────────────────────────────────────

function StripeConnectCard({ marina }) {
  const connected = Boolean(marina?.stripe_account_id);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!connected) return;
    api.get('/auth/connect/status/')
      .then(r => setStatus(r.data))
      .catch(() => {});
  }, [connected]);

  async function handleConnect() {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/connect/onboard/');
      window.location.href = data.url;
    } catch {
      alert('Could not start Stripe Connect onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const chargesEnabled = status?.charges_enabled;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Stripe Payments</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Accept card payments from boaters</div>
      </div>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {!connected && 'Connect your Stripe account to accept booking payments.'}
            {connected && !status && 'Checking account status…'}
            {connected && status && chargesEnabled && 'Your Stripe account is connected and ready to accept payments.'}
            {connected && status && !chargesEnabled && 'Account connected but onboarding is incomplete. Finish setup to accept payments.'}
          </div>
          {connected && status?.dashboard_url && (
            <a
              href={status.dashboard_url}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--teal)', marginTop: 4, display: 'inline-block' }}
            >
              Open Stripe dashboard →
            </a>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {!connected && (
            <button className="btn btn-primary btn-sm" disabled={loading} onClick={handleConnect} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {loading && <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
              {loading ? 'Connecting…' : 'Connect Stripe'}
            </button>
          )}
          {connected && chargesEnabled && (
            <span className="badge badge-teal">Connected</span>
          )}
          {connected && !chargesEnabled && (
            <button className="btn btn-ghost btn-sm" disabled={loading} onClick={handleConnect} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {loading && <span style={{ width: 12, height: 12, border: '2px solid rgba(0,0,0,0.2)', borderTopColor: 'rgba(0,0,0,0.6)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
              {loading ? 'Connecting…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OTA Connections card ───────────────────────────────────────────────────

function OTAConnectionsCard() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // { name: '', inbound_ical_url: '' } | null
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(null); // connection id being synced
  const [removing, setRemoving] = useState(null); // connection id being removed
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/ota-connections/')
      .then(r => setConnections(r.data.results ?? r.data))
      .catch(() => setError('Failed to load OTA connections.'))
      .finally(() => setLoading(false));
  }, []);

  async function addConnection() {
    if (!form?.name?.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.post('/ota-connections/', form);
      setConnections(prev => [...prev, data]);
      setForm(null);
    } catch {
      setError('Failed to add connection.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteConnection(id) {
    if (!window.confirm('Remove this OTA connection? Berths assigned to it will revert to Direct.')) return;
    setRemoving(id);
    setError(null);
    try {
      await api.delete(`/ota-connections/${id}/`);
      setConnections(prev => prev.filter(c => c.id !== id));
    } catch {
      setError('Failed to remove connection.');
    } finally {
      setRemoving(null);
    }
  }

  async function triggerSync(conn) {
    if (syncing === conn.id) return;
    setSyncing(conn.id);
    setError(null);
    try {
      await api.post(`/ota-connections/${conn.id}/sync/`);
      const { data } = await api.get(`/ota-connections/${conn.id}/`);
      setConnections(prev => prev.map(c => c.id === conn.id ? data : c));
    } catch {
      setError('Sync failed.');
    } finally {
      setSyncing(null);
    }
  }

  if (loading) return <div style={{ padding: '12px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <div style={{ fontSize: 12, color: '#c0392b', padding: '4px 0' }}>{error}</div>}
      {connections.length === 0 && !error && (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '6px 0' }}>No OTA connections yet.</div>
      )}
      {connections.map(conn => (
        <div key={conn.id} style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{conn.name}</div>
            <button
              className="btn btn-danger btn-sm"
              disabled={removing === conn.id}
              onClick={() => deleteConnection(conn.id)}
            >
              {removing === conn.id ? 'Removing…' : 'Remove'}
            </button>
          </div>
          {conn.inbound_ical_url && (
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
              Inbound: <span style={{ fontFamily: 'monospace' }}>{conn.inbound_ical_url.length > 50 ? conn.inbound_ical_url.slice(0, 50) + '…' : conn.inbound_ical_url}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
              Outbound iCal:
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 6, fontSize: 10 }}
                onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/api/v1/berths/ical/${conn.outbound_token}.ics`)}
              >
                Copy URL
              </button>
            </div>
            {conn.inbound_ical_url && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
                disabled={syncing === conn.id}
                onClick={() => triggerSync(conn)}
              >
                {syncing === conn.id ? 'Syncing…' : `Sync now${conn.last_synced ? ` · ${new Date(conn.last_synced).toLocaleTimeString()}` : ''}`}
              </button>
            )}
          </div>
        </div>
      ))}

      {form ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
          <input
            placeholder="Connection name (e.g. mySea)"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            style={{ fontSize: 13 }}
          />
          <input
            placeholder="Inbound iCal URL (optional)"
            value={form.inbound_ical_url}
            onChange={e => setForm(f => ({ ...f, inbound_ical_url: e.target.value }))}
            style={{ fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()} onClick={addConnection}>
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ name: '', inbound_ical_url: '' })}>
          + Add connection
        </button>
      )}
    </div>
  );
}

// ── Support Access Section ─────────────────────────────────────────────────

function SupportAccessSection() {
  const { marina } = useMarina();
  const [grantedUntil, setGrantedUntil] = useState(marina?.support_access_granted_until || null);
  const [loading, setLoading] = useState(false);

  const isActive = grantedUntil && new Date(grantedUntil) > new Date();

  async function handleGrant() {
    setLoading(true);
    try {
      const { data } = await api.post('/marina/grant-support-access/');
      setGrantedUntil(data.support_access_granted_until);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    setLoading(true);
    try {
      await api.delete('/marina/grant-support-access/');
      setGrantedUntil(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">DocksBase Support Access</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>
          Allow DocksBase support agents to access your account for troubleshooting.
          Access automatically expires after 48 hours.
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Toggle on={isActive} onChange={isActive ? handleRevoke : handleGrant} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary, rgba(0,0,0,0.5))' }}>
          {isActive
            ? `Access granted — expires ${formatDate(grantedUntil)}`
            : 'Support access not granted'}
        </span>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-secondary, rgba(0,0,0,0.4))' }}>Saving…</span>}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Settings() {
  const [tab, setTab] = useState('marina');

  // ── Billing ────────────────────────────────────────────────────────────
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState(null);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [changePlanModal, setChangePlanModal] = useState(false);
  const [changePlanLoading, setChangePlanLoading] = useState(false);
  const [changePlanSelected, setChangePlanSelected] = useState(null);

  useEffect(() => {
    if (tab !== 'billing') return;
    setBillingLoading(true);
    setBillingError(null);
    api.get('/billing/subscription/')
      .then(r => setBilling(r.data))
      .catch(() => setBillingError('Could not load billing information.'))
      .finally(() => setBillingLoading(false));
  }, [tab]);

  async function cancelSubscription() {
    setCancelLoading(true);
    try {
      await api.post('/billing/subscription/cancel/');
      setBilling(b => ({ ...b, cancel_at_period_end: true }));
      setCancelModal(false);
    } catch {
      alert('Could not cancel subscription. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  }

  async function changePlan() {
    if (!changePlanSelected) return;
    setChangePlanLoading(true);
    try {
      await api.post('/billing/subscription/change-plan/', { plan: changePlanSelected.key });
      setBilling(b => ({ ...b, plan: changePlanSelected.key, monthly_price: changePlanSelected.monthlyPrice }));
      setChangePlanModal(false);
      setChangePlanSelected(null);
    } catch {
      alert('Could not change plan. Please try again.');
    } finally {
      setChangePlanLoading(false);
    }
  }
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
      // SMTP / email config
      notification_from_email: marina.notification_from_email ?? '',
      smtp_host:               marina.smtp_host               ?? '',
      smtp_port:               marina.smtp_port               != null ? String(marina.smtp_port) : '',
      smtp_user:               marina.smtp_user               ?? '',
      smtp_password:           marina.smtp_password           ?? '',
      smtp_use_tls:            marina.smtp_use_tls            ?? true,
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
      await updateMarina({
        ...mf,
        payment_terms: Number(mf.payment_terms),
        smtp_port: mf.smtp_port !== '' ? Number(mf.smtp_port) : null,
      });
    } finally {
      setMarinaSaving(false);
    }
  }

  async function saveSmtpConfig() {
    if (!mf) return;
    setMarinaSaving(true);
    try {
      await updateMarina({
        notification_from_email: mf.notification_from_email,
        smtp_host:               mf.smtp_host,
        smtp_port:               mf.smtp_port !== '' ? Number(mf.smtp_port) : null,
        smtp_user:               mf.smtp_user,
        smtp_password:           mf.smtp_password,
        smtp_use_tls:            mf.smtp_use_tls,
      });
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

  const [permForm, setPermForm] = useState(null); // { user, perms: {...} } | null

  async function savePermissions() {
    if (!permForm) return;
    try {
      const { data } = await api.patch(`/marina/users/${permForm.user.id}/`, {
        module_permissions: permForm.perms,
      });
      setUsers(prev => prev.map(u => u.id === permForm.user.id ? data : u));
      setPermForm(null);
    } catch {
      alert('Could not save permissions.');
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

  // ── Integrations — Dropbox Sign ───────────────────────────────────────

  const [dsSettings, setDsSettings] = useState(null);
  const [dsLoading, setDsLoading]   = useState(false);
  const [dsApiKey, setDsApiKey]     = useState('');
  const [dsClientId, setDsClientId] = useState('');
  const [dsSaving, setDsSaving]     = useState(false);
  const [dsMsg, setDsMsg]           = useState(null);

  useEffect(() => {
    if (tab !== 'integrations') return;
    setDsLoading(true);
    api.get('/marina/integrations/dropbox-sign/')
      .then(r => {
        setDsSettings(r.data);
        setDsClientId(r.data.client_id || '');
      })
      .finally(() => setDsLoading(false));
  }, [tab]);

  async function handleDsSave() {
    setDsSaving(true);
    setDsMsg(null);
    try {
      const r = await api.patch('/marina/integrations/dropbox-sign/', {
        api_key: dsApiKey,
        client_id: dsClientId,
      });
      setDsSettings(r.data);
      setDsApiKey('');
      setDsMsg({ type: 'ok', text: r.data.connected ? 'Connected.' : 'Settings saved.' });
    } catch {
      setDsMsg({ type: 'err', text: 'Save failed. Check credentials and try again.' });
    } finally {
      setDsSaving(false);
    }
  }

  async function handleDsDisconnect() {
    setDsSaving(true);
    setDsMsg(null);
    try {
      const r = await api.patch('/marina/integrations/dropbox-sign/', { api_key: '', client_id: '' });
      setDsSettings(r.data);
      setDsClientId('');
      setDsApiKey('');
      setDsMsg({ type: 'ok', text: 'Disconnected.' });
    } finally {
      setDsSaving(false);
    }
  }

  // ── Integrations — MarineTraffic / OpenWeatherMap / DocuSign ───────────
  //
  // Each is just an API key (DocuSign needs a second account id). One generic
  // state shape per provider keeps the JSX terse.

  const [marineTraffic, setMarineTraffic] = useState({ data: null, apiKey: '', saving: false, msg: null });
  const [openWeather,   setOpenWeather]   = useState({ data: null, apiKey: '', saving: false, msg: null });
  const [docusign,      setDocusign]      = useState({ data: null, apiKey: '', accountId: '', saving: false, msg: null });

  useEffect(() => {
    if (tab !== 'integrations') return;
    let cancelled = false;
    Promise.all([
      api.get('/marina/integrations/marinetraffic/').then(r => r.data).catch(() => null),
      api.get('/marina/integrations/openweathermap/').then(r => r.data).catch(() => null),
      api.get('/marina/integrations/docusign/').then(r => r.data).catch(() => null),
    ]).then(([mt, ow, ds]) => {
      if (cancelled) return;
      if (mt) setMarineTraffic(s => ({ ...s, data: mt }));
      if (ow) setOpenWeather(s => ({ ...s, data: ow }));
      if (ds) setDocusign(s => ({ ...s, data: ds, accountId: ds.docusign_account_id || '' }));
    });
    return () => { cancelled = true; };
  }, [tab]);

  async function saveSimpleIntegration(setState, state, endpoint, body, label) {
    setState(s => ({ ...s, saving: true, msg: null }));
    try {
      const { data } = await api.patch(endpoint, body);
      setState(s => ({
        ...s,
        data,
        apiKey: '',
        saving: false,
        msg: { type: 'ok', text: data.connected ? `${label} connected.` : `${label} settings saved.` },
      }));
    } catch {
      setState(s => ({ ...s, saving: false, msg: { type: 'err', text: 'Save failed. Check the value and try again.' } }));
    }
  }

  async function disconnectSimple(setState, endpoint, body) {
    setState(s => ({ ...s, saving: true, msg: null }));
    try {
      const { data } = await api.patch(endpoint, body);
      setState(s => ({ ...s, data, apiKey: '', accountId: data.docusign_account_id || '', saving: false, msg: { type: 'ok', text: 'Disconnected.' } }));
    } catch {
      setState(s => ({ ...s, saving: false, msg: { type: 'err', text: 'Disconnect failed.' } }));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Tab bar */}
      <div className="tabs">
        {[
          ['marina',        'Marina Profile',   false],
          ['users',         'Users & Roles',    false],
          ['billing',       'Billing',          false],
          ['tax-rates',     'Tax Rates',        false],
          ['notifications', 'Notifications',    true],
          ['integrations',  'Integrations',     false],
          ['mobile-app',    'Mobile App',       false],
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

            {!marinaLoading && fm('lat') && fm('lng') && (
              <div className="card">
                <details>
                  <summary
                    className="card-header"
                    style={{ cursor: 'pointer', listStyle: 'none' }}
                  >
                    <div className="card-header-title">AIS Basin (advanced)</div>
                  </summary>
                  <div className="card-body">
                    <BasinPolygonEditor
                      marina={mf}
                      onSaved={(polygon) => setM('basin_polygon', polygon)}
                    />
                  </div>
                </details>
              </div>
            )}

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

      {/* ── USERS & ROLES ───────────────────────────────────────────── */}
      {tab === 'users' && (
        <>
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
                      <div style={{ display: 'flex', gap: 6 }}>
                        {u.role === 'staff' && u.is_active && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setPermForm({
                            user: u,
                            perms: u.module_permissions ?? {},
                          })}>
                            Permissions
                          </button>
                        )}
                        {u.is_active && u.role !== 'owner' && (
                          <button className="btn btn-danger btn-sm" onClick={() => deactivateUser(u.id)}>Deactivate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-header-title">Staff Module Access</div></div>
            <div className="card-body" style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6 }}>
              Owners and Managers always have full access to every module. For Staff accounts, click <strong>Permissions</strong> on any staff user above to control which modules they can see. Modules not explicitly blocked default to accessible.
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['overview','map','reservations','vessels','documents','boatyard','maintenance','staff','billing','reports','members','sales'].map(m => (
                  <span key={m} className="badge badge-navy" style={{ textTransform: 'none' }}>{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {permForm && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => e.target === e.currentTarget && setPermForm(null)}
          >
            <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Module Permissions</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>
                {permForm.user.first_name} {permForm.user.last_name} · Staff
              </div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 16 }}>
                Toggle off to hide a module from this staff member's sidebar. All modules are on by default.
              </div>
              {[
                ['overview',     'Overview'],
                ['map',          'Marina Map'],
                ['reservations', 'Reservations'],
                ['vessels',      'Vessels'],
                ['documents',    'Documents & eSign'],
                ['boatyard',     'Boatyard'],
                ['maintenance',  'Maintenance'],
                ['staff',        'Staff Schedule'],
                ['billing',      'Billing'],
                ['reports',      'Reports'],
                ['members',      'Members'],
                ['sales',        'Sales'],
              ].map(([id, label]) => {
                const allowed = permForm.perms[id] !== false;
                return (
                  <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 13, fontWeight: allowed ? 500 : 400, color: allowed ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.35)' }}>{label}</span>
                    <Toggle
                      on={allowed}
                      onChange={val => setPermForm(f => ({
                        ...f,
                        perms: { ...f.perms, [id]: val },
                      }))}
                    />
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPermForm(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={savePermissions}>Save Permissions</button>
              </div>
            </div>
          </div>
        )}
        </>
      )}

      {/* ── BILLING ─────────────────────────────────────────────────── */}
      {tab === 'billing' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Subscription</div></div>
              <div className="card-body">
                {billingLoading ? (
                  <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
                ) : billingError ? (
                  <div style={{ color: '#c0392b', fontSize: 13 }}>{billingError}</div>
                ) : billing ? (
                  <>
                    <div style={{ background: 'var(--navy)', borderRadius: 8, padding: '16px 20px', color: '#fff', marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 6 }}>Current Plan</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{capitalize(billing.plan)}</div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>€{billing.monthly_price}/mo</div>
                      {billing.cancel_at_period_end && (
                        <div style={{ marginTop: 10, background: 'rgba(255,100,100,0.15)', borderRadius: 5, padding: '6px 10px', fontSize: 11, color: 'rgba(255,200,200,0.9)' }}>
                          Cancels at end of billing period
                        </div>
                      )}
                    </div>
                    {[
                      ['Status',     capitalize(billing.status)],
                      billing.status === 'trial'
                        ? ['Trial ends', formatDate(billing.trial_ends)]
                        : ['Next renewal', formatDate(billing.next_renewal)],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'rgba(0,0,0,0.45)' }}>{k}</span>
                        <span style={{ fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setChangePlanSelected(null); setChangePlanModal(true); }}>
                        Change Plan
                      </button>
                      {!billing.cancel_at_period_end && (
                        <button className="btn btn-danger btn-sm" onClick={() => setCancelModal(true)}>
                          Cancel Subscription
                        </button>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>

          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Payment Method</div></div>
              <div className="card-body">
                {billingLoading ? (
                  <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
                ) : billing?.card_last4 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                    <div style={{ fontSize: 22 }}>💳</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{billing.card_brand} •••• {billing.card_last4}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>Card on file for subscription billing</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)' }}>No card on file</div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── TAX RATES ───────────────────────────────────────────────── */}
      {tab === 'tax-rates' && (
        <div style={{ padding: '24px 0' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Tax Rates</h3>
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>
            Define the tax rates applied to individual items in your service catalog.
            Rates are immutable once created — to change a rate, create a new one and archive the old.
          </p>
          <TaxRatesSettings />
        </div>
      )}

      {/* Cancel confirmation modal */}
      {cancelModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setCancelModal(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cancel subscription?</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 24, lineHeight: 1.6 }}>
              Your account stays active until the end of the current billing period. After that it will be suspended and you will lose access.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setCancelModal(false)}>Keep subscription</button>
              <button className="btn btn-danger" disabled={cancelLoading} onClick={cancelSubscription}>
                {cancelLoading ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change plan modal */}
      {changePlanModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setChangePlanModal(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 520, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Change Plan</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>Changes take effect immediately and are prorated.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {PLAN_OPTIONS.map(plan => (
                <button key={plan.key} type="button"
                  onClick={() => setChangePlanSelected(plan)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderRadius: 8, border: `2px solid ${changePlanSelected?.key === plan.key ? 'var(--navy)' : 'rgba(0,0,0,0.1)'}`,
                    background: changePlanSelected?.key === plan.key ? 'rgba(12,31,61,0.04)' : '#fff',
                    cursor: plan.key === billing?.plan ? 'default' : 'pointer',
                    opacity: plan.key === billing?.plan ? 0.45 : 1,
                  }}
                  disabled={plan.key === billing?.plan}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {plan.name}
                      {plan.badge && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: 'var(--gold, #c9a84c)', color: 'var(--navy)', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{plan.badge}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{plan.tagline}</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', flexShrink: 0, marginLeft: 16 }}>€{plan.monthlyPrice}/mo</div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setChangePlanModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!changePlanSelected || changePlanLoading} onClick={changePlan}>
                {changePlanLoading ? 'Updating…' : 'Confirm Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS / EMAIL CONFIG ─────────────────────────────── */}
      {tab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* SMTP / outgoing email */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Outgoing Email (SMTP)</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>
                Leave blank to use the platform default email sender. Fill in your own SMTP details to send from your marina's address.
              </div>
            </div>
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FieldRow label="From Address" hint="e.g. noreply@yourmarina.com">
                <input
                  type="email" style={MI}
                  value={fm('notification_from_email')}
                  onChange={e => setM('notification_from_email', e.target.value)}
                  placeholder="noreply@yourmarina.com"
                />
              </FieldRow>
              <FieldRow label="SMTP Host" hint="e.g. smtp.sendgrid.net">
                <input
                  type="text" style={MI}
                  value={fm('smtp_host')}
                  onChange={e => setM('smtp_host', e.target.value)}
                  placeholder="smtp.yourmailprovider.com"
                />
              </FieldRow>
              <FieldRow label="SMTP Port" hint="Usually 587 (TLS) or 465 (SSL)">
                <input
                  type="number" style={MI}
                  value={fm('smtp_port')}
                  onChange={e => setM('smtp_port', e.target.value)}
                  placeholder="587"
                />
              </FieldRow>
              <FieldRow label="SMTP Username">
                <input
                  type="text" style={MI}
                  value={fm('smtp_user')}
                  onChange={e => setM('smtp_user', e.target.value)}
                  placeholder="apikey or your SMTP login"
                />
              </FieldRow>
              <FieldRow label="SMTP Password">
                <input
                  type="password" style={MI}
                  value={fm('smtp_password')}
                  onChange={e => setM('smtp_password', e.target.value)}
                  placeholder="••••••••••••••••"
                />
              </FieldRow>
              <FieldRow label="Use TLS">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34 }}>
                  <Toggle on={mf?.smtp_use_tls ?? true} onChange={v => setM('smtp_use_tls', v)} />
                  <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{mf?.smtp_use_tls ? 'Enabled' : 'Disabled'}</span>
                </div>
              </FieldRow>
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="btn btn-primary" disabled={marinaSaving} onClick={saveSmtpConfig}>
                  {marinaSaving ? 'Saving…' : 'Save Email Settings'}
                </button>
              </div>
            </div>
          </div>

          {/* Notification rules — coming soon */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Automated Notification Rules</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Configure which events trigger email alerts</div>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <ComingSoonBanner />
              <div style={{ opacity: 0.4, pointerEvents: 'none' }}>
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
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── SYSTEM ──────────────────────────────────────────────────── */}
      {tab === 'system' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Stripe Connect — live */}
            <StripeConnectCard marina={marina} />

            {/* Accounting Integrations — live */}
            <AccountingIntegrationsCard />

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

            {/* OTA Connections */}
            <div className="card">
              <div className="card-header">
                <div className="card-header-title">OTA Connections</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Channel distribution partners</div>
              </div>
              <OTAConnectionsCard />
            </div>

            {/* Support Access */}
            <SupportAccessSection />

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

      {/* ── MOBILE APP ──────────────────────────────────────────────── */}
      {tab === 'mobile-app' && (
        <div style={{ maxWidth: 560 }}>
          <MobileConfigTab marina={marina} />
        </div>
      )}

      {/* ── INTEGRATIONS ─────────────────────────────────────────────── */}
      {tab === 'integrations' && (
        <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Dropbox Sign</div>
              {dsSettings?.connected && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
              )}
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {dsLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>
                    Connect your marina's own Dropbox Sign account to enable e-signatures on waivers. Your account is billed directly by Dropbox Sign — DocksBase never sees payment.{' '}
                    <a href="https://app.hellosign.com/account/signUp" target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>
                      Create a Dropbox Sign account →
                    </a>
                  </div>
                  <FieldRow label="Client ID" hint="Found in Dropbox Sign → API → App Settings">
                    <input
                      type="text"
                      value={dsClientId}
                      onChange={e => setDsClientId(e.target.value)}
                      placeholder="e.g. a1b2c3d4e5f6..."
                    />
                  </FieldRow>
                  <FieldRow
                    label="API Key"
                    hint={dsSettings?.connected ? `Current key ending in ···${dsSettings.api_key_tail}` : 'Found in Dropbox Sign → API → API Keys'}
                  >
                    <input
                      type="password"
                      value={dsApiKey}
                      onChange={e => setDsApiKey(e.target.value)}
                      placeholder={dsSettings?.connected ? 'Leave blank to keep current key' : 'Paste API key here'}
                      autoComplete="new-password"
                    />
                  </FieldRow>
                  {dsMsg && (
                    <div style={{ fontSize: 12, color: dsMsg.type === 'ok' ? 'var(--teal)' : 'var(--red)', fontWeight: 600 }}>
                      {dsMsg.text}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={handleDsSave} disabled={dsSaving}>
                      {dsSaving ? 'Saving…' : dsSettings?.connected ? 'Update' : 'Connect'}
                    </button>
                    {dsSettings?.connected && (
                      <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={handleDsDisconnect} disabled={dsSaving}>
                        Disconnect
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── AIS Vessel Tracking — MarineTraffic ───────────────────── */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">AIS Vessel Tracking</div>
              {marineTraffic.data?.connected && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
              )}
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>
                Connect MarineTraffic to show live vessel positions on the harbor map. Your account is billed directly by MarineTraffic.{' '}
                <a href="https://www.marinetraffic.com/en/ais-api-services" target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>
                  Get an API key →
                </a>
              </div>
              <FieldRow
                label="API Key"
                hint={marineTraffic.data?.connected ? `Current key ending in ···${marineTraffic.data.api_key_tail}` : 'Found in MarineTraffic → API Services → My API Keys'}
              >
                <input
                  type="password"
                  value={marineTraffic.apiKey}
                  onChange={e => setMarineTraffic(s => ({ ...s, apiKey: e.target.value }))}
                  placeholder={marineTraffic.data?.connected ? 'Leave blank to keep current key' : 'Paste API key here'}
                  autoComplete="new-password"
                />
              </FieldRow>
              {marineTraffic.msg && (
                <div style={{ fontSize: 12, color: marineTraffic.msg.type === 'ok' ? 'var(--teal)' : 'var(--red)', fontWeight: 600 }}>
                  {marineTraffic.msg.text}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={marineTraffic.saving}
                  onClick={() => saveSimpleIntegration(
                    setMarineTraffic, marineTraffic,
                    '/marina/integrations/marinetraffic/',
                    { api_key: marineTraffic.apiKey },
                    'MarineTraffic',
                  )}
                >
                  {marineTraffic.saving ? 'Saving…' : marineTraffic.data?.connected ? 'Update' : 'Connect'}
                </button>
                {marineTraffic.data?.connected && (
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--red)' }}
                    disabled={marineTraffic.saving}
                    onClick={() => disconnectSimple(setMarineTraffic, '/marina/integrations/marinetraffic/', { api_key: '' })}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── OpenWeatherMap ────────────────────────────────────────── */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">OpenWeatherMap</div>
              {openWeather.data?.connected && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
              )}
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>
                Show live local weather on the dashboard, using your marina's lat/lng from Marina Profile.{' '}
                <a href="https://openweathermap.org/api" target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>
                  Get a free API key →
                </a>
              </div>
              <FieldRow
                label="API Key"
                hint={openWeather.data?.connected ? `Current key ending in ···${openWeather.data.api_key_tail}` : 'Found in OpenWeatherMap → My API Keys'}
              >
                <input
                  type="password"
                  value={openWeather.apiKey}
                  onChange={e => setOpenWeather(s => ({ ...s, apiKey: e.target.value }))}
                  placeholder={openWeather.data?.connected ? 'Leave blank to keep current key' : 'Paste API key here'}
                  autoComplete="new-password"
                />
              </FieldRow>
              {openWeather.msg && (
                <div style={{ fontSize: 12, color: openWeather.msg.type === 'ok' ? 'var(--teal)' : 'var(--red)', fontWeight: 600 }}>
                  {openWeather.msg.text}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={openWeather.saving}
                  onClick={() => saveSimpleIntegration(
                    setOpenWeather, openWeather,
                    '/marina/integrations/openweathermap/',
                    { api_key: openWeather.apiKey },
                    'OpenWeatherMap',
                  )}
                >
                  {openWeather.saving ? 'Saving…' : openWeather.data?.connected ? 'Update' : 'Connect'}
                </button>
                {openWeather.data?.connected && (
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--red)' }}
                    disabled={openWeather.saving}
                    onClick={() => disconnectSimple(setOpenWeather, '/marina/integrations/openweathermap/', { api_key: '' })}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── DocuSign ──────────────────────────────────────────────── */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">DocuSign</div>
              {docusign.data?.connected && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
              )}
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>
                Alternative e-signature provider to Dropbox Sign. Your account is billed directly by DocuSign — DocksBase never sees payment.{' '}
                <a href="https://developers.docusign.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>
                  Create a DocuSign developer account →
                </a>
              </div>
              <FieldRow label="Account ID" hint="Found in DocuSign Admin → API and Keys → API Account ID">
                <input
                  type="text"
                  value={docusign.accountId}
                  onChange={e => setDocusign(s => ({ ...s, accountId: e.target.value }))}
                  placeholder="e.g. 1a2b3c4d-..."
                />
              </FieldRow>
              <FieldRow
                label="Integration Key (API Key)"
                hint={docusign.data?.connected ? `Current key ending in ···${docusign.data.api_key_tail}` : 'Found in DocuSign Admin → Apps and Keys'}
              >
                <input
                  type="password"
                  value={docusign.apiKey}
                  onChange={e => setDocusign(s => ({ ...s, apiKey: e.target.value }))}
                  placeholder={docusign.data?.connected ? 'Leave blank to keep current key' : 'Paste integration key here'}
                  autoComplete="new-password"
                />
              </FieldRow>
              {docusign.msg && (
                <div style={{ fontSize: 12, color: docusign.msg.type === 'ok' ? 'var(--teal)' : 'var(--red)', fontWeight: 600 }}>
                  {docusign.msg.text}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={docusign.saving}
                  onClick={() => saveSimpleIntegration(
                    setDocusign, docusign,
                    '/marina/integrations/docusign/',
                    { api_key: docusign.apiKey, docusign_account_id: docusign.accountId },
                    'DocuSign',
                  )}
                >
                  {docusign.saving ? 'Saving…' : docusign.data?.connected ? 'Update' : 'Connect'}
                </button>
                {docusign.data?.connected && (
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--red)' }}
                    disabled={docusign.saving}
                    onClick={() => disconnectSimple(setDocusign, '/marina/integrations/docusign/', { api_key: '', docusign_account_id: '' })}
                  >
                    Disconnect
                  </button>
                )}
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
