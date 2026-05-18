import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function PlanBadge({ plan }) {
  const colors = { starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-gold' };
  const labels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  return <span className={`badge ${colors[plan] || 'badge-gray'}`}>{labels[plan] || plan}</span>;
}

function StatusBadge({ status }) {
  const map = { active: 'badge-green', trial: 'badge-teal', suspended: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

function InfoField({ label, value, highlight, mono, dim }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, fontWeight: highlight ? 600 : 500,
        color: highlight ? 'rgba(0,0,0,0.88)' : dim ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.75)',
        fontFamily: mono ? 'monospace' : 'inherit',
        background: mono ? 'rgba(0,0,0,0.04)' : 'transparent',
        padding: mono ? '3px 7px' : 0,
        borderRadius: mono ? 4 : 0,
        display: 'inline-block',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

function SnapTile({ label, value, dim }) {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.025)', border: '1px solid rgba(0,0,0,0.06)',
      borderRadius: 8, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: dim ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.88)', marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
    </div>
  );
}

const FEATURE_GROUPS = [
  {
    group: 'Daily Operations',
    desc: 'Core navigation modules shown to marina staff',
    features: [
      { key: 'mod_overview',           label: 'Overview' },
      { key: 'mod_map',                label: 'Harbour Map' },
      { key: 'mod_reservations',       label: 'Reservations' },
      { key: 'mod_billing',            label: 'Billing & POS' },
      { key: 'mod_operations',         label: 'Operations' },
      { key: 'mod_berth_intelligence', label: 'Berth Intelligence' },
    ],
  },
  {
    group: 'Booking',
    desc: 'Booking behaviour and automation settings',
    features: [
      { key: 'booking_auto_tetris',    label: 'Auto-Tetris Assignment' },
      { key: 'guest_booking',          label: 'Guest / Online Booking' },
      { key: 'waiting_list',           label: 'Waiting List' },
      { key: 'booking_search',         label: 'Booking Search Bar' },
      { key: 'document_gate',          label: 'Document Gate' },
      { key: 'seasonal_approval',      label: 'Seasonal Approval' },
      { key: 'loa_enforcement',        label: 'LOA Enforcement' },
      { key: 'booking_cancellation',   label: 'Self-Service Cancellation' },
    ],
  },
  {
    group: 'Directory',
    desc: 'Member and vessel data management',
    features: [
      { key: 'mod_members',            label: 'Members' },
      { key: 'mod_vessels',            label: 'Vessels' },
      { key: 'mod_documents',          label: 'Documents & eSign' },
      { key: 'esign',                  label: 'DropboxSign Integration' },
      { key: 'digital_wallet',         label: 'Digital Wallet Pass' },
    ],
  },
  {
    group: 'Yard & Services',
    desc: 'On-site service modules',
    features: [
      { key: 'mod_boatyard',           label: 'Boatyard' },
      { key: 'mod_maintenance',        label: 'Maintenance' },
      { key: 'mod_activities',         label: 'Activities & Housekeeping' },
      { key: 'restaurant',             label: 'Restaurant' },
      { key: 'events',                 label: 'Events' },
      { key: 'utilities',              label: 'Utilities & Drystack' },
      { key: 'charter',                label: 'Charter & Harbour' },
      { key: 'fuel_dock',              label: 'Fuel Dock' },
    ],
  },
  {
    group: 'Management',
    desc: 'Administration and reporting tools',
    features: [
      { key: 'mod_staff',              label: 'Staff' },
      { key: 'mod_reports',            label: 'Reports' },
      { key: 'mod_accounting',         label: 'Accounting' },
      { key: 'mod_infrastructure',     label: 'Harbour Infrastructure' },
      { key: 'mod_channels',           label: 'OTA Channels' },
      { key: 'mod_communications',     label: 'Communications' },
      { key: 'mod_service_catalog',    label: 'Service Catalog' },
    ],
  },
  {
    group: 'Advanced Add-ons',
    desc: 'Premium features enabled per plan',
    features: [
      { key: 'revenue_intelligence',   label: 'Revenue Intelligence' },
      { key: 'loyalty',                label: 'Loyalty Programme' },
      { key: 'tenants',                label: 'Tenants & Marketplace' },
      { key: 'access_control',         label: 'Security & Access' },
      { key: 'esg_enabled',            label: 'Sustainability / ESG' },
      { key: 'mod_berth_sale',         label: 'Berth Sales' },
      { key: 'ota_sync',               label: 'OTA Sync' },
      { key: 'revenue_share',          label: 'Revenue Share' },
    ],
  },
];

