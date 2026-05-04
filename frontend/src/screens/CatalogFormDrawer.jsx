import { useState, useEffect } from 'react';
import Ic from '../components/ui/Icon.jsx';
import useBerths from '../hooks/useBerths.js';

const CATEGORY_OPTIONS = [
  { value: 'berth',   label: 'Berth Rates' },
  { value: 'utility', label: 'Utilities' },
  { value: 'service', label: 'Services' },
  { value: 'retail',  label: 'Retail & Fuel' },
];

const PRICING_MODEL_OPTIONS = [
  { value: 'flat',      label: 'Flat Rate' },
  { value: 'per_night', label: 'Per Night' },
  { value: 'per_metre', label: 'Per Metre' },
  { value: 'per_litre', label: 'Per Litre' },
  { value: 'per_hour',  label: 'Per Hour' },
  { value: 'per_kg',    label: 'Per Kg' },
];

const FUEL_DOCK_OPTIONS = [
  { value: 'diesel',   label: 'Diesel' },
  { value: 'petrol',   label: 'Petrol' },
  { value: 'pump_out', label: 'Pump-out' },
];

const lbl = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)',
  display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px',
};

const inputSt = {
  width: '100%', border: 'var(--border)', borderRadius: 5,
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)',
  boxSizing: 'border-box', outline: 'none',
};

const BLANK = {
  name: '',
  category: 'berth',
  pricing_model: 'flat',
  unit_price: '',
  tax_rate: '20',
  show_in_pos: false,
  fuel_dock_type: '',
  berth_ids: [],
};

