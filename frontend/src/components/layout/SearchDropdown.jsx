import Ic from '../ui/Icon.jsx';

// Maps result types to valid icon names from Icon.jsx
const TYPE_ICON = {
  vessel:      'ship',
  member:      'users',       // 'user' not in icon set; 'users' is
  booking:     'calendar',
  berth:       'anchor',
  invoice:     'dollar',      // 'receipt' not in icon set; 'dollar' is closest
  staff:       'clipboard',   // 'id-card' not in icon set; 'clipboard' is closest
  maintenance: 'wrench',
  nav:         'grid',
};

const TYPE_LABEL = {
  vessel:      'Vessels',
  member:      'Members',
  booking:     'Bookings',
  berth:       'Berths',
  invoice:     'Invoices',
  staff:       'Staff',
  maintenance: 'Maintenance',
  nav:         'Navigation',
};

export default function SearchDropdown({ results, loading, onSelect }) {
  if (loading) {
    return (
      <div style={{
        position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
        border: 'var(--border)', borderRadius: 8, boxShadow: 'var(--shadow2)', zIndex: 300,
        padding: '12px 16px', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4,
      }}>
        Searching…
      </div>
    );
  }
  if (!results.length) return null;

  // Group by type
  const groups = {};
  results.forEach(r => {
    if (!groups[r.type]) groups[r.type] = [];
    groups[r.type].push(r);
  });

  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
      border: 'var(--border)', borderRadius: 8, boxShadow: 'var(--shadow2)', zIndex: 300,
      maxHeight: 360, overflowY: 'auto', marginTop: 4,
    }}>
      {Object.entries(groups).map(([type, items]) => (
        <div key={type}>
          <div style={{
            padding: '6px 14px 2px', fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', color: 'rgba(0,0,0,0.38)', letterSpacing: '0.05em',
          }}>
            {TYPE_LABEL[type] || type}
          </div>
          {items.map(item => (
            <div
              key={`${type}-${item.id}`}
              onClick={() => onSelect(item)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Ic n={TYPE_ICON[type] || 'file'} s={12} style={{ opacity: 0.5 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.85)' }}>{item.label}</div>
                {item.sub && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{item.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
