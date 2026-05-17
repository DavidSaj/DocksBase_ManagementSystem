import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import MetersTab from './utilities/MetersTab.jsx';
import { Badge, Spinner, EmptyState, ErrorMsg, SuccessMsg } from './utilities/_shared.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ── Bollard status helpers ─────────────────────────────────────────────────

function bollardStatusColor(status) {
  switch (status) {
    case 'active':    return 'success';
    case 'fault':     return 'danger';
    case 'suspended': return 'warning';
    case 'offline':   return 'secondary';
    default:          return 'secondary';
  }
}

function bollardStatusLabel(status) {
  switch (status) {
    case 'active':    return 'Active';
    case 'fault':     return 'Fault';
    case 'suspended': return 'Suspended';
    case 'offline':   return 'Offline';
    default:          return status;
  }
}

// ── Fault Log Drawer ───────────────────────────────────────────────────────

function FaultLogDrawer({ bollard, onClose }) {
  const [faults, setFaults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fault_type: 'supply_failure', description: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get(`/utilities/bollards/${bollard.id}/fault-logs/`)
      .then(r => setFaults(r.data.results ?? r.data))
      .catch(() => setFaults([]))
      .finally(() => setLoading(false));
  }, [bollard.id]);

  async function logFault(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const { data } = await api.post(`/utilities/bollards/${bollard.id}/fault-logs/`, form);
      setFaults(prev => [data, ...prev]);
      setForm({ fault_type: 'supply_failure', description: '' });
    } catch {
      setErr('Failed to log fault. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const faultTypeLabels = {
    supply_failure: 'Supply Failure',
    overcurrent_trip: 'Overcurrent Trip',
    comms_error: 'Communications Error',
    other: 'Other',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: 440, background: '#fff', height: '100%', overflowY: 'auto',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 14px', borderBottom: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Fault Log — {bollard.label}</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>Berth: {bollard.berth_code || 'Unassigned'}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.4)', padding: 4 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '16px 20px', borderBottom: 'var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Log New Fault
          </div>
          <ErrorMsg msg={err} />
          <form onSubmit={logFault} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Fault Type</label>
              <select
                value={form.fault_type}
                onChange={e => setForm(f => ({ ...f, fault_type: e.target.value }))}
                style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}
              >
                {Object.entries(faultTypeLabels).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional — describe the fault…"
                rows={2}
                style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start', background: 'var(--navy)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 5, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 12 }}
              disabled={saving}
            >
              {saving ? 'Logging…' : 'Log Fault'}
            </button>
          </form>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Fault History
          </div>
          {loading ? <Spinner /> : faults.length === 0 ? (
            <EmptyState icon="✓" message="No faults logged for this bollard." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {faults.map(f => (
                <div key={f.id} style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--bg)', border: 'var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{faultTypeLabels[f.fault_type] || f.fault_type}</span>
                    {f.resolved_at
                      ? <Badge color="success">Resolved</Badge>
                      : <Badge color="danger">Open</Badge>}
                  </div>
                  {f.description && (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 4 }}>{f.description}</div>
                  )}
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
                    {new Date(f.reported_at).toLocaleString()}
                    {f.resolved_at && ` → Resolved ${new Date(f.resolved_at).toLocaleString()}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bollards Tab ───────────────────────────────────────────────────────────

function BollardsTab() {
  const [bollards, setBollards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(null);
  const [faultDrawer, setFaultDrawer] = useState(null);
  const [err, setErr] = useState('');
  const [switchMsg, setSwitchMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/bollards/')
      .then(r => setBollards(r.data.results ?? r.data))
      .catch(() => setBollards([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function doSwitch(bollard, action) {
    setSwitching(bollard.id);
    setErr('');
    setSwitchMsg('');
    try {
      await api.post(`/utilities/bollards/${bollard.id}/switch/`, {
        action,
        reason: `Manual ${action === 'on' ? 'power on' : 'power off'} by staff`,
      });
      setSwitchMsg(`Bollard ${bollard.label} switched ${action.toUpperCase()} successfully.`);
      load();
    } catch {
      setErr(`Failed to switch bollard ${bollard.label}. Check vendor connectivity.`);
    } finally {
      setSwitching(null);
      setTimeout(() => { setSwitchMsg(''); setErr(''); }, 4000);
    }
  }

  return (
    <div>
      <ErrorMsg msg={err} />
      <SuccessMsg msg={switchMsg} />

      {loading ? <Spinner /> : bollards.length === 0 ? (
        <EmptyState icon="⚡" message="No service bollards registered. Add bollards via the admin panel or contact support." />
      ) : (
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Service Bollards</div>
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{bollards.length} bollard{bollards.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Berth</th>
                  <th>Capacity</th>
                  <th>Vendor</th>
                  <th>Status</th>
                  <th>Remote</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bollards.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{b.label}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{b.berth_code || '—'}</td>
                    <td style={{ fontSize: 12 }}>{b.max_amps}A / {b.voltage}V</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{b.vendor || '—'}</td>
                    <td><Badge color={bollardStatusColor(b.status)}>{bollardStatusLabel(b.status)}</Badge></td>
                    <td>
                      {b.has_remote_switch
                        ? <Badge color="info">Remote</Badge>
                        : <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>Manual</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {b.has_remote_switch && (
                          <>
                            <button
                              className="btn btn-sm"
                              style={{ fontSize: 11, padding: '3px 10px', background: 'rgba(47,179,135,0.1)', color: '#1a9c6e', border: '1px solid rgba(47,179,135,0.25)', borderRadius: 5, cursor: switching === b.id ? 'not-allowed' : 'pointer' }}
                              onClick={() => doSwitch(b, 'on')}
                              disabled={switching === b.id}
                            >
                              On
                            </button>
                            <button
                              className="btn btn-sm"
                              style={{ fontSize: 11, padding: '3px 10px', background: 'rgba(214,57,57,0.08)', color: '#c0392b', border: '1px solid rgba(214,57,57,0.2)', borderRadius: 5, cursor: switching === b.id ? 'not-allowed' : 'pointer' }}
                              onClick={() => doSwitch(b, 'off')}
                              disabled={switching === b.id}
                            >
                              Off
                            </button>
                          </>
                        )}
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '3px 10px' }}
                          onClick={() => setFaultDrawer(b)}
                        >
                          Fault Log
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {faultDrawer && (
        <FaultLogDrawer bollard={faultDrawer} onClose={() => setFaultDrawer(null)} />
      )}
    </div>
  );
}

// ── Wash Token helpers ─────────────────────────────────────────────────────

function tokenStatusColor(status) {
  switch (status) {
    case 'issued':   return 'info';
    case 'redeemed': return 'success';
    case 'expired':  return 'secondary';
    case 'voided':   return 'danger';
    default:         return 'secondary';
  }
}

// ── Redeem Modal ───────────────────────────────────────────────────────────

function RedeemModal({ onClose, onRedeemed }) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setSaving(true);
    setErr('');
    try {
      await api.post('/utilities/wash-tokens/redeem/', { token_code: code.trim().toUpperCase() });
      onRedeemed();
      onClose();
    } catch (ex) {
      const detail = ex?.response?.data?.detail || ex?.response?.data?.error || 'Redemption failed. Check the code and try again.';
      setErr(detail);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: '28px 28px 24px', width: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Redeem Wash Token</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 18 }}>
          Enter the 6-character PIN from the receipt or SMS.
        </div>
        <ErrorMsg msg={err} />
        <form onSubmit={submit}>
          <input
            autoFocus
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            maxLength={20}
            placeholder="e.g. A3F7K2"
            style={{
              width: '100%', boxSizing: 'border-box', fontSize: 22, fontWeight: 700, letterSpacing: 4,
              textAlign: 'center', padding: '12px 14px', borderRadius: 7,
              border: '1.5px solid rgba(0,0,0,0.18)', marginBottom: 16,
            }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'var(--border)', background: 'var(--bg)', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !code.trim()}
              style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}
            >
              {saving ? 'Redeeming…' : 'Redeem'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Issue Token Modal ──────────────────────────────────────────────────────

function IssueTokenModal({ onClose, onIssued }) {
  const [form, setForm] = useState({ facility: 'shower', member: '', quantity: 1 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const qty = Math.max(1, Math.min(20, parseInt(form.quantity, 10) || 1));
      const payload = {
        facility: form.facility,
        ...(form.member.trim() ? { member_search: form.member.trim() } : {}),
        quantity: qty,
      };
      await api.post('/utilities/wash-tokens/', payload);
      onIssued();
      onClose();
    } catch (ex) {
      const detail = ex?.response?.data?.detail || 'Failed to issue token(s). Please try again.';
      setErr(typeof detail === 'string' ? detail : JSON.stringify(detail));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: '28px 28px 24px', width: 380,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 18 }}>Issue Wash Token</div>
        <ErrorMsg msg={err} />
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Facility</label>
            <select
              value={form.facility}
              onChange={e => setForm(f => ({ ...f, facility: e.target.value }))}
              style={{ width: '100%', fontSize: 13, padding: '7px 9px', borderRadius: 5, border: 'var(--border)' }}
            >
              <option value="shower">Shower</option>
              <option value="laundry">Laundry</option>
              <option value="carwash">Car Wash</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Member (optional)</label>
            <input
              type="text"
              value={form.member}
              onChange={e => setForm(f => ({ ...f, member: e.target.value }))}
              placeholder="Name or email — leave blank for walk-in"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 9px', borderRadius: 5, border: 'var(--border)' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Quantity</label>
            <input
              type="number"
              min={1}
              max={20}
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 9px', borderRadius: 5, border: 'var(--border)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'var(--border)', background: 'var(--bg)', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}
            >
              {saving ? 'Issuing…' : 'Issue Token'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Wash Tokens Tab ────────────────────────────────────────────────────────

function WashTokensTab() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [facilityFilter, setFacilityFilter] = useState('');
  const [showRedeem, setShowRedeem] = useState(false);
  const [showIssue, setShowIssue] = useState(false);

  const facilityLabel = { shower: 'Shower', laundry: 'Laundry', carwash: 'Car Wash' };

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (facilityFilter) params.set('facility', facilityFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    api.get(`/utilities/wash-tokens/${qs}`)
      .then(r => setTokens(r.data.results ?? r.data))
      .catch(() => setTokens([]))
      .finally(() => setLoading(false));
  }, [statusFilter, facilityFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ fontSize: 12, padding: '5px 9px', borderRadius: 5, border: 'var(--border)' }}
        >
          <option value="">All statuses</option>
          <option value="issued">Issued</option>
          <option value="redeemed">Redeemed</option>
          <option value="expired">Expired</option>
          <option value="voided">Voided</option>
        </select>
        <select
          value={facilityFilter}
          onChange={e => setFacilityFilter(e.target.value)}
          style={{ fontSize: 12, padding: '5px 9px', borderRadius: 5, border: 'var(--border)' }}
        >
          <option value="">All facilities</option>
          <option value="shower">Shower</option>
          <option value="laundry">Laundry</option>
          <option value="carwash">Car Wash</option>
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 12 }}
            onClick={() => setShowRedeem(true)}
          >
            Redeem Token
          </button>
          <button
            className="btn btn-sm"
            style={{ fontSize: 12, background: 'var(--navy)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 5, cursor: 'pointer' }}
            onClick={() => setShowIssue(true)}
          >
            + Issue Token
          </button>
        </div>
      </div>

      {loading ? <Spinner /> : tokens.length === 0 ? (
        <EmptyState icon="🏷" message="No wash tokens match the current filters." />
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Facility</th>
                  <th>Member</th>
                  <th>Status</th>
                  <th>Issued</th>
                  <th>Expires</th>
                  <th>Redeemed</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 13, letterSpacing: 1 }}>{t.token_code}</td>
                    <td>{facilityLabel[t.facility] || t.facility}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{t.member_name || <span style={{ color: 'rgba(0,0,0,0.3)' }}>Walk-in</span>}</td>
                    <td><Badge color={tokenStatusColor(t.status)}>{t.status.charAt(0).toUpperCase() + t.status.slice(1)}</Badge></td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{new Date(t.issued_at).toLocaleDateString()}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                      {t.expires_at ? new Date(t.expires_at).toLocaleString() : <span style={{ color: 'rgba(0,0,0,0.3)' }}>Single-use</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                      {t.redeemed_at ? new Date(t.redeemed_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showRedeem && <RedeemModal onClose={() => setShowRedeem(false)} onRedeemed={load} />}
      {showIssue && <IssueTokenModal onClose={() => setShowIssue(false)} onIssued={load} />}
    </div>
  );
}

// ── OFGEM Reports Tab ──────────────────────────────────────────────────────

function OFGEMReportsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  async function generate(e) {
    e.preventDefault();
    if (!from || !to) return;
    if (from > to) { setErr('Start date must be before end date.'); return; }
    setGenerating(true);
    setErr('');
    setSuccess('');
    try {
      const response = await api.get(`/utilities/ofgem-report/?from=${from}&to=${to}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `ofgem-report-${from}-to-${to}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setSuccess(`Report downloaded: ofgem-report-${from}-to-${to}.csv`);
    } catch {
      setErr('Failed to generate report. Ensure meter readings exist for the selected period.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">OFGEM Compliance Report</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6 }}>
            Generates a standardised half-hourly aggregated CSV containing metering device identifiers,
            berth references, period start/end times, and total consumption per period. Required for
            OFGEM regulatory reporting.
          </div>

          <ErrorMsg msg={err} />
          <SuccessMsg msg={success} />

          <form onSubmit={generate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 5 }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  max={to || today}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 9px', borderRadius: 5, border: 'var(--border)' }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 5 }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  min={from}
                  max={today}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 9px', borderRadius: 5, border: 'var(--border)' }}
                  required
                />
              </div>
            </div>

            <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 7, border: 'var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>Report will include</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.9 }}>
                <li>Metering device identifier (Device ID)</li>
                <li>Berth reference (Berth code)</li>
                <li>Period start and end timestamps (half-hourly)</li>
                <li>Total consumption (kWh or m³ per period)</li>
                <li>Unit of measure</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={generating}
              style={{
                alignSelf: 'flex-start', padding: '9px 20px', borderRadius: 6, border: 'none',
                background: generating ? 'rgba(26,45,74,0.4)' : 'var(--navy)', color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {generating ? 'Generating…' : 'Generate & Download CSV'}
            </button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-header-title">About OFGEM Reporting</div>
        </div>
        <div className="card-body" style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 8px' }}>
            OFGEM (Office of Gas and Electricity Markets) requires energy suppliers and large site
            operators to report half-hourly consumption data for metered connections above the
            reporting threshold.
          </p>
          <p style={{ margin: 0 }}>
            Reports are generated from smart meter readings automatically ingested via the Rolec or
            MarineSync vendor integration. Manual readings entered via the Utility Meters tab in
            Billing are also included. Contact support if readings appear incomplete.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'meters',       label: 'Meters' },
  { id: 'bollards',     label: 'Bollards' },
  { id: 'wash-tokens',  label: 'Wash Tokens' },
  { id: 'ofgem',        label: 'OFGEM Reports' },
];

export default function Utilities() {
  const [tab, setTab] = useState('meters');

  return (
    <div>
      <PageHeader
        title="Utilities & Drystack"
        subtitle="Service bollards, wash-token dispensers, and OFGEM compliance reporting."
        infoBody={SCREEN_INFO.utilities}
      />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid rgba(0,0,0,0.08)', marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '9px 18px', fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              border: 'none', background: 'none', cursor: 'pointer',
              color: tab === t.id ? 'var(--navy)' : 'rgba(0,0,0,0.45)',
              borderBottom: tab === t.id ? '2px solid var(--navy)' : '2px solid transparent',
              marginBottom: -2, transition: 'color 0.12s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'meters'      && <MetersTab />}
      {tab === 'bollards'    && <BollardsTab />}
      {tab === 'wash-tokens' && <WashTokensTab />}
      {tab === 'ofgem'       && <OFGEMReportsTab />}
    </div>
  );
}
