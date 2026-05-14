import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Badge, Spinner, EmptyState, ErrorMsg, SuccessMsg } from './_shared.jsx';

const VENDORS = [
  { id: 'rolec',      label: 'Rolec Cloud' },
  { id: 'marinesync', label: 'MarineSync' },
];

function IntegrationModal({ initial, onClose, onSaved }) {
  const [vendor,   setVendor]   = useState(initial?.vendor || 'rolec');
  const [apiKey,   setApiKey]   = useState('');
  const [baseUrl,  setBaseUrl]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const body = { vendor, credentials: { api_key: apiKey, base_url: baseUrl || undefined } };
      if (initial) await api.patch(`/utilities/integrations/${initial.id}/`, body);
      else         await api.post('/utilities/integrations/', body);
      onSaved();
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, width: 420, padding: 24 }}
           onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          {initial ? 'Edit Integration' : 'Add Integration'}
        </div>
        <ErrorMsg msg={err} />
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</label>
            <select value={vendor} onChange={e => setVendor(e.target.value)} disabled={!!initial}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}>
              {VENDORS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>API key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                   placeholder={initial ? '(leave blank to keep existing)' : ''}
                   required={!initial}
                   style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Base URL (optional)</label>
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                   placeholder="https://api.rolec.com"
                   style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" onClick={onClose}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'var(--border)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function IntegrationsPanel() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [msg,     setMsg]     = useState('');
  const [err,     setErr]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/integrations/')
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(row) {
    setMsg(''); setErr('');
    try {
      const { data } = await api.post(`/utilities/integrations/${row.id}/test/`);
      if (data.ok) setMsg(`${row.vendor}: connection OK.`);
      else         setErr(`${row.vendor}: ${data.error}`);
    } catch {
      setErr('Test failed.');
    }
    setTimeout(() => { setMsg(''); setErr(''); }, 5000);
  }

  async function del(row) {
    if (!confirm(`Delete the ${row.vendor} integration?`)) return;
    await api.delete(`/utilities/integrations/${row.id}/`);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          Connect to a meter vendor's cloud — we poll readings every 15 min.
        </div>
        <button onClick={() => setShowAdd(true)}
                style={{ background: 'var(--navy)', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          + Add Integration
        </button>
      </div>

      <ErrorMsg msg={err} />
      <SuccessMsg msg={msg} />

      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon="⚡" message="No vendor integrations. Click Add Integration to connect one." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(row => (
            <div key={row.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{(VENDORS.find(v => v.id === row.vendor) || {}).label || row.vendor}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 3 }}>
                  {row.last_sync_at ? `Last sync ${new Date(row.last_sync_at).toLocaleString()}` : 'Never synced'}
                  {row.last_sync_ok === false && row.last_sync_error && ` — ${row.last_sync_error}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge color={row.is_active ? 'success' : 'secondary'}>{row.is_active ? 'Active' : 'Paused'}</Badge>
                <button onClick={() => test(row)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Test</button>
                <button onClick={() => setEditing(row)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</button>
                <button onClick={() => del(row)} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <IntegrationModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}
