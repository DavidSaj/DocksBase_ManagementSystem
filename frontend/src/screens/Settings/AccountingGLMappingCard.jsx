import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api.js';

// Inline editor for GL mappings. Renders rows from /accounting/gl-mappings/.
// Debounced PATCH on field blur/change. Toast on success/failure.
//
// Used as the "GL Mapping" sub-tab on the Accounting screen.

const LABEL = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  display: 'block', marginBottom: 4,
};

const DEFAULT_CATEGORIES = [
  'slip', 'utility', 'boatyard', 'retail', 'fuel',
  'restaurant', 'service', 'tax_collected', 'other',
];

function Toast({ kind, text, onClose }) {
  if (!text) return null;
  return (
    <div
      data-testid="gl-toast"
      onClick={onClose}
      style={{
        position: 'fixed', bottom: 24, right: 24, padding: '10px 14px',
        borderRadius: 7, fontSize: 12, color: '#fff', cursor: 'pointer',
        background: kind === 'error' ? '#b91c1c' : 'var(--teal, #1f8c66)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.18)', zIndex: 200,
      }}
    >{text}</div>
  );
}

export default function AccountingGLMappingCard() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding]   = useState(false);
  const [newRow, setNewRow]   = useState({ chargeable_category: '', external_gl_code: '', external_gl_name: '' });

  const debounceTimers = useRef({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/gl-mappings/');
      setRows(data.results ?? data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateLocal(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    schedulePatch(id, field, value);
  }

  function schedulePatch(id, field, value) {
    const key = `${id}:${field}`;
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => {
      doPatch(id, { [field]: value });
      delete debounceTimers.current[key];
    }, 500);
  }

  async function doPatch(id, body) {
    try {
      await api.patch(`/accounting/gl-mappings/${id}/`, body);
      setToast({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.response?.data?.detail || 'Save failed.' });
    }
  }

  async function handleAdd() {
    if (!newRow.chargeable_category.trim()) {
      setToast({ kind: 'error', text: 'Category is required.' });
      return;
    }
    setAdding(true);
    try {
      const { data } = await api.post('/accounting/gl-mappings/', newRow);
      setRows(prev => [...prev, data]);
      setNewRow({ chargeable_category: '', external_gl_code: '', external_gl_name: '' });
      setAddOpen(false);
      setToast({ kind: 'ok', text: 'Mapping added.' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.response?.data?.detail || 'Could not add mapping.' });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card" data-testid="gl-mapping-card">
      <div className="card-header">
        <div className="card-header-title">GL Mapping</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            Category → external GL code (QuickBooks / Xero)
          </span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setAddOpen(true)}
            data-testid="gl-add-btn"
          >
            Add mapping
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div
          data-testid="gl-empty-state"
          style={{ padding: '40px 16px', textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}
        >
          <div style={{ fontSize: 13, marginBottom: 14 }}>
            No GL mappings defined. Add one to start exporting to QuickBooks/Xero.
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setAddOpen(true)}
            data-testid="gl-empty-add-btn"
          >
            Add your first mapping
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th>External GL code</th>
                <th>Friendly label</th>
                <th style={{ width: 70 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} data-testid={`gl-row-${r.id}`}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{r.chargeable_category}</td>
                  <td>
                    <input
                      className="input"
                      data-testid={`gl-code-${r.id}`}
                      value={r.external_gl_code || ''}
                      onChange={e => updateLocal(r.id, 'external_gl_code', e.target.value)}
                      placeholder="e.g. 4000"
                      style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      data-testid={`gl-name-${r.id}`}
                      value={r.external_gl_name || ''}
                      onChange={e => updateLocal(r.id, 'external_gl_name', e.target.value)}
                      placeholder="Friendly label"
                      style={{ width: '100%', fontSize: 12 }}
                    />
                  </td>
                  <td>
                    <span className={`badge ${r.is_active ? 'badge-green' : 'badge-gray'}`}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setAddOpen(false)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Add GL mapping</div>
            <div style={{ marginBottom: 12 }}>
              <label style={LABEL}>Category</label>
              <select
                className="input"
                value={newRow.chargeable_category}
                onChange={e => setNewRow(r => ({ ...r, chargeable_category: e.target.value }))}
                style={{ width: '100%' }}
              >
                <option value="">Select category…</option>
                {DEFAULT_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={LABEL}>External GL code</label>
              <input
                className="input"
                value={newRow.external_gl_code}
                onChange={e => setNewRow(r => ({ ...r, external_gl_code: e.target.value }))}
                placeholder="e.g. 4000"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={LABEL}>Friendly label</label>
              <input
                className="input"
                value={newRow.external_gl_name}
                onChange={e => setNewRow(r => ({ ...r, external_gl_name: e.target.value }))}
                placeholder="e.g. Slip Rental Income"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={adding} onClick={handleAdd}>
                {adding ? 'Saving…' : 'Add mapping'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast kind={toast?.kind} text={toast?.text} onClose={() => setToast(null)} />
    </div>
  );
}
