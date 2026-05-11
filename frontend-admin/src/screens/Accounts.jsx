import { useEffect, useState } from 'react';
import api from '../api.js';

const STATUS_COLORS = { active: '#16a34a', trial: '#d97706', suspended: '#dc2626', pending_payment: '#6b7280' };

function Badge({ status }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: (STATUS_COLORS[status] || '#6b7280') + '20', color: STATUS_COLORS[status] || '#6b7280' }}>
      {status}
    </span>
  );
}

function MarinaDrawer({ marina: initial, onClose, onUpdated }) {
  const [marina, setMarina] = useState(initial);
  const [suspendReason, setSuspendReason] = useState('');
  const [bypassReason, setBypassReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const marinaAppUrl = import.meta.env.VITE_MARINA_APP_URL || 'http://localhost:5173';

  useEffect(() => {
    api.get(`/admin/marinas/${marina.id}/`).then(r => setMarina(r.data));
  }, [marina.id]);

  async function act(fn, successMsg) {
    setLoading(true); setMsg('');
    try {
      const r = await fn();
      setMarina(r.data);
      onUpdated(r.data);
      setMsg(successMsg);
    } catch (e) {
      setMsg(e.response?.data?.detail || 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function impersonate() {
    setLoading(true); setMsg('');
    try {
      const body = bypassReason ? { bypass_reason: bypassReason } : {};
      const { data } = await api.post(`/admin/marinas/${marina.id}/impersonate/`, body);
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);
      window.open(marinaAppUrl, '_blank');
    } catch (e) {
      setMsg(e.response?.data?.detail || 'Impersonation failed');
    } finally {
      setLoading(false);
    }
  }

  const consentActive = marina.support_access_granted_until && new Date(marina.support_access_granted_until) > new Date();

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', padding: 32, overflowY: 'auto', zIndex: 100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{marina.name}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#999' }}>×</button>
      </div>

      <div style={{ marginBottom: 24, fontSize: 13, lineHeight: 1.8 }}>
        <div><b>Plan:</b> {marina.plan} &nbsp; <b>Status:</b> <Badge status={marina.status} /></div>
        <div><b>MRR:</b> €{marina.mrr ?? '—'}</div>
        <div><b>Berths:</b> {marina.total_berths}</div>
        <div><b>Created:</b> {marina.created_at?.slice(0, 10)}</div>
        {marina.suspend_reason && <div style={{ color: '#dc2626' }}><b>Suspend reason:</b> {marina.suspend_reason}</div>}
        <div><b>Support consent:</b> {consentActive ? `Granted until ${new Date(marina.support_access_granted_until).toLocaleString()}` : 'Not granted'}</div>
      </div>

      {msg && <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {marina.status === 'active' && (
          <>
            <input placeholder="Suspend reason (required)" value={suspendReason} onChange={e => setSuspendReason(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
            <button disabled={loading || !suspendReason} onClick={() => act(() => api.post(`/admin/marinas/${marina.id}/suspend/`, { reason: suspendReason }), 'Suspended')} style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
              Suspend Marina
            </button>
          </>
        )}
        {marina.status === 'suspended' && (
          <button disabled={loading} onClick={() => act(() => api.post(`/admin/marinas/${marina.id}/reinstate/`), 'Reinstated')} style={{ padding: '8px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
            Reinstate Marina
          </button>
        )}
        {marina.status === 'trial' && (
          <button disabled={loading} onClick={() => act(() => api.post(`/admin/marinas/${marina.id}/convert/`), 'Converted to active')} style={{ padding: '8px 12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
            Convert Trial → Active
          </button>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Impersonate</h3>
        {!consentActive && (
          <input placeholder="Bypass reason (required for admin override)" value={bypassReason} onChange={e => setBypassReason(e.target.value)} style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, marginBottom: 8 }} />
        )}
        <button disabled={loading} onClick={impersonate} style={{ padding: '8px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
          Impersonate Harbor Master
        </button>
        {!consentActive && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠ No consent granted — bypass reason required (admin only)</div>}
      </div>
    </div>
  );
}

export default function Accounts() {
  const [marinas, setMarinas] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    api.get('/admin/marinas/', { params })
      .then(r => setMarinas(r.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [search, statusFilter]);

  function onUpdated(updated) {
    setMarinas(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
    setSelected(updated);
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Accounts</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Search name or address…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, width: 240 }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="pending_payment">Pending payment</option>
        </select>
      </div>

      {loading ? <div style={{ color: '#999' }}>Loading…</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              {['Name', 'Plan', 'Status', 'Berths', 'Created'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600, fontSize: 12, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {marinas.map(m => (
              <tr key={m.id} onClick={() => setSelected(m)} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{m.name}</td>
                <td style={{ padding: '10px 12px' }}>{m.plan}</td>
                <td style={{ padding: '10px 12px' }}><Badge status={m.status} /></td>
                <td style={{ padding: '10px 12px' }}>{m.total_berths}</td>
                <td style={{ padding: '10px 12px', color: '#999' }}>{m.created_at?.slice(0, 10)}</td>
              </tr>
            ))}
            {!marinas.length && <tr><td colSpan={5} style={{ padding: 24, color: '#999', textAlign: 'center' }}>No marinas found</td></tr>}
          </tbody>
        </table>
      )}

      {selected && (
        <MarinaDrawer marina={selected} onClose={() => setSelected(null)} onUpdated={onUpdated} />
      )}
    </div>
  );
}
