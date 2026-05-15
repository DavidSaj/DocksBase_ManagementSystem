import useInboundETAs from '../hooks/useInboundETAs.js';

function formatEtaMinutes(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function InboundETACard() {
  const { rows, loading, supported } = useInboundETAs();

  // AIS not configured at the backend (4xx) — hide the card entirely so
  // we don't waste sidebar real estate on marinas that don't subscribe.
  if (!supported) return null;
  // No matched bookings — also hide to keep the screen clean.
  if (!loading && rows.length === 0) return null;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Inbound — AIS</div>
        {!loading && rows.length > 0 && (
          <span className="badge badge-blue">{rows.length}</span>
        )}
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '14px 18px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
            Checking AIS…
          </div>
        ) : (
          rows.map(r => (
            <div key={r.booking_id} style={{
              padding: '12px 18px', borderBottom: 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.vessel_name || r.guest_name}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                  {r.guest_name && r.vessel_name ? r.guest_name : `MMSI ${r.mmsi}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {new Date(r.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)', marginTop: 2 }}>
                  {r.distance_nm} nm · {formatEtaMinutes(r.eta_minutes)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
