import { useState } from 'react';
import useServiceCatalog from '../hooks/useServiceCatalog.js';
import useBerthCategories from '../hooks/useBerthCategories.js';
import Ic from '../components/ui/Icon.jsx';
import CatalogList from './CatalogList.jsx';
import CatalogFormDrawer from './CatalogFormDrawer.jsx';
import BerthPricingAssigner from './BerthPricingAssigner.jsx';

const TABS = [
  { value: 'berth-categories', label: 'Berth Categories', addLabel: 'Add Category'    },
  { value: 'berth',            label: 'Berth Rates',      addLabel: 'Add Berth Rate'  },
  { value: 'utility',          label: 'Utilities',        addLabel: 'Add Utility'     },
  { value: 'service',          label: 'Services',         addLabel: 'Add Service'     },
  { value: 'retail',           label: 'Retail & Fuel',    addLabel: 'Add Retail Item' },
];

const AMENITY_LABELS = {
  power_30a:   '⚡ 30A Power',
  power_50a:   '⚡ 50A Power',
  water:       '💧 Water',
  wifi:        '📶 WiFi',
  fuel_nearby: '⛽ Fuel Nearby',
  pump_out:    '🔄 Pump-out',
};
const AMENITY_SLUGS = Object.keys(AMENITY_LABELS);
const MOORING_OPTIONS = [
  { value: 'finger',       label: 'Finger Pontoon' },
  { value: 'alongside',    label: 'Alongside' },
  { value: 'stern_to',     label: 'Stern-to' },
  { value: 'mooring_ball', label: 'Mooring Ball' },
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

function BerthCategoryPanel({ item, berthRates, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    name:         item?.name         ?? '',
    description:  item?.description  ?? '',
    mooring_type: item?.mooring_type ?? 'finger',
    amenities:    item?.amenities    ?? [],
    pricing_tier: item?.pricing_tier ?? '',
    sort_order:   item?.sort_order   ?? 0,
    is_active:    item?.is_active    ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleAmenity = (slug) => setForm(f => ({
    ...f,
    amenities: f.amenities.includes(slug)
      ? f.amenities.filter(a => a !== slug)
      : [...f.amenities, slug],
  }));

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await onSave(form, item?.id ?? null);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.amenities?.[0] || e.response?.data?.detail || 'Save failed.');
    } finally { setSaving(false); }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 290,
        }}
      />

      {/* Slide-in panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 440,
        background: '#fff',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.14)',
        zIndex: 300,
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
            {item ? 'Edit Category' : 'New Berth Category'}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
            <Ic n="x" s={14} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Name *</label>
            <input
              required
              className="form-input"
              style={inputSt}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Premium Slip"
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Description</label>
            <textarea
              style={{ ...inputSt, resize: 'vertical' }}
              maxLength={120}
              rows={2}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Short description shown to boaters"
            />
          </div>

          {/* Mooring type */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Mooring Type</label>
            <select style={inputSt} value={form.mooring_type} onChange={e => set('mooring_type', e.target.value)}>
              {MOORING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Amenities */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Amenities</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {AMENITY_SLUGS.map(slug => (
                <label key={slug} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.amenities.includes(slug)}
                    onChange={() => toggleAmenity(slug)}
                  />
                  {AMENITY_LABELS[slug]}
                </label>
              ))}
            </div>
          </div>

          {/* Pricing tier */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Pricing Tier *</label>
            <select
              required
              style={inputSt}
              value={form.pricing_tier}
              onChange={e => set('pricing_tier', e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— select a berth rate —</option>
              {berthRates.map(r => (
                <option key={r.id} value={r.id}>{r.name} (€{r.unit_price}/night)</option>
              ))}
            </select>
          </div>

          {/* Sort order + Active */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Sort Order</label>
              <input
                type="number"
                style={inputSt}
                value={form.sort_order}
                onChange={e => set('sort_order', Number(e.target.value))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => set('is_active', e.target.checked)}
                />
                Active
              </label>
            </div>
          </div>

          {/* Error */}
          {err && (
            <div style={{
              fontSize: 12, color: 'var(--red)',
              background: '#fff5f5', border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 6, padding: '8px 12px', marginBottom: 14,
            }}>
              {err}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {item && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}
                onClick={() => { onDelete(item.id); onClose(); }}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              style={{ marginLeft: item ? 'auto' : undefined }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : item ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function ServiceCatalogScreen() {
  const [tab, setTab]                   = useState('berth-categories');
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [assignerOpen, setAssignerOpen] = useState(false);
  const [editItem, setEditItem]         = useState(null);

  // Berth categories state
  const { categories, loading: catLoading, save: saveCat, remove: removeCat } = useBerthCategories();
  const [catPanel, setCatPanel] = useState(false);
  const [editCat, setEditCat]   = useState(null);

  // Service catalog items for current tab (skip on berth-categories tab)
  const catalogCategory = tab === 'berth-categories' ? null : tab;
  const { items, loading, error, createItem, updateItem } = useServiceCatalog(catalogCategory);

  // Always fetch berth rates for the pricing tier dropdown in BerthCategoryPanel
  const { items: berthRates } = useServiceCatalog('berth');

  function openCreate() {
    if (tab === 'berth-categories') {
      setEditCat(null);
      setCatPanel(true);
      return;
    }
    setEditItem(null);
    setDrawerOpen(true);
  }

  function openCreateFromAssigner() {
    setAssignerOpen(false);
    setEditItem(null);
    setDrawerOpen(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditItem(null);
  }

  const activeTab = TABS.find(t => t.value === tab);

  return (
    <div>
      {/* Page header */}
      <div className="sec-hdr" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)' }}>Service Catalog</div>
      </div>

      {/* Tabs row with contextual Add button */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div className="tabs" style={{ flex: 1, marginBottom: 0 }}>
          {TABS.map(t => (
            <div
              key={t.value}
              className={`tab${tab === t.value ? ' active' : ''}`}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
          {tab === 'berth' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAssignerOpen(true)}
              style={{ fontSize: 12 }}
            >
              Assign Rates
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Ic n="plus" s={12} />
            {activeTab?.addLabel ?? 'Add'}
          </button>
        </div>
      </div>

      {/* Berth Categories tab content */}
      {tab === 'berth-categories' && (
        <>
          {catPanel && (
            <BerthCategoryPanel
              item={editCat}
              berthRates={berthRates ?? []}
              onSave={saveCat}
              onDelete={removeCat}
              onClose={() => { setCatPanel(false); setEditCat(null); }}
            />
          )}
          {catLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
              Loading…
            </div>
          ) : categories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
              No berth categories yet. Click &ldquo;Add Category&rdquo; to create one.
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mooring</th>
                    <th>Amenities</th>
                    <th>Tier</th>
                    <th>Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id}>
                      <td><div className="tbl-name">{c.name}</div></td>
                      <td style={{ fontSize: 12, textTransform: 'capitalize' }}>
                        {c.mooring_type.replace('_', '-')}
                      </td>
                      <td>
                        {(c.amenities ?? []).map(a => (
                          <span key={a} className="badge badge-gray" style={{ marginRight: 4, fontSize: 11 }}>
                            {AMENITY_LABELS[a] ?? a}
                          </span>
                        ))}
                      </td>
                      <td style={{ fontSize: 12 }}>{c.pricing_tier_name ?? '—'}</td>
                      <td>
                        {c.is_active
                          ? <span className="badge badge-green">Active</span>
                          : <span className="badge badge-gray">Inactive</span>
                        }
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setEditCat(c); setCatPanel(true); }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* List for catalog tabs */}
      {tab !== 'berth-categories' && (
        <CatalogList
          items={items}
          loading={loading}
          error={error}
          onRowClick={openEdit}
        />
      )}

      {/* Catalog form drawer */}
      <CatalogFormDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        item={editItem}
        category={tab}
        createItem={createItem}
        updateItem={updateItem}
      />

      {/* Berth pricing assigner (berth tab only) */}
      <BerthPricingAssigner
        open={assignerOpen}
        onClose={() => setAssignerOpen(false)}
        onNewRate={openCreateFromAssigner}
        berthRates={items}
      />
    </div>
  );
}
