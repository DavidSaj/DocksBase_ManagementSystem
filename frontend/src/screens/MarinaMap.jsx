import { useState } from 'react';
import HarborMap from '../components/harbor-map/HarborMap.jsx';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import useBerths from '../hooks/useBerths.js';
import MapBuilder from '../components/harbor-map/MapBuilder.jsx';

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MarinaMap() {
  const [tab, setTab] = useState('live');
  const [sel, setSel] = useState(null);
  const { piers, counts, loading } = useBerths();

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

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>Loading map…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
              <div>
                <HarborMap piers={piers} selectedSlip={sel} onSelectSlip={setSel} />
                <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                  {[['Occupied','#c6dcf5','#3a7fc8'],['Available','#c2ecce','#38a860'],['Reserved','#f6e7b0','#c89020'],['Maintenance','#f5cccc','#c04040']].map(([l,bg,stroke]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 2, background: bg, border: `1.5px solid ${stroke}` }} />{l}
                    </div>
                  ))}
                </div>
              </div>
              {sel ? (
                <div className="detail">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div className="detail-title">Slip {sel.id}</div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
                  </div>
                  <div className="detail-sub">{sel.len} · {sel.status}</div>
                  <StatusBadge s={sel.status} />
                  <div style={{ marginTop: 14 }}>
                    {sel.vessel
                      ? [['Vessel',sel.vessel],['Owner',sel.owner||'—'],['Type',sel.type||'—'],['Draft',sel.draft||'—']].map(([k,v]) => (
                          <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                        ))
                      : <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Slip is {sel.status}.</div>
                    }
                  </div>
                  <div className="detail-actions">
                    {sel.status === 'available'   && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Book this Slip</button>}
                    {sel.status === 'occupied'    && <><button className="btn btn-primary" style={{ justifyContent: 'center' }}>View Booking</button><button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Check Out</button></>}
                    {sel.status === 'reserved'    && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>View Reservation</button>}
                    {sel.status === 'maintenance' && <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Clear Flag</button>}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', textAlign: 'center', padding: '20px 0', lineHeight: 1.6 }}>
                    Click any slip on the map to view details, make a booking, or check a vessel out.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'creator' && <MapBuilder />}
    </div>
  );
}
