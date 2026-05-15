import { useState } from 'react';
import useFuelPrices from '../hooks/useFuelPrices.js';

const FUEL_COLORS = { diesel: '#0075de', petrol: '#dd5b00', pump_out: '#2a9d99' };

function PriceCell({ product, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value,   setValue]   = useState(String(product.unit_price));
  const [note,    setNote]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  function start() {
    setValue(String(product.unit_price));
    setNote('');
    setErr('');
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setErr('');
  }

  async function commit() {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) { setErr('Invalid price'); return; }
    if (num.toFixed(2) === Number(product.unit_price).toFixed(2)) { cancel(); return; }
    setSaving(true); setErr('');
    try {
      await onSave(product.id, num.toFixed(2), note.trim());
      setEditing(false);
    } catch {
      setErr('Save failed');
    } finally {
      setSaving(false);
    }
  }

  const color = FUEL_COLORS[product.fuel_dock_type] ?? '#888';
  const perL  = product.pricing_model === 'per_litre';

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: 'var(--border)' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{product.name}</div>
          <div style={{ fontSize: 11, color, fontWeight: 600, textTransform: 'capitalize', marginTop: 2 }}>
            {product.fuel_dock_type_label || product.fuel_dock_type}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            €{Number(product.unit_price).toFixed(2)}
            <span style={{ fontSize: 11, fontWeight: 400, color: 'rgba(0,0,0,0.5)' }}>
              {perL ? '/L' : ' flat'}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={start} title="Update price"
            style={{ fontSize: 11 }}>
            Update
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px', borderBottom: 'var(--border)', background: '#fafbfc' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{product.name}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 8, alignItems: 'center' }}>
        <input
          type="number" min="0" step="0.01" autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          style={{ fontSize: 13, padding: '7px 10px', border: 'var(--border)', borderRadius: 5, outline: 'none' }}
        />
        <input
          placeholder="Note (e.g. tanker delivery 14 May)"
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          style={{ fontSize: 12, padding: '7px 10px', border: 'var(--border)', borderRadius: 5, outline: 'none' }}
        />
        <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={commit} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{err}</div>}
    </div>
  );
}

export default function FuelPricesWidget() {
  const { products, history, loading, updatePrice } = useFuelPrices();
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px',
        borderBottom: 'var(--border)', background: '#fff' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'rgba(0,0,0,0.55)', flex: 1 }}>
          Fuel Prices
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(v => !v)} style={{ fontSize: 11 }}>
          {showHistory ? 'Hide history' : `History (${history.length})`}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 16, fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
      ) : products.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: 'rgba(0,0,0,0.4)', fontStyle: 'italic' }}>
          No fuel products configured. Add a Retail item with a fuel type in Service Catalog.
        </div>
      ) : (
        products.map(p => <PriceCell key={p.id} product={p} onSave={updatePrice} />)
      )}

      {showHistory && (
        <div style={{ background: '#fafbfc', maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)', padding: '10px 14px 4px' }}>
            Recent changes
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '8px 14px 14px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
              No price changes yet.
            </div>
          ) : history.map(h => (
            <div key={h.id} style={{ padding: '8px 14px', borderTop: 'var(--border)',
              fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{h.item_name}</div>
                <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.5)', marginTop: 1 }}>
                  €{Number(h.old_price).toFixed(2)} → €{Number(h.new_price).toFixed(2)}
                  {h.changed_by_name ? ` · ${h.changed_by_name}` : ''}
                  {h.note ? ` · ${h.note}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
                {new Date(h.changed_at).toLocaleString('en-GB',
                  { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