function FeatureChip({ label, enabled, saving, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={saving}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 12px', borderRadius: 7, cursor: saving ? 'default' : 'pointer',
        fontSize: 12, fontWeight: 500, transition: 'all 0.12s',
        border: enabled ? 'none' : '1px solid rgba(0,0,0,0.12)',
        background: enabled ? '#0c1f3d' : '#fff',
        color: enabled ? '#fff' : 'rgba(0,0,0,0.5)',
        opacity: saving ? 0.6 : 1,
        boxShadow: enabled ? '0 1px 4px rgba(12,31,61,0.18)' : 'none',
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: enabled ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.18)',
        transition: 'background 0.12s',
      }} />
      {label}
    </button>
  );
}

export default function MarinaDetail({ marinaId, onBack }) {
  const [marina, setMarina] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [bypassReason, setBypassReason] = useState('');
  const [flagSaving, setFlagSaving] = useState({});
  const [auditLog, setAuditLog] = useState([]);

  function reloadAuditLog() {
    api.get('admin/audit-logs/', { params: { marina: marinaId } })
      .then(r => setAuditLog(r.data))
      .catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    api.get(`admin/marinas/${marinaId}/`)
      .then(r => setMarina(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    reloadAuditLog();
  }, [marinaId]);

  async function handleSuspend() {
    const reason = window.prompt('Reason for suspension:');
    if (reason === null) return;
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${marina.id}/suspend/`, { reason });
      setMarina(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleReinstate() {
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${marina.id}/reinstate/`);
      setMarina(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleConvert() {
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${marina.id}/convert/`);
      setMarina(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleImpersonate() {
    const hasConsent = marina.support_access_granted_until && new Date(marina.support_access_granted_until) > new Date();
    const body = {};
    if (!hasConsent) {
      if (!bypassReason.trim()) return;
      body.bypass_reason = bypassReason.trim();
    }
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${marina.id}/impersonate/`, body);
      const marinaUrl = import.meta.env.VITE_MARINA_URL || 'http://localhost:5173';
      window.open(`${marinaUrl}?sso_token=${data.access}`, '_blank');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Impersonation failed.');
    } finally { setActing(false); }
  }

  async function handleInviteStaff() {
    const email = window.prompt('Email address of the new user:');
    if (!email) return;
    const name = window.prompt('Name (optional):') || '';
    const role = window.prompt('Role (owner / manager / staff):', 'owner') || 'owner';
    setActing(true);
    try {
      await api.post(`admin/marinas/${marina.id}/invite-staff/`, {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        role: role.trim().toLowerCase(),
      });
      // Reload marina to pull updated staff list
      const { data } = await api.get(`admin/marinas/${marina.id}/`);
      setMarina(data);
      reloadAuditLog();
      window.alert(`Invite sent to ${email}.`);
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to invite user.');
    } finally { setActing(false); }
  }

  async function handleResetPassword(userId, email) {
    if (!window.confirm(`Send password reset email to ${email}?`)) return;
    try {
      await api.post(`admin/marinas/${marina.id}/reset-password/`, { user_id: userId });
      window.alert(`Reset email sent to ${email}.`);
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to send reset email.');
    }
  }

  async function toggleFeature(key, value) {
    setFlagSaving(s => ({ ...s, [key]: true }));
    const newFeatures = { ...(marina.features || {}), [key]: value };
    try {
      const { data } = await api.patch(`admin/marinas/${marina.id}/`, { features: newFeatures });
      setMarina(data);
      reloadAuditLog();
    } catch { /* ignore */ } finally {
      setFlagSaving(s => ({ ...s, [key]: false }));
    }
  }

  async function toggleGroup(groupFeatures, value) {
    const saving = {};
    groupFeatures.forEach(f => { saving[f.key] = true; });
    setFlagSaving(s => ({ ...s, ...saving }));
    const newFeatures = { ...(marina.features || {}) };
    groupFeatures.forEach(f => { newFeatures[f.key] = value; });
    try {
      const { data } = await api.patch(`admin/marinas/${marina.id}/`, { features: newFeatures });
      setMarina(data);
      reloadAuditLog();
    } catch { /* ignore */ } finally {
      const done = {};
      groupFeatures.forEach(f => { done[f.key] = false; });
      setFlagSaving(s => ({ ...s, ...done }));
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  if (!marina) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 8, color: 'rgba(0,0,0,0.35)' }}>
        <Ic n="anchor" s={28} c="rgba(0,0,0,0.15)" />
        <div style={{ fontSize: 12 }}>Marina not found.</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>Back to list</button>
      </div>
    );
  }

  const m = marina;
  const planLabel = { starter: 'Starter — €149/mo', professional: 'Professional — €349/mo', enterprise: 'Enterprise — €899/mo' };
  const consentExpiry = m.support_access_granted_until ? new Date(m.support_access_granted_until) : null;
  const hasConsent = consentExpiry && consentExpiry > new Date();
  const features = m.features || {};

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Back nav */}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onBack}
        style={{ marginBottom: 18, gap: 6 }}
      >
        <Ic n="arrow-left" s={12} /> All marinas
      </button>

      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3, marginBottom: 4 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 10 }}>{m.timezone}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={m.status} />
                <PlanBadge plan={m.plan} />
                {m.status === 'trial' && m.trial_ends && (
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Trial ends {m.trial_ends}</span>
                )}
              </div>
              {m.suspend_reason && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', background: '#fff0f0', padding: '4px 10px', borderRadius: 4, display: 'inline-block' }}>
                  {m.suspend_reason}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {m.status !== 'suspended' ? (
                <button type="button" className="btn btn-danger btn-sm" disabled={acting} onClick={handleSuspend}>
                  <Ic n="lock" s={12} /> Suspend
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" disabled={acting} onClick={handleReinstate}>
                  <Ic n="check" s={12} /> Reinstate
                </button>
              )}
              {m.status === 'trial' && (
                <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={handleConvert}>
                  <Ic n="tag" s={12} /> Convert to paid
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contact info */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-header-title">Contact Information</div>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <InfoField label="Marina name" value={m.name} />
            <InfoField label="Timezone" value={m.timezone} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <InfoField label="Email" value={m.contact_email} />
            <InfoField label="Phone" value={m.phone} />
          </div>
          <InfoField label="Address" value={m.address} />
        </div>
      </div>

      {/* Billing & subscription */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-header-title">Billing & Subscription</div>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <InfoField label="Plan" value={planLabel[m.plan] || m.plan} />
            <InfoField label="MRR" value={m.mrr > 0 ? `€${m.mrr}` : '—'} highlight />
            <InfoField label="Currency" value={m.currency || '—'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <InfoField label="Next renewal" value={m.next_renewal || '—'} />
            <InfoField label="Joined" value={new Date(m.created_at).toLocaleDateString()} />
          </div>
          {m.stripe_account_id && (
            <InfoField label="Stripe account" value={m.stripe_account_id} mono />
          )}
        </div>
      </div>

      {/* Operations snapshot */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-header-title">Operations</div>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <SnapTile label="Berths" value={m.total_berths ?? '—'} />
            <SnapTile label="Active bookings" value={m.active_bookings ?? '—'} />
            <SnapTile label="Staff users" value={m.user_count ?? m.staff?.length ?? '—'} />
            <SnapTile label="Marina ID" value={`#${m.id}`} dim />
          </div>
        </div>
      </div>

      {/* Feature groups */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.8)', marginBottom: 12 }}>
          Feature Modules
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {FEATURE_GROUPS.map(({ group, desc, features: groupFeatures }) => {
            const onCount = groupFeatures.filter(f => !!features[f.key]).length;
            const groupSaving = groupFeatures.some(f => flagSaving[f.key]);
            return (
            <div className="card" key={group}>
              <div className="card-header">
                <div>
                  <div className="card-header-title">{group}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>{desc}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', marginRight: 4 }}>
                    {onCount}/{groupFeatures.length} on
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={groupSaving || onCount === groupFeatures.length}
                    onClick={() => toggleGroup(groupFeatures, true)}
                    style={{ fontSize: 11, padding: '3px 9px' }}
                  >
                    All on
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={groupSaving || onCount === 0}
                    onClick={() => toggleGroup(groupFeatures, false)}
                    style={{ fontSize: 11, padding: '3px 9px' }}
                  >
                    All off
                  </button>
                </div>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {groupFeatures.map(({ key, label }) => (
                  <FeatureChip
                    key={key}
                    label={label}
                    enabled={!!features[key]}
                    saving={!!flagSaving[key]}
                    onToggle={() => toggleFeature(key, !features[key])}
                  />
                ))}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Staff users */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-header-title">Staff Users</div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={acting}
            onClick={handleInviteStaff}
            style={{ gap: 6 }}
          >
            <Ic n="plus" s={11} /> Invite user
          </button>
        </div>
        {(!m.staff || m.staff.length === 0) ? (
          <div style={{ padding: '16px 20px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            No staff yet — invite the first owner using the button above.
          </div>
        ) : (
          <div style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {m.staff.map(u => (
                  <tr key={u.id} style={{ cursor: 'default' }}>
                    <td className="tbl-name">{u.name}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{u.email}</td>
                    <td><span className="badge badge-gray">{u.role}</span></td>
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleResetPassword(u.id, u.email)}
                      >
                        Reset password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent changes (audit log) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-header-title">Recent Changes</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reloadAuditLog} style={{ fontSize: 11, padding: '3px 9px' }}>
            Refresh
          </button>
        </div>
        {auditLog.length === 0 ? (
          <div style={{ padding: '16px 20px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            No recorded changes for this marina yet.
          </div>
        ) : (
          <div style={{ padding: '6px 0', maxHeight: 320, overflowY: 'auto' }}>
            {auditLog.slice(0, 50).map(log => (
              <div key={log.id} style={{ padding: '8px 18px', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'rgba(0,0,0,0.85)' }}>
                    <strong>{log.admin_user_email || 'system'}</strong>
                    {' '}
                    <span style={{ color: 'rgba(0,0,0,0.55)' }}>{log.action}</span>
                    {log.action === 'toggle_feature_flag' && log.detail?.flag && (
                      <span>
                        {' — '}
                        <code style={{ background: 'rgba(0,0,0,0.04)', padding: '1px 4px', borderRadius: 3 }}>{log.detail.flag}</code>
                        {': '}
                        <span style={{ color: 'rgba(0,0,0,0.5)' }}>{String(log.detail.before)}</span>
                        {' → '}
                        <span style={{ fontWeight: 600 }}>{String(log.detail.after)}</span>
                      </span>
                    )}
                    {log.detail?.reason && (
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                        Reason: {log.detail.reason}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Support access */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div className="card-header">
          <div className="card-header-title">Support Access</div>
        </div>
        <div className="card-body">
          {hasConsent ? (
            <div>
              <div style={{ fontSize: 12, color: 'var(--green, #1a7a2c)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ic n="check" s={12} />
                Consent granted until {consentExpiry.toLocaleString()}
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={handleImpersonate} style={{ gap: 8 }}>
                <Ic n="log-in" s={12} /> Open support session
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 12 }}>
                No active consent from this marina. Provide a break-glass reason to override.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Override reason (required)"
                  value={bypassReason}
                  onChange={e => setBypassReason(e.target.value)}
                  style={{ fontSize: 12, width: 280 }}
                />
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={acting || !bypassReason.trim()}
                  onClick={handleImpersonate}
                  style={{ gap: 8 }}
                >
                  <Ic n="alert-tri" s={12} /> Break-glass access
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
