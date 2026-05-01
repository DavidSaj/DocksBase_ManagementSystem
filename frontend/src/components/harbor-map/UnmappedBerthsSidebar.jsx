import { useState } from 'react';

export default function UnmappedBerthsSidebar({ berths = [], piers = [] }) {
  const [search, setSearch] = useState('');

  const unmapped = berths.filter(
    b => b.canvas_x == null &&
    (search === '' || b.code.toLowerCase().includes(search.toLowerCase()))
  );

  const byPier = piers.reduce((acc, p) => {
    acc[p.id] = { pier: p, berths: [] };
    return acc;
  }, {});
  byPier['__none'] = { pier: { code: 'No Dock', label: '' }, berths: [] };
  unmapped.forEach(b => {
    const key = b.pier ?? '__none';
    if (byPier[key]) byPier[key].berths.push(b);
    else byPier['__none'].berths.push(b);
  });

  const groups = Object.values(byPier).filter(g => g.berths.length > 0);

  return (
    <div style={{
      width: 200, flexShrink: 0, borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', background: '#f9fafb',
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', marginBottom: 6 }}>
          Unmapped Berths
        </div>
        <input
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '4px 8px', fontSize: 12,
            border: '1px solid #d1d5db', borderRadius: 4, boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groups.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
            All berths are placed.
          </div>
        )}
        {groups.map(({ pier, berths: gb }) => (
          <div key={pier.id}>
            <div style={{
              padding: '6px 12px 2px', fontSize: 10, fontWeight: 700,
              color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {pier.label || pier.code}
            </div>
            {gb.map(berth => (
              <div
                key={berth.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('berthId', String(berth.id));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                style={{
                  padding: '5px 12px', margin: '2px 8px',
                  background: 'white', border: '1px solid #e5e7eb',
                  borderRadius: 4, fontSize: 12, fontWeight: 600,
                  cursor: 'grab', color: '#111',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#38a860', flexShrink: 0,
                }} />
                {berth.code}
                {berth.length_m && (
                  <span style={{ color: '#9ca3af', fontSize: 10, marginLeft: 'auto' }}>
                    {berth.length_m}m
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{
        padding: '6px 12px', borderTop: '1px solid #e5e7eb',
        fontSize: 10, color: '#9ca3af',
      }}>
        {unmapped.length} unmapped — drag to canvas
      </div>
    </div>
  );
}
