import { useState } from 'react';
import useServiceCatalog from '../hooks/useServiceCatalog.js';
import Ic from '../components/ui/Icon.jsx';
import CatalogList from './CatalogList.jsx';
import CatalogFormDrawer from './CatalogFormDrawer.jsx';

const TABS = [
  { value: 'berth',   label: 'Berth Rates' },
  { value: 'utility', label: 'Utilities' },
  { value: 'service', label: 'Services' },
  { value: 'retail',  label: 'Retail & Fuel' },
];

export default function ServiceCatalogScreen() {
  const [tab, setTab]         = useState('berth');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem]     = useState(null);

  // We need createItem/updateItem — hook is keyed to current tab category
  const { createItem, updateItem } = useServiceCatalog(tab);

  function openCreate() {
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

  return (
    <div>
      {/* Page header */}
      <div className="sec-hdr" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)' }}>Service Catalog</div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Ic n="plus" s={12} />
          New Pricing Rule
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
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

      {/* List for active tab */}
      <CatalogList
        category={tab}
        onRowClick={openEdit}
      />

      {/* Drawer */}
      <CatalogFormDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        item={editItem}
        createItem={createItem}
        updateItem={updateItem}
      />
    </div>
  );
}
