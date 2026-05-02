import { useState } from 'react';
import LiveMap from '../components/harbor-map/LiveMap.jsx';
import Ic from '../components/ui/Icon.jsx';
import useBerths from '../hooks/useBerths.js';
import MapBuilder from '../components/harbor-map/MapBuilder.jsx';

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MarinaMap() {
  const [tab, setTab] = useState('live');
  const { counts, loading } = useBerths();

  return (
    <div>
      <div className="tabs">
        {[['live','Marina Map'],['creator','Map Creator']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'live' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['Occupied',counts.occupied,'badge-blue'],['Available',counts.available,'badge-green'],['Reserved',counts.reserved,'badge-gold'],['Maintenance',counts.maintenance,'badge-red']].map(([l,c,b]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: 'var(--border)', borderRadius: 8, padding: '8px 14px' }}>
                <span className={`badge ${b}`}>{loading ? '…' : c}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.6)' }}>{l}</span>
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }}><Ic n="plus" s={12} />New Booking</button>
          </div>

          <div>
            <LiveMap />
            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              {[['Occupied','#c6dcf5','#3a7fc8'],['Available','#c2ecce','#38a860'],['Reserved','#f6e7b0','#c89020'],['Maintenance','#f5cccc','#c04040']].map(([l,bg,stroke]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: bg, border: `1.5px solid ${stroke}` }} />{l}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'creator' && <MapBuilder />}
    </div>
  );
}
