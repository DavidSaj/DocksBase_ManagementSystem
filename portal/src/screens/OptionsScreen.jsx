const AMENITY_LABELS = {
  power_30a: '⚡ 30A Power',
  power_50a: '⚡ 50A Power',
  water:     '💧 Water',
  wifi:      '📶 WiFi',
  fuel_nearby: '⛽ Fuel Nearby',
  pump_out:  '🔄 Pump-out',
};

const MOORING_LABELS = {
  finger:       'Finger Pontoon',
  alongside:    'Alongside',
  stern_to:     'Stern-to',
  mooring_ball: 'Mooring Ball',
};

export default function OptionsScreen({ state, navigate }) {
  const nights = Math.round(
    (new Date(state.checkOut) - new Date(state.checkIn)) / 86400000
  );

  function handleSelect(cat) {
    navigate('quote', {
      ...state,
      selectedCategory: cat,
      quotedPrice: parseFloat(cat.price_per_night),
      quotedTotal: parseFloat(cat.price_per_night) * nights,
    });
  }

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
      </nav>
      <div className="p-shell">
        <button className="p-btn-outline" onClick={() => navigate('search')} style={{ marginBottom: 28 }}>
          ← Change search
        </button>

        <div className="p-eyebrow">Available options</div>
        <h1 className="p-title">Choose your berth.</h1>
        <p className="p-sub">
          {state.checkIn} → {state.checkOut} · {nights} night{nights !== 1 ? 's' : ''} ·
          Vessel {state.boatLoa}m
        </p>

        <div className="p-options-grid">
          {state.categories.map(cat => (
            <div key={cat.id} className="p-cat-card">
              <div className="p-cat-name">{cat.name}</div>
              <div className="p-cat-mooring">{MOORING_LABELS[cat.mooring_type] ?? cat.mooring_type}</div>
              {cat.description && <p className="p-cat-desc">{cat.description}</p>}
              {cat.amenities.length > 0 && (
                <div className="p-amenity-pills">
                  {cat.amenities.map(a => (
                    <span key={a} className="p-amenity-pill">{AMENITY_LABELS[a] ?? a}</span>
                  ))}
                </div>
              )}
              <div className="p-cat-price">
                €{cat.price_per_night}<span>/night</span>
              </div>
              {nights > 1 && (
                <div className="p-cat-avail">
                  €{(parseFloat(cat.price_per_night) * nights).toFixed(2)} total · {cat.available_count} available
                </div>
              )}
              {nights <= 1 && (
                <div className="p-cat-avail">{cat.available_count} available</div>
              )}
              <button className="p-btn-gold" onClick={() => handleSelect(cat)} style={{ marginTop: 4 }}>
                Select →
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
