import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

const CATEGORY_LABELS = {
  berth:   'Berth Rate',
  utility: 'Utility',
  service: 'Service',
  retail:  'Retail Item',
};

const PRICING_MODELS_BY_CATEGORY = {
  berth: [
    { value: 'per_night',           label: 'Per Night' },
    { value: 'per_meter_per_night', label: 'Per Metre / Night' },
    { value: 'per_meter_flat',      label: 'Per Metre (flat)' },
    { value: 'flat_fee',            label: 'Flat Fee' },
  ],
  utility: [
    { value: 'per_kwh',  label: 'Per kWh' },
    { value: 'per_hour', label: 'Per Hour' },
    { value: 'flat_fee', label: 'Flat Fee' },
  ],
  service: [
    { value: 'flat_fee', label: 'Flat Fee' },
    { value: 'per_hour', label: 'Per Hour' },
  ],
  retail: [
    { value: 'per_litre', label: 'Per Litre' },
    { value: 'flat_fee',  label: 'Flat Fee' },
  ],
};

const DEFAULT_PRICING_MODEL = {
  berth:   'per_night',
  utility: 'per_kwh',
  service: 'flat_fee',
  retail:  'per_litre',
};

const FUEL_DOCK_OPTIONS = [
  { value: 'diesel',   label: 'Diesel' },
  { value: 'petrol',   label: 'Petrol' },
  { value: 'pump_out', label: 'Pump-out' },
];

const NAME_PLACEHOLDER = {
  berth:   'e.g. Standard Berth Rate',
  utility: 'e.g. Shore Power 16A',
  service: 'e.g. Waste Pump-out',
  retail:  'e.g. Diesel',
};

const lbl = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)',
  display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px',
};

const inputSt = {
  width: '100%', border: 'var(--border)', borderRadius: 5,
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)',
  boxSizing: 'border-box', outline: 'none',
};

function blankForm(category) {
  return {
    name:                       '',
    pricing_model:              DEFAULT_PRICING_MODEL[category] ?? 'flat_fee',
    unit_price:                 '',
    tax_category_id:            '',
    is_mandatory_transient_fee: false,
    is_fuel_product:            false,
    show_in_pos:                false,
    fuel_dock_type:             '',
  };
}

export default function CatalogFormDrawer({ open, onClose, item, category, createItem, updateItem }) {
  const isEdit = Boolean(item);
  const [form, setForm]             = useState(() => blankForm(category));
  const [saving, setSaving]         = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError]           = useState('');
  const [taxRates, setTaxRates]     = useState([]);

  useEffect(() => {
    if (open) {
      setError('');
      if (item) {
        setForm({
          name:                       item.name ?? '',
          pricing_model:              item.pricing_model ?? DEFAULT_PRICING_MODEL[category] ?? 'flat_fee',
          unit_price:                 item.unit_price != null ? String(item.unit_price) : '',
          tax_category_id:            item.tax_category?.id != null ? String(item.tax_category.id) : '',
          is_mandatory_transient_fee: item.is_mandatory_transient_fee ?? false,
          is_fuel_product:            Boolean(item.fuel_dock_type),
          show_in_pos:                item.show_in_pos ?? false,
          fuel_dock_type:             item.fuel_dock_type ?? '',
        });
      } else {
        setForm(blankForm(category));
      }
    }
  }, [open, item, category]);

  useEffect(() => {
    if (!open) return;
    api.get('/billing/tax-rates/').then(({ data }) => {
      const list = Array.isArray(data) ? data : (data?.results ?? []);
      setTaxRates(list);
      if (!item) {
        const def = list.find(r => r.is_default);
        if (def) setForm(f => ({ ...f, tax_category_id: String(def.id) }));
      }
    }).catch(() => {});
  }, [open, item]);

  function set(k) {
    return (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  }

  function setCheck(k) {
    return (e) => setForm(f => ({ ...f, [k]: e.target.checked }));
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.';
    const price = parseFloat(form.unit_price);
    if (isNaN(price) || price < 0) return 'Unit price must be 0 or greater.';
    if (!form.tax_category_id) return 'Tax Treatment is required.';
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
        name:             form.name.trim(),
        category,
        pricing_model:    form.pricing_model,
        unit_price:       parseFloat(form.unit_price),
        tax_category_id:  parseInt(form.tax_category_id, 10),
        ...(category === 'service' ? { is_mandatory_transient_fee: form.is_mandatory_transient_fee } : {}),
        ...(category === 'retail'  ? {
          show_in_pos:    form.show_in_pos,
          fuel_dock_type: form.is_fuel_product ? (form.fuel_dock_type || '') : '',
        } : {}),
      };
      if (isEdit) {
        await updateItem(item.id, payload);
      } else {
        await createItem(payload);
      }
      onClose();
    } catch (err) {
      const detail = err?.response?.data?.detail
        ?? Object.values(err?.response?.data ?? {}).flat().join(' ')
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
    } catch (err) {
      const detail = err?.response?.data?.detail ?? 'Deactivate failed — please try again.';
      setError(String(detail));
    } finally {
      setDeactivating(false);
    }
  }

  const catLabel     = CATEGORY_LABELS[category] ?? 'Pricing Rule';
  const pricingOpts  = PRICING_MODELS_BY_CATEGORY[category] ?? PRICING_MODELS_BY_CATEGORY.service;

  return (
    <>
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
            {isEdit ? `Edit ${catLabel}` : `Add ${catLabel}`}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
            <Ic n="x" s={14} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Name</label>
            <input
              required
              value={form.name}
              onChange={set('name')}
              placeholder={NAME_PLACEHOLDER[category] ?? 'Name'}
              style={inputSt}
            />
          </div>

          {/* Pricing Model */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Pricing Model</label>
            <select value={form.pricing_model} onChange={set('pricing_model')} style={inputSt}>
              {pricingOpts.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Unit Price + Tax Treatment */}
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
              <label style={lbl}>Tax Treatment</label>
              <select
                value={form.tax_category_id}
                onChange={e => setForm(f => ({ ...f, tax_category_id: e.target.value }))}
                style={inputSt}
                required
              >
                <option value="">Select tax treatment…</option>
                {taxRates.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({parseFloat(r.rate).toFixed(2)}%)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Services only: mandatory transient fee */}
          {category === 'service' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.is_mandatory_transient_fee}
                  onChange={setCheck('is_mandatory_transient_fee')}
                  style={{ width: 16, height: 16, cursor: 'pointer', marginTop: 1, flexShrink: 0 }}
                />
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.75)' }}>
                    Mandatory transient fee
                  </span>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                    Auto-added to every new transient booking
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Retail only: fuel product + POS */}
          {category === 'retail' && (
            <>
              <div style={{ marginBottom: form.is_fuel_product ? 10 : 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.is_fuel_product}
                    onChange={setCheck('is_fuel_product')}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.75)' }}>
                    Is Fuel Product
                  </span>
                </label>
              </div>

              {form.is_fuel_product && (
                <div style={{ marginBottom: 14, paddingLeft: 26 }}>
                  <label style={lbl}>Fuel Type</label>
                  <select value={form.fuel_dock_type} onChange={set('fuel_dock_type')} style={inputSt}>
                    <option value="">— Select fuel type —</option>
                    {FUEL_DOCK_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

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
