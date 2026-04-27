const AMENITY_LABELS = { power: '⚡ Power', water: '💧 Water', wifi: '📶 WiFi', fuel: '⛽ Fuel' };

export default function StepResults({ results, search, onSelect, onBack }) {
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;

  return (
    <div>
      <h2 className="step-title">Available berths.</h2>
      <p className="step-sub">
        {search?.arrival} → {search?.departure} · Vessel {search?.length}m · Draft {search?.draft}m
      </p>
      <div className="results-header">
        <div className="results-count">
          Showing <strong>{results.length} available berths</strong>
          {nights > 1 ? ` · ${nights} nights` : ''}
        </div>
        <button onClick={onBack} className="btn-outline" style={{ fontSize: 11, padding: '7px 14px' }}>← Change search</button>
      </div>

      {results.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
          No berths match your vessel dimensions for those dates.
        </div>
      ) : (
        <div className="berths-grid">
          {results.map(slip => (
            <div key={slip.id} className="berth-card">
              <div className="berth-card-pier">Pier {slip.pier}</div>
              <div className="berth-card-id">Slip {slip.id}</div>
              <div className="berth-card-spec">Max {slip.len} · Draft {slip.maxDraft}</div>
              <div className="berth-amenities">
                {(slip.amenities || []).map(a => (
                  <span key={a} className="amenity-tag">{AMENITY_LABELS[a] || a}</span>
                ))}
              </div>
              <div className="berth-card-footer">
                <div>
                  <div className="berth-price">€{slip.pricePerNight}<span>/night</span></div>
                  {nights > 1 && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                      €{slip.pricePerNight * nights} total
                    </div>
                  )}
                </div>
                <button className="btn-gold" onClick={() => onSelect(slip)} style={{ fontSize: 11, padding: '8px 14px' }}>
                  Select
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
