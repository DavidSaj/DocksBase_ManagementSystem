import { useState, useEffect, useCallback } from 'react';
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

function DetailPanel({ marina, onClose, onUpdate }) {
  const [acting, setActing]         = useState(false);
  const [detail, setDetail]         = useState(null);
  const [bypassReason, setBypassReason] = useState('');

  useEffect(() => {
    if (!marina) { setDetail(null); return; }
    api.get(`admin/marinas/${marina.id}/`)
      .then(r => setDetail(r.data))
      .catch(() => setDetail(marina)); // fall back to list data
  }, [marina?.id]);

  if (!marina) return (
    <div className="detail-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(0,0,0,0.28)', gap: 8 }}>
      <Ic n="anchor" s={28} c="rgba(0,0,0,0.15)" />
      <div style={{ fontSize: 12 }}>Select a marina to view details</div>
    </div>
  );

  const m = detail || marina;
  const planLabel = { starter: 'Starter — €149/mo', professional: 'Professional — €349/mo', enterprise: 'Enterprise — €899/mo' };

  async function handleSuspend() {
    const reason = window.prompt('Reason for suspension:');
    if (reason === null) return;
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${m.id}/suspend/`, { reason });
      setDetail(data);
      onUpdate(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleReinstate() {
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${m.id}/reinstate/`);
      setDetail(data);
      onUpdate(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleConvert() {
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${m.id}/convert/`);
      setDetail(data);
      onUpdate(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleImpersonate() {
    const hasConsent = m.support_access_granted_until && new Date(m.support_access_granted_until) > new Date();
    const body = {};
    if (!hasConsent) {
      if (!bypassReason.trim()) return;
      body.bypass_reason = bypassReason.trim();
    }
    setActing(true);
    try {
      const { data } = await api.post(`admin/marinas/${m.id}/impersonate/`, body);
      // Store impersonation token so the marina frontend can pick it up
      const adminUrl = import.meta.env.VITE_MARINA_URL || 'http://localhost:5173';
      const params = new URLSearchParams({ impersonate_token: data.access, marina: m.slug || m.id });
      window.open(`${adminUrl}?${params.toString()}`, '_blank');
    } catch (e) {
      const msg = e.response?.data?.detail || 'Impersonation failed.';
      window.alert(msg);
    } finally { setActing(false); }
  }

  const consentExpiry = m.support_access_granted_until ? new Date(m.support_access_granted_until) : null;
  const hasConsent = consentExpiry && consentExpiry > new Date();

  return (
    <div className="detail-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="detail-panel-title">{m.name}</div>
          <div className="detail-panel-sub">{m.timezone}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
          <Ic n="x" s={12} />
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <StatusBadge status={m.status} />
        {m.status === 'trial' && m.trial_ends && (
          <span style={{ marginLeft: 6, fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Trial ends {m.trial_ends}</span>
        )}
        {m.suspend_reason && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)', background: '#fff0f0', padding: '4px 8px', borderRadius: 4 }}>{m.suspend_reason}</div>
        )}
      </div>

      {[
        ['Marina ID',       m.id],
        ['Plan',            planLabel[m.plan] || m.plan],
        ['Berths',          m.total_berths],
        ['Active bookings', m.active_bookings ?? '—'],
        ['Staff users',     m.user_count ?? m.staff?.length ?? '—'],
        ['MRR',             m.mrr > 0 ? `€${m.mrr}` : '—'],
        ['Next renewal',    m.next_renewal || '—'],
        ['Admin contact',   m.staff?.[0]?.email || '—'],
        ['Email',           m.contact_email],
        ['Joined',          new Date(m.created_at).toLocaleDateString()],
      ].map(([k, v]) => (
        <div key={k} className="detail-row">
          <span className="detail-key">{k}</span>
          <span className="detail-val">{v}</span>
        </div>
      ))}

      <div className="detail-actions">
        {m.status !== 'suspended' ? (
          <button type="button" className="btn btn-danger btn-sm" disabled={acting} onClick={handleSuspend} style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="lock" s={12} /> Suspend account
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" disabled={acting} onClick={handleReinstate} style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="check" s={12} /> Reinstate account
          </button>
        )}
        {m.status === 'trial' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={handleConvert} style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="tag" s={12} /> Convert to paid
          </button>
        )}
      </div>

      {/* Impersonation */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Support Access</div>
        {hasConsent ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--green, #2e7d32)', marginBottom: 8 }}>
              <Ic n="check" s={11} /> Consent granted until {consentExpiry.toLocaleString()}
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={handleImpersonate} style={{ justifyContent: 'flex-start', gap: 8 }}>
              <Ic n="log-in" s={12} /> Open support session
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
              No active consent. Provide a break-glass reason to override.
            </div>
            <input
              type="text"
              placeholder="Override reason (required)"
              value={bypassReason}
              onChange={e => setBypassReason(e.target.value)}
              style={{ marginBottom: 8, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={acting || !bypassReason.trim()}
              onClick={handleImpersonate}
              style={{ justifyContent: 'flex-start', gap: 8 }}
            >
              <Ic n="alert-tri" s={12} /> Break-glass access
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Marinas() {
  const [marinas, setMarinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');
  const [query, setQuery]     = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filter !== 'all') params.status = filter;
    if (query) params.search = query;
    api.get('admin/marinas/', { params })
      .then(r => setMarinas(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, query]);

  useEffect(() => { load(); }, [load]);

  function handleUpdate(updated) {
    setMarinas(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
    setSelected(updated);
  }

  const counts = { all: marinas.length };
  ['active', 'trial', 'suspended'].forEach(s => {
    counts[s] = marinas.filter(m => m.status === s).length;
  });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Marinas <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({marinas.length})</span></div>
      </div>

      <div className="grid-b" style={{ alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
            <div className="search">
              <Ic n="search" s={13} />
              <input placeholder="Search marinas…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div className="filter-bar" style={{ margin: 0 }}>
              {['all', 'active', 'trial', 'suspended'].map(f => (
                <div key={f} className={`filter-chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? `All (${counts.all})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Marina</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Berths</th>
                  <th style={{ textAlign: 'right' }}>MRR</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : marinas.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No marinas match this filter.</td></tr>
                ) : marinas.map(m => (
                  <tr key={m.id} className={selected?.id === m.id ? 'selected' : ''} onClick={() => setSelected(selected?.id === m.id ? null : m)}>
                    <td>
                      <div className="tbl-name">{m.name}</div>
                      {m.group_name
                        ? <div className="tbl-sub" style={{ color: 'rgba(180,140,0,0.8)' }}>{m.group_name}</div>
                        : <div className="tbl-sub">{m.timezone}</div>}
                    </td>
                    <td>
                      {m.group_name
                        ? <span className="badge badge-gold">Enterprise</span>
                        : <PlanBadge plan={m.plan} />}
                    </td>
                    <td>
                      <StatusBadge status={m.status} />
                      {m.status === 'trial' && m.trial_ends && (
                        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>→ {m.trial_ends}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.total_berths}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {m.mrr > 0 ? <span style={{ fontWeight: 600 }}>€{m.mrr}</span> : <span style={{ color: 'rgba(0,0,0,0.28)' }}>—</span>}
                    </td>
                    <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{new Date(m.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DetailPanel marina={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} />
      </div>
    </div>
  );
}