export default function CatalogFormDrawer({ open, onClose, item, createItem, updateItem }) {
  const isEdit = Boolean(item);
  const [form, setForm] = useState(BLANK);
  const { berths } = useBerths();
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState('');

  // Reset form when drawer opens or item changes
  useEffect(() => {
    if (open) {
      setError('');
      if (item) {
        setForm({
          name:           item.name ?? '',
          category:       item.category ?? 'berth',
          pricing_model:  item.pricing_model ?? 'flat',
          unit_price:     item.unit_price != null ? String(item.unit_price) : '',
          tax_rate:       item.tax_rate != null ? String(item.tax_rate) : '20',
          show_in_pos:    item.show_in_pos ?? false,
          fuel_dock_type: item.fuel_dock_type ?? '',
          berth_ids:      item.assigned_berths?.map(b => b.id) ?? [],
        });
      } else {
        setForm(BLANK);
      }
    }
  }, [open, item]);

  function set(k) {
    return (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  }

  function setCheck(k) {
    return (e) => setForm(f => ({ ...f, [k]: e.target.checked }));
  }

  function toggleBerth(id) {
    setForm(f => ({
      ...f,
      berth_ids: f.berth_ids.includes(id)
        ? f.berth_ids.filter(x => x !== id)
        : [...f.berth_ids, id],
    }));
  }

  // Group berths by berth_type; berths without a type go under '' (shown as "Untyped")
  const typeGroups = berths.reduce((acc, b) => {
    const t = b.berth_type || '';
    if (!acc[t]) acc[t] = [];
    acc[t].push(b);
    return acc;
  }, {});

  function selectByType(type) {
    const ids = (typeGroups[type] ?? []).map(b => b.id);
    setForm(f => {
      const next = new Set(f.berth_ids);
      ids.forEach(id => next.add(id));
      return { ...f, berth_ids: [...next] };
    });
  }

  function clearBerths() { setForm(f => ({ ...f, berth_ids: [] })); }
  function selectAll()   { setForm(f => ({ ...f, berth_ids: berths.map(b => b.id) })); }

  function validate() {
    if (!form.name.trim()) return 'Name is required.';
    const price = parseFloat(form.unit_price);
    if (isNaN(price) || price < 0) return 'Unit price must be 0 or greater.';
    return null;
  }

  async function handleSave(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError('');
    try {
      const payload = {
        name:           form.name.trim(),
        category:       form.category,
        pricing_model:  form.pricing_model,
        unit_price:     parseFloat(form.unit_price),
        tax_rate:       parseFloat(form.tax_rate) || 0,
        ...(form.category === 'berth'  ? { berth_ids: form.berth_ids } : {}),
        ...(form.category === 'retail' ? {
          show_in_pos:    form.show_in_pos,
          fuel_dock_type: form.fuel_dock_type || null,
        } : {}),
      };
      if (isEdit) {
        await updateItem(item.id, payload);
      } else {
        await createItem(payload);
      }
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail
        ?? Object.values(e?.response?.data ?? {}).flat().join(' ')
        ?? 'Save failed — please try again.';
      setError(String(detail));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!item) return;
    setDeactivating(true);
    setError('');
    try {
      await updateItem(item.id, { is_active: false });
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail ?? 'Deactivate failed — please try again.';
      setError(String(detail));
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 290,
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 420,
        background: '#fff',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.14)',
        zIndex: 300,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px 14px',
          borderBottom: 'var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
            {isEdit ? 'Edit Pricing Rule' : 'New Pricing Rule'}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ padding: '4px 8px' }}
          >
            <Ic n="x" s={14} />
          </button>
        </div>

        {/* Body (scrollable) */}
        <form onSubmit={handleSave} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Name</label>
            <input
              required
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. Standard Berth Rate"
              style={inputSt}
            />
          </div>

          {/* Category */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Category</label>
            <select value={form.category} onChange={set('category')} style={inputSt}>
              {CATEGORY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Pricing Model */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Pricing Model</label>
            <select value={form.pricing_model} onChange={set('pricing_model')} style={inputSt}>
              {PRICING_MODEL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Berth assignment — shown only for berth category */}
          {form.category === 'berth' && (
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Assign to Berths</label>
              {berths.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', fontStyle: 'italic', padding: '6px 0' }}>
                  No berths found. Add berths in the Map editor first.
                </div>
              ) : (
                <>
                  {/* Type group shortcuts */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {Object.entries(typeGroups).sort(([a],[b]) => a.localeCompare(b)).map(([type, group]) => (
                      <button key={type || '__none__'} type="button" className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => selectByType(type)}>
                        + {type || 'Untyped'} <span style={{ opacity: 0.5 }}>({group.length})</span>
                      </button>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ fontSize: 10, padding: '2px 8px' }} onClick={selectAll}>All</button>
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ fontSize: 10, padding: '2px 8px', color: 'var(--red)' }} onClick={clearBerths}>Clear</button>
                  </div>
                  <div style={{
                    maxHeight: 180, overflowY: 'auto',
                    border: 'var(--border)', borderRadius: 6,
                    padding: '4px 0',
                  }}>
                  {berths.map(b => (
                    <label
                      key={b.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 12px', cursor: 'pointer',
                        background: form.berth_ids.includes(b.id) ? 'rgba(0,100,220,0.05)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.berth_ids.includes(b.id)}
                        onChange={() => toggleBerth(b.id)}
                        style={{ width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{b.code}</span>
                      {b.pier_code && (
                        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>Pier {b.pier_code}</span>
                      )}
                      {b.vessel_name && (
                        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginLeft: 'auto' }}>
                          {b.vessel_name}
                        </span>
                      )}
                    </label>
                  ))}
                  </div>
                </>
              )}
              {form.berth_ids.length > 0 && (
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 5 }}>
                  {form.berth_ids.length} berth{form.berth_ids.length !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>
          )}

          {/* Unit Price + Tax side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Unit Price (€)</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.unit_price}
                onChange={set('unit_price')}
                placeholder="0.00"
                style={inputSt}
              />
            </div>
            <div>
              <label style={lbl}>Tax %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.tax_rate}
                onChange={set('tax_rate')}
                placeholder="20"
                style={inputSt}
              />
            </div>
          </div>

          {/* Retail-only fields */}
          {form.category === 'retail' && (
            <>
              {/* Show in POS toggle */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.show_in_pos}
                    onChange={setCheck('show_in_pos')}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.75)' }}>
                    Show in Fuel Dock POS
                  </span>
                </label>
              </div>

              {/* Fuel Dock Type */}
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Fuel Dock Type</label>
                <select value={form.fuel_dock_type} onChange={set('fuel_dock_type')} style={inputSt}>
                  <option value="">— None —</option>
                  {FUEL_DOCK_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Inline error */}
          {error && (
            <div style={{
              fontSize: 12, color: 'var(--red)',
              background: '#fff5f5', border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 6, padding: '8px 12px', marginBottom: 14,
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {isEdit && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleDeactivate}
                disabled={deactivating || saving}
                style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}
              >
                {deactivating ? 'Deactivating…' : 'Deactivate'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              style={{ marginLeft: isEdit ? 'auto' : undefined }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || deactivating}
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
