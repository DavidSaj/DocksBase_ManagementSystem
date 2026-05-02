import { useState } from 'react';
import { PIER_TYPES, AMENITY_TYPES } from './mapConstants';
import PrefabLibrary from './PrefabLibrary';

function AccordionSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', background: '#f9fafb', border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}
      >
        {title}
        <span style={{ fontSize: 14, color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export default function AssetPanel({
  // Group A
  activePierType,
  onMaterialSelect,       // (pierType: string) => void — also activates draw-pier tool
  // Group B
  prefabs,
  selectedPier,           // pier object or null
  pierBerths,             // berths for selectedPier
  onSavePrefab,
  onDeletePrefab,
  // Group C
  berths,
  piers,
  // (no extra props needed for Group D — uses dataTransfer)
}) {
  const [berthSearch, setBerthSearch] = useState('');

  // --- Group C: unmapped berths grouped by pier ---
  const unmapped = berths.filter(
    b => b.canvas_x == null &&
    (berthSearch === '' || b.code.toLowerCase().includes(berthSearch.toLowerCase()))
  );
  const byPier = piers.reduce((acc, p) => { acc[p.id] = { pier: p, berths: [] }; return acc; }, {});
  byPier['__none'] = { pier: { code: 'No Dock', label: '' }, berths: [] };
  unmapped.forEach(b => {
    const key = b.pier ?? '__none';
    if (byPier[key]) byPier[key].berths.push(b);
    else byPier['__none'].berths.push(b);
  });
  const berthGroups = Object.values(byPier).filter(g => g.berths.length > 0);

  return (
    <div style={{
      width: 280, flexShrink: 0, borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', background: '#f9fafb', overflowY: 'auto',
    }}>

      {/* Group A — Infrastructure & Terrain */}
      <AccordionSection title="Infrastructure & Terrain">
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PIER_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => onMaterialSelect(t.value)}
              style={{
                padding: '7px 12px', borderRadius: 20, border: `2px solid ${t.color}`,
                cursor: 'pointer', fontSize: 12, fontWeight: 600, textAlign: 'left',
                background: activePierType === t.value ? t.color : 'white',
                color: activePierType === t.value ? 'white' : '#374151',
              }}
            >
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: t.color, marginRight: 8, verticalAlign: 'middle',
                border: activePierType === t.value ? '2px solid white' : 'none',
              }} />
              {t.label}
            </button>
          ))}
        </div>
      </AccordionSection>

      {/* Group B — Smart Prefabs */}
      <AccordionSection title={`Smart Prefabs (${prefabs.length})`}>
        <PrefabLibrary
          prefabs={prefabs}
          selectedPier={selectedPier}
          pierBerths={pierBerths}
          onSavePrefab={onSavePrefab}
          onDeletePrefab={onDeletePrefab}
        />
      </AccordionSection>

      {/* Group C — Unmapped Berths */}
      <AccordionSection title={`Unmapped Berths (${unmapped.length})`}>
        <div style={{ padding: '6px 10px 4px' }}>
          <input
            placeholder="Search…"
            value={berthSearch}
            onChange={e => setBerthSearch(e.target.value)}
            style={{ width: '100%', padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {berthGroups.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>All berths are placed.</div>
          )}
          {berthGroups.map(({ pier, berths: gb }) => (
            <div key={pier.id || '__none'}>
              <div style={{ padding: '5px 12px 2px', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
                {pier.label || pier.code}
              </div>
              {gb.map(berth => (
                <div
                  key={berth.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('berthId', String(berth.id)); e.dataTransfer.effectAllowed = 'move'; }}
                  style={{
                    padding: '5px 12px', margin: '2px 8px',
                    background: 'white', border: '1px solid #e5e7eb',
                    borderRadius: 4, fontSize: 12, fontWeight: 600,
                    cursor: 'grab', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38a860', flexShrink: 0 }} />
                  {berth.code}
                  {berth.length_m && (
                    <span style={{ color: '#9ca3af', fontSize: 10, marginLeft: 'auto' }}>{berth.length_m}m</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Group D — Amenities */}
      <AccordionSection title="Amenities">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: '8px 10px' }}>
          {AMENITY_TYPES.map(t => (
            <div
              key={t.value}
              draggable
              onDragStart={e => { e.dataTransfer.setData('amenityType', t.value); e.dataTransfer.effectAllowed = 'copy'; }}
              style={{
                padding: '6px 4px', background: 'white', border: '1px solid #e5e7eb',
                borderRadius: 6, cursor: 'grab', textAlign: 'center',
                fontSize: 10, color: '#374151', fontWeight: 500,
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 2 }}>⚓</div>
              {t.label}
            </div>
          ))}
        </div>
      </AccordionSection>

    </div>
  );
}
