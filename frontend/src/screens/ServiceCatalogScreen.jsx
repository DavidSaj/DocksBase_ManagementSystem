import { useState } from 'react';
import useServiceCatalog from '../hooks/useServiceCatalog.js';
import Ic from '../components/ui/Icon.jsx';
import CatalogList from './CatalogList.jsx';
import CatalogFormDrawer from './CatalogFormDrawer.jsx';
import BerthPricingAssigner from './BerthPricingAssigner.jsx';

const TABS = [
  { value: 'berth',   label: 'Berth Rates',  addLabel: 'Add Berth Rate'  },
  { value: 'utility', label: 'Utilities',     addLabel: 'Add Utility'     },
  { value: 'service', label: 'Services',      addLabel: 'Add Service'     },
  { value: 'retail',  label: 'Retail & Fuel', addLabel: 'Add Retail Item' },
];

export default function ServiceCatalogScreen() {
  const [tab, setTab]                   = useState('berth');
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [assignerOpen, setAssignerOpen] = useState(false);
  const [editItem, setEditItem]         = useState(null);

  const { items, loading, error, createItem, updateItem } = useServiceCatalog(tab);

  function openCreate() {
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

      {/* List for active tab */}
      <CatalogList
        items={items}
        loading={loading}
        error={error}
        onRowClick={openEdit}
      />

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
