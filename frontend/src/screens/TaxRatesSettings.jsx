import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

const lbl = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)',
  display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px',
};

const inputSt = {
  width: '100%', border: 'var(--border)', borderRadius: 5,
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)',
  boxSizing: 'border-box', outline: 'none',
};

export default function TaxRatesSettings() {
  const [rates, setRates]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ name: '', rate: '' });
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/billing/tax-rates/');
      setRates(Array.isArray(data) ? data : (data?.results ?? []));
    } catch {
      setError('Failed to load tax rates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    const rate = parseFloat(form.rate);
    if (isNaN(rate) || rate < 0 || rate > 100) { setFormError('Rate must be between 0 and 100.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/billing/tax-rates/', { name: form.name.trim(), rate: rate.toFixed(2) });
      setForm({ name: '', rate: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail
        ?? Object.values(err?.response?.data ?? {}).flat().join(' ')
        ?? 'Save failed.';
      setFormError(String(detail));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id) {
    try {
      await api.post(`/billing/tax-rates/${id}/set-default/`);
      await load();
    } catch {
      setError('Failed to set default.');
    }
  }

  async function handleArchive(id) {
    try {
      await api.post(`/billing/tax-rates/${id}/archive/`);
      await load();
    } catch {
      setError('Failed to archive rate.');
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/billing/tax-rates/${id}/`);
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail ?? 'Delete failed.';
      setError(String(detail));
    }
  }

  const active   = rates.filter(r => !r.is_archived);
  const archived = rates.filter(r => r.is_archived);

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Disclaimer */}
      <div style={{
        background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6,
        padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 20,
      }}>
        You are responsible for ensuring these rates are correct and up to date.
        DocksBase applies the rate you set — we do not provide tax advice.
        Consult your accountant if you are unsure which rate applies to a given item.
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Active rates table */}
      {loading ? (
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>Name</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>Rate</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>Default</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {active.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 8px' }}>{r.name}</td>
                <td style={{ textAlign: 'right', padding: '8px 8px', fontVariantNumeric: 'tabular-nums' }}>{parseFloat(r.rate).toFixed(2)}%</td>
                <td style={{ textAlign: 'center', padding: '8px 8px' }}>
                  <button
                    onClick={() => !r.is_default && handleSetDefault(r.id)}
                    title={r.is_default ? 'Default rate' : 'Set as default'}
                    style={{
                      background: 'none', border: 'none', cursor: r.is_default ? 'default' : 'pointer',
                      fontSize: 16, color: r.is_default ? '#f59e0b' : 'rgba(0,0,0,0.2)',
                    }}
                  >★</button>
                </td>
                <td style={{ padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => handleArchive(r.id)}>Archive</button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(r.id, r.name)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add rate form */}
      {showForm ? (
        <form onSubmit={handleCreate} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
          <div>
            <label style={lbl}>Rate Name</label>
            <input style={inputSt} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Reduced Rate — 5.00%" />
          </div>
          <div>
            <label style={lbl}>Rate (%)</label>
            <input style={{ ...inputSt, width: 120 }} type="number" min="0" max="100" step="0.01" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} placeholder="0.00" />
          </div>
          {formError && <p style={{ color: '#b91c1c', fontSize: 12, margin: 0 }}>{formError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Rate'}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setShowForm(false); setFormError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ Add Tax Rate</button>
      )}

      {/* Archived section */}
      {archived.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', cursor: 'pointer' }}>
            Archived ({archived.length})
          </summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8, opacity: 0.6 }}>
            <tbody>
              {archived.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', color: 'rgba(0,0,0,0.5)' }}>{r.name}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>{parseFloat(r.rate).toFixed(2)}%</td>
                  <td style={{ padding: '6px 8px' }} />
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
