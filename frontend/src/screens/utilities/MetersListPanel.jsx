import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Badge, Spinner, EmptyState, ErrorMsg } from './_shared.jsx';

const VENDORS  = [{ id: 'rolec', label: 'Rolec' }, { id: 'marinesync', label: 'MarineSync' }];
const TYPES    = [{ id: 'electricity', label: 'Electricity' }, { id: 'water', label: 'Water' }];

function MeterModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    vendor: initial?.vendor || 'rolec',
    meter_type: initial?.meter_type || 'electricity',
    device_id: initial?.device_id || '',
    label: initial?.label || '',
    berth: initial?.berth || '',
    poll_interval_minutes: initial?.poll_interval_minutes || 60,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    const body = { ...form, berth: form.berth || null };
    try {
      if (initial) await api.patch(`/utilities/smart-meters/${initial.id}/`, body);
      else         await api.post('/utilities/smart-meters/', body);
      onSaved(); onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}
         onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, width: 420, padding: 24 }}
           onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          {initial ? 'Edit Meter' : 'Add Meter'}
        </div>
        <ErrorMsg msg={err} />
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Label',      'label',      'text',   false],
            ['Device ID',  'device_id',  'text',   true],
          ].map(([label, key, type, req]) => (
            <div key={key}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
              <input type={type} required={req}
                     value={form[key]}
                     onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                     style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }} />
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</label>
              <select value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}>
                {VENDORS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</label>
              <select value={form.meter_type} onChange={e => setForm(f => ({ ...f, meter_type: e.target.value }))}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" onClick={onClose}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'var(--border)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
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

export default function MetersListPanel() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/smart-meters/')
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function del(row) {
    if (!confirm(`Delete meter ${row.label || row.device_id}?`)) return;
    await api.delete(`/utilities/smart-meters/${row.id}/`);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          Register each physical meter. Vendor-pull meters need a matching Integration;
          direct-push meters get a token under the Device Tokens tab.
        </div>
        <button onClick={() => setAdding(true)}
                style={{ background: 'var(--navy)', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          + Add Meter
        </button>
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon="📊" message="No meters registered yet." />
      ) : (
        <div className="card">
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Vendor</th>
                <th>Type</th>
                <th>Device ID</th>
                <th>Online</th>
                <th>Last polled</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{r.label || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.vendor}</td>
                  <td style={{ fontSize: 12 }}>{r.meter_type}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.device_id}</td>
                  <td><Badge color={r.is_online ? 'success' : 'danger'}>{r.is_online ? 'Online' : 'Offline'}</Badge></td>
                  <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                    {r.last_polled ? new Date(r.last_polled).toLocaleString() : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => setEditing(r)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</button>
                    <button onClick={() => del(r)} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <MeterModal
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}
