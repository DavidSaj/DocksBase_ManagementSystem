import { useState } from 'react';
import LiveMap from '../components/harbor-map/LiveMap.jsx';
import BerthCalendar from '../components/harbor-map/BerthCalendar.jsx';

const TABS = [
  { id: 'calendar', label: 'Berth Calendar' },
  { id: 'map',      label: 'Map' },
]

export default function MarinaMap() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [liveBerths, setLiveBerths] = useState([]);
  const [focusBerth, setFocusBerth] = useState(null);

  function handleJumpToMap(berth) {
    setFocusBerth(berth);
    setActiveTab('map');
  }

  const counts = {
    available:   liveBerths.filter(b => (b.effective_status ?? b.status) === 'available').length,
    occupied:    liveBerths.filter(b => (b.effective_status ?? b.status) === 'occupied').length,
    reserved:    liveBerths.filter(b => (b.effective_status ?? b.status) === 'reserved').length,
    maintenance: liveBerths.filter(b => (b.effective_status ?? b.status) === 'maintenance').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', margin: -24, height: 'calc(100% + 48px)', overflow: 'hidden' }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderBottom: 'var(--border)', background: '#fff', flexShrink: 0, paddingLeft: 2 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              fontWeight: 500,
              color: activeTab === tab.id ? 'var(--navy)' : 'rgba(0,0,0,0.45)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--navy)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'color 0.15s',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}

        {/* Status badges — only shown on map tab */}
        {activeTab === 'map' && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', paddingRight: 16, alignItems: 'center' }}>
            {[
              ['Occupied',    counts.occupied,    'badge-blue'],
              ['Available',   counts.available,   'badge-green'],
              ['Reserved',    counts.reserved,    'badge-gold'],
              ['Maintenance', counts.maintenance, 'badge-red'],
            ].map(([l, c, b]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span className={`badge ${b}`}>{c}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.5)' }}>{l}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Map tab — always mounted so WebSocket stays connected */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'map' ? 'flex' : 'none', flexDirection: 'column' }}>
          <LiveMap onBerthsChange={setLiveBerths} focusBerth={focusBerth} />

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, padding: '6px 14px', borderTop: 'var(--border)', background: '#fff', flexShrink: 0, flexWrap: 'wrap' }}>
            {[
              ['Occupied',    '#dbeeff', '#0075de'],
              ['Available',   '#c2ecce', '#1a8c2e'],
              ['Reserved',    '#f6e7b0', '#b8965a'],
              ['Maintenance', '#f5cccc', '#c0392b'],
            ].map(([l, bg, stroke]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: bg, border: `1.5px solid ${stroke}` }} />{l}
              </div>
            ))}
          </div>
        </div>

        {/* Calendar tab */}
        {activeTab === 'calendar' && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <BerthCalendar onJumpToMap={handleJumpToMap} />
          </div>
        )}
      </div>
    </div>
  );
}
