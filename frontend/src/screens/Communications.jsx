import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';
import ScreenInfo from '../components/ui/ScreenInfo.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const CHANNEL_LABELS = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', task: 'Task' };
const CHANNEL_ICONS  = { email: 'mail', sms: 'message-square', whatsapp: 'smartphone', task: 'check-circle' };

const STATUS_CLASS = {
  sent:      'badge-green',
  delivered: 'badge-teal',
  failed:    'badge-red',
  queued:    'badge-gray',
  received:  'badge-purple',
  active:    'badge-green',
  inactive:  'badge-gray',
  completed: 'badge-blue',
  email:     'badge-blue',
  sms:       'badge-green',
  whatsapp:  'badge-teal',
};

function StatusBadge({ status, label }) {
  return (
    <span className={`badge ${STATUS_CLASS[status] ?? 'badge-gray'}`}>
      {label || status}
    </span>
  );
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'rgba(0,0,0,0.38)' }}>
      <div style={{ marginBottom: 12 }}><Ic n={icon} s={28} c="rgba(0,0,0,0.2)"/></div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12 }}>{subtitle}</div>}
    </div>
  );
}

function LoadingRow({ cols }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
        Loading…
      </td>
    </tr>
  );
}

function SectionHeader({ title, action }) {
  return (
    <div className="sec-hdr">
      <span className="sec-hdr-title">{title}</span>
      {action}
    </div>
  );
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// ── Tab: Templates ─────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState({ name: '', channel: 'email', subject: '', body: '' });

  useEffect(() => {
    api.get('/communications/message-templates/')
      .then(r => setTemplates(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/communications/message-templates/', { ...form });
      setTemplates(prev => [data, ...prev]);
      setShowForm(false);
      setForm({ name: '', channel: 'email', subject: '', body: '' });
    } catch {
      // surface error in real app
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Message Templates"
        action={
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ New Template'}
          </button>
        }
      />

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-header-title">New Template</div></div>
          <div className="card-body">
            <form onSubmit={handleCreate}>
              <div className="row g-3">
                <div className="col-6">
                  <label className="form-label">Name</label>
                  <input
                    className="form-control"
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Booking Confirmation"
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">Channel</label>
                  <select
                    className="form-select"
                    value={form.channel}
                    onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                {form.channel === 'email' && (
                  <div className="col-12">
                    <label className="form-label">Subject</label>
                    <input
                      className="form-control"
                      value={form.subject}
                      onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                      placeholder="e.g. Your booking at {{marina_name}} is confirmed"
                    />
                  </div>
                )}
                <div className="col-12">
                  <label className="form-label">Body</label>
                  <textarea
                    className="form-control"
                    rows={5}
                    required
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    placeholder="Use {{variable}} placeholders for dynamic content"
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                </div>
                <div className="col-12">
                  <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Template'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Channel</th>
                <th>Subject</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow cols={4} />}
              {!loading && templates.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState icon="mail" title="No templates yet" subtitle="Create your first message template above." />
                  </td>
                </tr>
              )}
              {!loading && templates.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td>
                    <StatusBadge status={t.channel} label={<><Ic n={CHANNEL_ICONS[t.channel]} s={13}/> {CHANNEL_LABELS[t.channel] || t.channel}</>} />
                  </td>
                  <td style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13 }}>{t.subject || '—'}</td>
                  <td style={{ color: 'rgba(0,0,0,0.38)', fontSize: 12 }}>{fmtDate(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Journeys ──────────────────────────────────────────────────────────

const TRIGGER_LABELS = {
  booking_confirmed:  'Booking Confirmed',
  booking_checkout:   'Guest Checked Out',
  renewal_due:        'Annual Renewal Due',
  insurance_expiring: 'Insurance Expiring',
  invoice_overdue:    'Invoice Overdue',
  document_unsigned:  'Document Unsigned',
  manual:             'Manual Trigger',
};

function JourneyStepsPanel({ journeyId, onClose }) {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!journeyId) return;
    api.get(`/communications/journeys/${journeyId}/steps/`)
      .then(r => setSteps(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [journeyId]);

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 380,
      background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      zIndex: 200, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '18px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Journey Steps</div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.4)' }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading && <div style={{ color: 'rgba(0,0,0,0.38)', fontSize: 13 }}>Loading steps…</div>}
        {!loading && steps.length === 0 && (
          <EmptyState icon="clipboard" title="No steps" subtitle="This journey has no steps configured yet." />
        )}
        {!loading && steps.map((step, idx) => (
          <div key={step.id} style={{
            marginBottom: 12, padding: '12px 14px', borderRadius: 8,
            background: step.step_type === 'gate' ? 'rgba(255,190,20,0.08)' : 'var(--bg, #f8f8f8)',
            border: step.step_type === 'gate' ? '1.5px solid rgba(200,150,0,0.25)' : '1.5px solid rgba(0,0,0,0.07)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', background: 'var(--navy, #1a2d4a)',
                color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {step.order}
              </span>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                {step.step_type === 'gate'
                  ? <><Ic n="refresh-cw" s={13}/> Gate</>
                  : <><Ic n={CHANNEL_ICONS[step.channel]} s={13}/> {CHANNEL_LABELS[step.channel] || step.channel}</>
                }
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>
                +{step.delay_value} {step.delay_unit}
              </span>
            </div>
            {step.subject && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginBottom: 4 }}>
                Subject: {step.subject}
              </div>
            )}
            {step.condition_field && step.condition_field !== 'none' && (
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', fontStyle: 'italic' }}>
                Condition: {step.condition_field} {step.condition_operator} {step.condition_value}
              </div>
            )}
            {step.step_type === 'gate' && (
              <div style={{ fontSize: 11, color: 'rgba(160,120,0,0.9)', marginTop: 4 }}>
                Timeout after {step.gate_timeout_days} days
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function JourneysTab() {
  const [journeys, setJourneys]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedId, setSelectedId]     = useState(null);
  const [showForm, setShowForm]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [toggling, setToggling]         = useState(null);
  const [form, setForm]                 = useState({ name: '', description: '', trigger_event: 'booking_confirmed' });

  useEffect(() => {
    api.get('/communications/journeys/')
      .then(r => setJourneys(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/communications/journeys/', form);
      setJourneys(prev => [data, ...prev]);
      setShowForm(false);
      setForm({ name: '', description: '', trigger_event: 'booking_confirmed' });
    } catch {
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(journey) {
    setToggling(journey.id);
    try {
      const endpoint = journey.is_active
        ? `/communications/journeys/${journey.id}/deactivate/`
        : `/communications/journeys/${journey.id}/activate/`;
      await api.post(endpoint);
      // Backend returns {status: 'activated'/'deactivated'} — derive is_active from endpoint used
      const nowActive = !journey.is_active;
      setJourneys(prev => prev.map(j => j.id === journey.id ? { ...j, is_active: nowActive } : j));
    } catch {
    } finally {
      setToggling(null);
    }
  }

  return (
    <div>
      {selectedId && (
        <JourneyStepsPanel journeyId={selectedId} onClose={() => setSelectedId(null)} />
      )}

      <SectionHeader
        title="Automation Journeys"
        action={
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ New Journey'}
          </button>
        }
      />

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-header-title">New Journey</div></div>
          <div className="card-body">
            <form onSubmit={handleCreate}>
              <div className="row g-3">
                <div className="col-6">
                  <label className="form-label">Journey Name</label>
                  <input
                    className="form-control"
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Post-Checkout Follow-up"
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">Trigger Event</label>
                  <select
                    className="form-select"
                    value={form.trigger_event}
                    onChange={e => setForm(f => ({ ...f, trigger_event: e.target.value }))}
                  >
                    {Object.entries(TRIGGER_LABELS).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label">Description <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.4)' }}>(optional)</span></label>
                  <input
                    className="form-control"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="col-12">
                  <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? 'Creating…' : 'Create Journey'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow cols={5} />}
              {!loading && journeys.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState icon="send" title="No journeys yet" subtitle="Create an automation journey to send timed, multi-channel messages." />
                  </td>
                </tr>
              )}
              {!loading && journeys.map(j => (
                <tr key={j.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.name}</div>
                    {j.description && (
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{j.description}</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                    {TRIGGER_LABELS[j.trigger_event] || j.trigger_event}
                  </td>
                  <td>
                    <StatusBadge status={j.is_active ? 'active' : 'inactive'} label={j.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)' }}>{fmtDate(j.created_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedId(j.id)}
                      >
                        Steps
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={toggling === j.id}
                        onClick={() => toggleActive(j)}
                        style={{ color: j.is_active ? '#8a1a1a' : '#1a7040' }}
                      >
                        {toggling === j.id ? '…' : j.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Segments ──────────────────────────────────────────────────────────

function SegmentsTab() {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ name: '', description: '', filter_params: '{}' });
  const [jsonError, setJsonError] = useState('');

  useEffect(() => {
    api.get('/segments/')
      .then(r => setSegments(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function validateJson(val) {
    try { JSON.parse(val); setJsonError(''); } catch { setJsonError('Invalid JSON'); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (jsonError) return;
    setSaving(true);
    try {
      const payload = { ...form, filter_params: JSON.parse(form.filter_params) };
      const { data } = await api.post('/segments/', payload);
      setSegments(prev => [data, ...prev]);
      setShowForm(false);
      setForm({ name: '', description: '', filter_params: '{}' });
    } catch {
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Audience Segments"
        action={
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ New Segment'}
          </button>
        }
      />

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-header-title">New Segment</div></div>
          <div className="card-body">
            <form onSubmit={handleCreate}>
              <div className="row g-3">
                <div className="col-6">
                  <label className="form-label">Segment Name</label>
                  <input
                    className="form-control"
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Annual Berth Holders"
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">Description</label>
                  <input
                    className="form-control"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="col-12">
                  <label className="form-label">
                    Filter Rules <span style={{ fontWeight: 400, fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>(JSON)</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows={4}
                    value={form.filter_params}
                    onChange={e => { setForm(f => ({ ...f, filter_params: e.target.value })); validateJson(e.target.value); }}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                  {jsonError && <div style={{ color: '#c0392b', fontSize: 11, marginTop: 4 }}>{jsonError}</div>}
                </div>
                <div className="col-12">
                  <button className="btn btn-primary" type="submit" disabled={saving || !!jsonError}>
                    {saving ? 'Saving…' : 'Create Segment'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Member Count</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow cols={4} />}
              {!loading && segments.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState icon="users" title="No segments yet" subtitle="Create audience segments to target specific groups of members." />
                  </td>
                </tr>
              )}
              {!loading && segments.map(seg => (
                <tr key={seg.id}>
                  <td style={{ fontWeight: 600 }}>{seg.name}</td>
                  <td style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13 }}>{seg.description || '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {seg.count != null ? seg.count.toLocaleString() : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)' }}>{fmtDate(seg.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Delivery Log ──────────────────────────────────────────────────────

const DIRECTION_LABELS = { outbound: 'Outbound', inbound: 'Inbound' };

function DeliveryLogTab() {
  const [sends, setSends]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter]   = useState('');
  const [page, setPage]               = useState(1);
  const [totalCount, setTotalCount]   = useState(0);
  const PAGE_SIZE = 25;

  const fetchSends = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, page_size: PAGE_SIZE });
    if (channelFilter) params.set('channel', channelFilter);
    if (statusFilter)  params.set('status', statusFilter);
    api.get(`/communications/messages/?${params}`)
      .then(r => {
        const data = r.data;
        setSends(data.results ?? data);
        setTotalCount(data.count ?? (data.results ?? data).length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [channelFilter, statusFilter, page]);

  useEffect(() => { fetchSends(); }, [fetchSends]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [channelFilter, statusFilter]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div>
      <SectionHeader title="Delivery Log" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Channel</label>
            <select
              className="form-select form-select-sm"
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value)}
              style={{ minWidth: 130 }}
            >
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</label>
            <select
              className="form-select form-select-sm"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ minWidth: 130 }}
            >
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="opened">Read / Opened</option>
              <option value="failed">Failed</option>
              <option value="received">Received (inbound)</option>
            </select>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchSends} style={{ alignSelf: 'flex-end' }}>
            Refresh
          </button>
          {(channelFilter || statusFilter) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setChannelFilter(''); setStatusFilter(''); }}
              style={{ alignSelf: 'flex-end', color: 'rgba(0,0,0,0.45)' }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Direction</th>
                <th>Recipient</th>
                <th>Subject / Body</th>
                <th>Status</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow cols={6} />}
              {!loading && sends.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon="message-square"
                      title="No messages found"
                      subtitle={channelFilter || statusFilter ? 'Try adjusting your filters.' : 'No messages have been sent yet.'}
                    />
                  </td>
                </tr>
              )}
              {!loading && sends.map(s => (
                <tr key={s.id}>
                  <td>
                    <StatusBadge
                      status={s.channel}
                      label={<><Ic n={CHANNEL_ICONS[s.channel]} s={13}/> {CHANNEL_LABELS[s.channel] || s.channel}</>}
                    />
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                    {DIRECTION_LABELS[s.direction] || s.direction}
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.recipient}
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', maxWidth: 240 }}>
                    {s.subject ? (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.subject}
                      </div>
                    ) : (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                        {s.body ? s.body.slice(0, 80) + (s.body.length > 80 ? '…' : '') : '—'}
                      </div>
                    )}
                  </td>
                  <td><StatusBadge status={s.status} /></td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)', whiteSpace: 'nowrap' }}>
                    {fmtDate(s.sent_at || s.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{
            padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 12, color: 'rgba(0,0,0,0.45)',
          }}>
            <span>Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Prev
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Broadcasts Tab ────────────────────────────────────────────────────────

function BroadcastsTab() {
  const [view, setView] = useState('list'); // list | compose | detail
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/communications/broadcasts/');
      setItems(Array.isArray(r.data) ? r.data : (r.data.results || []));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (view === 'compose') {
    return <BroadcastComposer
      onCancel={() => setView('list')}
      onSent={(b) => { setSelected(b.id); setView('detail'); refresh(); }}
    />;
  }
  if (view === 'detail' && selected) {
    return <BroadcastDetail
      broadcastId={selected}
      onBack={() => { setView('list'); setSelected(null); refresh(); }}
    />;
  }

  return (
    <div>
      <SectionHeader
        title="Broadcasts"
        action={
          <button className="btn btn-primary btn-sm" onClick={() => setView('compose')}>
            <Ic n="plus" s={13}/> New broadcast
          </button>
        }
      />
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Cohort</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow cols={5}/>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5}>
                  <EmptyState icon="send" title="No broadcasts yet"
                    subtitle='Click "New broadcast" to compose your first message.'/>
                </td></tr>
              )}
              {!loading && items.map(b => (
                <tr key={b.id} style={{ cursor: 'pointer' }}
                    onClick={() => { setSelected(b.id); setView('detail'); }}>
                  <td>{b.title}</td>
                  <td><StatusBadge status={b.channel} label={CHANNEL_LABELS[b.channel] || b.channel}/></td>
                  <td><StatusBadge status={b.status} label={b.status}/></td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
                    {b.previewed_count != null ? `${b.previewed_count} recipients` : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                    {b.sent_at ? new Date(b.sent_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BroadcastComposer({ onCancel, onSent }) {
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('sms');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // Cohort builder — v1 supports the locked clauses only.
  const [cohortKind, setCohortKind] = useState('everyone_active_in_marina'); // | reservation_status | pier_in
  const [reservationStatuses, setReservationStatuses] = useState(['checked_in']);
  const [piers, setPiers] = useState(''); // comma separated
  const [excludeOptedOut, setExcludeOptedOut] = useState(true);
  const [broadcast, setBroadcast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [drift, setDrift] = useState(null);
  const [busy, setBusy] = useState(false);

  function buildFilter() {
    const all_of = [];
    if (cohortKind === 'everyone_active_in_marina') {
      all_of.push({ everyone_active_in_marina: true });
    } else if (cohortKind === 'reservation_status') {
      all_of.push({ reservation_status: reservationStatuses });
    } else if (cohortKind === 'pier_in') {
      const list = piers.split(',').map(s => s.trim()).filter(Boolean);
      all_of.push({ pier_in: list });
    }
    const filter = { all_of };
    if (excludeOptedOut) filter.exclude = [{ sms_opted_out: true }];
    return filter;
  }

  async function runPreview() {
    setError(''); setBusy(true); setDrift(null);
    try {
      const payload = {
        title: title || '(untitled broadcast)',
        channel, subject, body,
        cohort_filter: buildFilter(),
      };
      let b = broadcast;
      if (!b) {
        const r = await api.post('/communications/broadcasts/', payload);
        b = r.data;
        setBroadcast(b);
      } else {
        const r = await api.patch(`/communications/broadcasts/${b.id}/`, payload);
        b = r.data;
        setBroadcast(b);
      }
      const pr = await api.post(`/communications/broadcasts/${b.id}/preview/`);
      setPreview(pr.data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doSend() {
    setError(''); setDrift(null); setBusy(true);
    try {
      const r = await api.post(`/communications/broadcasts/${broadcast.id}/send/`);
      setConfirmOpen(false);
      onSent(broadcast);
    } catch (e) {
      if (e.response?.status === 409) {
        setDrift(e.response.data);
      } else {
        setError(e.response?.data?.detail || e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader title="Compose Broadcast" action={
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      }/>
      <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <label>Title
          <input className="form-control" value={title} onChange={e => setTitle(e.target.value)}/>
        </label>
        <div style={{ display: 'flex', gap: 12 }}>
          <label>Channel
            <select className="form-control" value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label style={{ flex: 1 }}>Cohort
            <select className="form-control" value={cohortKind} onChange={e => setCohortKind(e.target.value)}>
              <option value="everyone_active_in_marina">Everyone active (≤12 mo)</option>
              <option value="reservation_status">By reservation status (today)</option>
              <option value="pier_in">By pier</option>
            </select>
          </label>
        </div>
        {cohortKind === 'reservation_status' && (
          <label>Statuses (comma-separated, e.g. checked_in, confirmed)
            <input className="form-control"
              value={reservationStatuses.join(',')}
              onChange={e => setReservationStatuses(e.target.value.split(',').map(s => s.trim()))}/>
          </label>
        )}
        {cohortKind === 'pier_in' && (
          <label>Pier labels (comma-separated, e.g. C,D)
            <input className="form-control" value={piers} onChange={e => setPiers(e.target.value)}/>
          </label>
        )}
        <label>
          <input type="checkbox" checked={excludeOptedOut}
            onChange={e => setExcludeOptedOut(e.target.checked)}/>
          {' '}Exclude opted-out members
        </label>
        {channel === 'email' && (
          <label>Subject
            <input className="form-control" value={subject} onChange={e => setSubject(e.target.value)}/>
          </label>
        )}
        <label>Body
          <textarea className="form-control" rows={5} value={body} onChange={e => setBody(e.target.value)}/>
        </label>
        {channel === 'sms' && (
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
            Outbound bodies are automatically prefixed with <code>[Marina Name] </code>.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" disabled={busy} onClick={runPreview}>
            {broadcast ? 'Refresh preview' : 'Preview'}
          </button>
          {preview && (
            <button className="btn btn-primary" disabled={busy}
              onClick={() => setConfirmOpen(true)}>
              Send to {preview.count} recipient{preview.count === 1 ? '' : 's'}
              {preview.cost_cents ? ` ($${(preview.cost_cents / 10000).toFixed(2)})` : ''}
            </button>
          )}
        </div>
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        {preview && (
          <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.02)' }}>
            <div style={{ fontWeight: 600 }}>Preview</div>
            <div>Cohort size: {preview.count}</div>
            <div>Estimated cost: ${(preview.cost_cents / 10000).toFixed(2)}</div>
          </div>
        )}
      </div>

      {confirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ padding: 24, maxWidth: 480 }}>
            <h3>Send broadcast?</h3>
            <p>This will deliver to <b>{preview.count}</b> recipients
               (~${(preview.cost_cents / 10000).toFixed(2)}).</p>
            {drift && (
              <div style={{ color: 'crimson', marginBottom: 12 }}>
                {drift.detail}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setConfirmOpen(false); setDrift(null); }}>
                Cancel
              </button>
              {drift ? (
                <button className="btn btn-secondary" disabled={busy} onClick={runPreview}>
                  Refresh preview
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busy} onClick={doSend}>
                  Send now
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BroadcastDetail({ broadcastId, onBack }) {
  const [b, setB] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.get(`/communications/broadcasts/${broadcastId}/`);
        setB(r.data);
        const d = await api.get(`/communications/broadcasts/${broadcastId}/deliveries/`);
        setDeliveries(Array.isArray(d.data) ? d.data : (d.data.results || []));
      } finally {
        setLoading(false);
      }
    })();
  }, [broadcastId]);

  if (loading || !b) return <div className="card" style={{ padding: 24 }}>Loading…</div>;

  const counts = deliveries.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1; return acc;
  }, {});

  return (
    <div>
      <SectionHeader title={`Broadcast: ${b.title}`} action={
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
      }/>
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div>Channel: <b>{b.channel}</b> · Status: <b>{b.status}</b></div>
        <div>Cohort size at preview: {b.previewed_count ?? '—'}</div>
        <div>Cost estimate: ${((b.cost_estimate_cents ?? 0) / 10000).toFixed(2)}</div>
        <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13 }}>{b.body}</div>
      </div>
      <div className="card">
        <div style={{ padding: '8px 16px', fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>
          {Object.entries(counts).map(([k, v]) => (
            <span key={k} style={{ marginRight: 12 }}>{k}: <b>{v}</b></span>
          ))}
        </div>
        <table className="tbl">
          <thead><tr><th>Address</th><th>Status</th><th>Failed reason</th></tr></thead>
          <tbody>
            {deliveries.length === 0 && (
              <tr><td colSpan={3}>
                <EmptyState icon="inbox" title="No deliveries yet"/>
              </td></tr>
            )}
            {deliveries.map(r => (
              <tr key={r.id}>
                <td>{r.address}</td>
                <td><StatusBadge status={r.status} label={r.status}/></td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>{r.failed_reason || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'templates',    label: 'Templates' },
  { id: 'journeys',     label: 'Journeys' },
  { id: 'segments',     label: 'Segments' },
  { id: 'broadcasts',   label: 'Broadcasts' },
  { id: 'delivery-log', label: 'Delivery Log' },
];

export default function Communications() {
  const [activeTab, setActiveTab] = useState('templates');

  return (
    <div className="container-xl" style={{ paddingTop: 24, paddingBottom: 48 }}>
      {/* Page header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div className="row align-items-center">
          <div className="col-auto">
            <div className="page-title" style={{ display: 'flex', alignItems: 'center' }}>
              Communications
              <ScreenInfo title="Communications" body={SCREEN_INFO.communications} />
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '2px solid rgba(0,0,0,0.08)',
        marginBottom: 24, overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 20px', fontSize: 13, fontWeight: 600,
              color: activeTab === tab.id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
              borderBottom: activeTab === tab.id ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              marginBottom: -2, whiteSpace: 'nowrap', transition: 'color 0.12s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'templates'    && <TemplatesTab />}
      {activeTab === 'journeys'     && <JourneysTab />}
      {activeTab === 'segments'     && <SegmentsTab />}
      {activeTab === 'broadcasts'   && <BroadcastsTab />}
      {activeTab === 'delivery-log' && <DeliveryLogTab />}
    </div>
  );
}
