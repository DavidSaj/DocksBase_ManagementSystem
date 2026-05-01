import { useState } from 'react';

const STATUS_LABEL = {
  available:   { label: 'Available',    color: '#38a860', bg: '#c2ecce' },
  occupied:    { label: 'Occupied',     color: '#3a7fc8', bg: '#c6dcf5' },
  reserved:    { label: 'Reserved',     color: '#c89020', bg: '#f6e7b0' },
  maintenance: { label: 'Maintenance',  color: '#c04040', bg: '#f5cccc' },
};

export default function BerthStatusSidebar({ berths = [], onBerthClick, selectedBerthId }) {
  const [filter, setFilter] = useState('all');

  const counts = berths.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  const visible = filter === 'all'
    ? berths
    : berths.filter(b => b.status === filter);

  return (
    <div style={{
      width: 240, flexShrink: 0, borderLeft: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', background: '#fafafa',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#111' }}>
          Berth Status
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(STATUS_LABEL).map(([key, { label, color, bg }]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              style={{
                border: `1px solid ${color}`,
                background: filter === key ? color : bg,
                color: filter === key ? 'white' : color,
                borderRadius: 12, padding: '2px 8px',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {label} {counts[key] || 0}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {visible.length === 0 && (
          <div style={{ padding: '24px 16px', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
            No berths match this filter.
          </div>
        )}
        {visible.map(berth => {
          const { color, bg } = STATUS_LABEL[berth.status] || STATUS_LABEL.available;
          const isSelected = berth.id === selectedBerthId;
          return (
            <button
              key={berth.id}
              onClick={() => onBerthClick?.(berth)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', textAlign: 'left',
                padding: '6px 14px',
                background: isSelected ? '#eff6ff' : 'transparent',
                border: 'none', cursor: 'pointer',
                borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
              }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: color, flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>
                {berth.code}
              </span>
              <span style={{ fontSize: 11, color: '#6b7280', flex: 1, textAlign: 'right' }}>
                {berth.vessel_name || (berth.length_m ? `${berth.length_m}m` : '—')}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{
        padding: '8px 16px', borderTop: '1px solid #e5e7eb',
        fontSize: 11, color: '#6b7280',
      }}>
        {berths.length} berths total
      </div>
    </div>
  );
}
