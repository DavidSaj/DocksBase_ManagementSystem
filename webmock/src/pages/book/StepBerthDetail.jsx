const AMENITY_LABELS = { power: '⚡ Shore Power', water: '💧 Fresh Water', wifi: '📶 WiFi', fuel: '⛽ Fuel Nearby' };

function PierDiagram({ pier, slipId }) {
  const colors = { A: '#1a6b6e', B: '#162d52', C: '#1e3d6e' };
  const col = colors[pier] || '#1a3d52';
  const slips = { A: ['A1','A2','A3','A4','A5','A6','A7','A8'], B: ['B1','B2','B3','B4','B5','B6','B7','B8'], C: ['C1','C2','C3','C4','C5','C6'] };
  const items = slips[pier] || [];
  return (
    <div className="pier-diagram">
      <div className="pier-diagram-title">Pier {pier} layout</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ width: 12, height: 60, background: col, borderRadius: 3 }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {items.map(s => (
            <div key={s} style={{
              width: 36, height: 24, borderRadius: 3, fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s === slipId ? 'var(--gold)' : 'rgba(255,255,255,0.08)',
              color: s === slipId ? '#fff' : 'rgba(255,255,255,0.35)',
              border: s === slipId ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.06)',
            }}>{s}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StepBerthDetail({ slip, search, onConfirm, onBack }) {
  if (!slip) return null;
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;
  const total = slip.pricePerNight * nights;

  return (
    <div>
      <h2 className="step-title">Slip {slip.id} — Pier {slip.pier}</h2>
      <p className="step-sub">Review details before entering your vessel information.</p>

      <PierDiagram pier={slip.pier} slipId={slip.id} />

      <div className="berth-detail-grid" style={{ marginBottom: 28 }}>
        <div className="detail-card">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 14 }}>Berth specifications</div>
          {[
            ['Slip ID',      slip.id],
            ['Pier',         `Pier ${slip.pier}`],
            ['Max length',   slip.len],
            ['Max draft',    slip.maxDraft],
            ['Price',        `€${slip.pricePerNight} / night`],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-key">{k}</span>
              <span className="detail-val">{v}</span>
            </div>
          ))}
        </div>

        <div className="detail-card">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 14 }}>Your stay</div>
          {[
            ['Arrival',    search?.arrival   || '—'],
            ['Departure',  search?.departure || '—'],
            ['Nights',     nights],
            ['Rate',       `€${slip.pricePerNight} / night`],
            ['Total',      `€${total}`],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-key">{k}</span>
              <span className="detail-val" style={k === 'Total' ? { color: 'var(--gold)', fontSize: 14 } : {}}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Included amenities</div>
        <div className="berth-amenities">
          {(slip.amenities || []).map(a => (
            <span key={a} className="amenity-tag" style={{ fontSize: 11, padding: '5px 10px' }}>{AMENITY_LABELS[a] || a}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={onBack} className="btn-outline">← Back to results</button>
        <button onClick={onConfirm} className="btn-gold">Select this berth →</button>
      </div>
    </div>
  );
}
