import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api.js';

// Tax Codes editor. Inline-editable rows mapped to /accounting/tax-codes/.
// Editable: name, rate, jurisdiction_country, reportable_category,
//           external_qbo_code, external_xero_code.

const LABEL = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  display: 'block', marginBottom: 4,
};

const REPORTABLE_CATEGORIES = [
  ['sales_tax',     'Sales Tax'],
  ['transient_tax', 'Transient / Hotel Tax'],
  ['tourism_levy',  'Tourism Levy'],
  ['fuel_excise',   'Fuel Excise'],
  ['vat_standard',  'VAT Standard'],
  ['vat_reduced',   'VAT Reduced'],
  ['vat_zero',      'VAT Zero'],
  ['vat_exempt',    'VAT Exempt'],
  ['gst',           'GST'],
  ['pst',           'PST'],
  ['hst',           'HST'],
  ['none',          'No Tax / Exempt'],
];

function Toast({ kind, text, onClose }) {
  if (!text) return null;
  return (
    <div
      data-testid="tax-toast"
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

export default function AccountingTaxCodesCard() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding]   = useState(false);
  const [newRow, setNewRow]   = useState({
    name: '', rate: '0.00', jurisdiction_country: '',
    reportable_category: 'sales_tax',
    external_qbo_code: '', external_xero_code: '',
  });

  const debounceTimers = useRef({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/tax-codes/');
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
      await api.patch(`/accounting/tax-codes/${id}/`, body);
      setToast({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.response?.data?.detail || 'Save failed.' });
    }
  }

  async function handleAdd() {
    if (!newRow.name.trim()) {
      setToast({ kind: 'error', text: 'Name is required.' });
      return;
    }
    setAdding(true);
    try {
      const { data } = await api.post('/accounting/tax-codes/', newRow);
      setRows(prev => [...prev, data]);
      setNewRow({
        name: '', rate: '0.00', jurisdiction_country: '',
        reportable_category: 'sales_tax',
        external_qbo_code: '', external_xero_code: '',
      });
      setAddOpen(false);
      setToast({ kind: 'ok', text: 'Tax code added.' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.response?.data?.detail || 'Could not add tax code.' });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card" data-testid="tax-codes-card">
      <div className="card-header">
        <div className="card-header-title">Tax Codes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            Jurisdiction + external code mapping for QBO / Xero
          </span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setAddOpen(true)}
            data-testid="tax-add-btn"
          >
            Add tax code
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div
          data-testid="tax-empty-state"
          style={{ padding: '40px 16px', textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}
        >
          <div style={{ fontSize: 13, marginBottom: 14 }}>
            No tax codes defined. Add one to start mapping to QuickBooks/Xero.
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setAddOpen(true)}
            data-testid="tax-empty-add-btn"
          >
            Add your first tax code
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 80 }}>Rate %</th>
                <th style={{ width: 90 }}>Country</th>
                <th>Reportable category</th>
                <th>QBO code</th>
                <th>Xero code</th>
                <th style={{ width: 70 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} data-testid={`tax-row-${r.id}`}>
                  <td>
                    <input
                      className="input"
                      data-testid={`tax-name-${r.id}`}
                      value={r.name || ''}
                      onChange={e => updateLocal(r.id, 'name', e.target.value)}
                      style={{ width: '100%', fontSize: 12, fontWeight: 600 }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      value={r.rate || ''}
                      onChange={e => updateLocal(r.id, 'rate', e.target.value)}
                      style={{ width: '100%', fontSize: 12, fontFamily: 'monospace' }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      maxLength={2}
                      value={r.jurisdiction_country || ''}
                      onChange={e => updateLocal(r.id, 'jurisdiction_country', e.target.value.toUpperCase())}
                      placeholder="GB"
                      style={{ width: '100%', fontSize: 12, textTransform: 'uppercase' }}
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      data-testid={`tax-cat-${r.id}`}
                      value={r.reportable_category || 'sales_tax'}
                      onChange={e => updateLocal(r.id, 'reportable_category', e.target.value)}
                      style={{ width: '100%', fontSize: 12 }}
                    >
                      {REPORTABLE_CATEGORIES.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      data-testid={`tax-qbo-${r.id}`}
                      value={r.external_qbo_code || ''}
                      onChange={e => updateLocal(r.id, 'external_qbo_code', e.target.value)}
                      placeholder="QBO code"
                      style={{ width: '100%', fontSize: 12, fontFamily: 'monospace' }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      data-testid={`tax-xero-${r.id}`}
                      value={r.external_xero_code || ''}
                      onChange={e => updateLocal(r.id, 'external_xero_code', e.target.value)}
                      placeholder="Xero code"
                      style={{ width: '100%', fontSize: 12, fontFamily: 'monospace' }}
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
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Add tax code</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={LABEL}>Name</label>
                <input
                  className="input"
                  value={newRow.name}
                  onChange={e => setNewRow(r => ({ ...r, name: e.target.value }))}
                  placeholder="e.g. Standard VAT 20%"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={LABEL}>Rate %</label>
                <input
                  className="input"
                  type="number" step="0.01"
                  value={newRow.rate}
                  onChange={e => setNewRow(r => ({ ...r, rate: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={LABEL}>Country</label>
                <input
                  className="input"
                  maxLength={2}
                  value={newRow.jurisdiction_country}
                  onChange={e => setNewRow(r => ({ ...r, jurisdiction_country: e.target.value.toUpperCase() }))}
                  placeholder="GB"
                  style={{ width: '100%', textTransform: 'uppercase' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={LABEL}>Reportable category</label>
                <select
                  className="input"
                  value={newRow.reportable_category}
                  onChange={e => setNewRow(r => ({ ...r, reportable_category: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  {REPORTABLE_CATEGORIES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={LABEL}>QBO code</label>
                <input
                  className="input"
                  value={newRow.external_qbo_code}
                  onChange={e => setNewRow(r => ({ ...r, external_qbo_code: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={LABEL}>Xero code</label>
                <input
                  className="input"
                  value={newRow.external_xero_code}
                  onChange={e => setNewRow(r => ({ ...r, external_xero_code: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={adding} onClick={handleAdd}>
                {adding ? 'Saving…' : 'Add tax code'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast kind={toast?.kind} text={toast?.text} onClose={() => setToast(null)} />
    </div>
  );
}
