import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

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

export default function OptionsScreen({ state, navigate, marina }) {
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
    <div>
      {/* Dark hero */}
      <div className="p-hero" style={{ minHeight: 380 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline" onClick={() => navigate('search')}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>

        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Available options</div>
          <h1 className="p-title">Choose your berth.</h1>
          <p className="p-sub">
            {state.checkIn} → {state.checkOut} · {nights} night{nights !== 1 ? 's' : ''}
            {state.boatLoa ? ` · Vessel ${state.boatLoa}m` : ''}
          </p>
        </div>

        <HarbourScene />
      </div>

      {/* White section */}
      <div style={{ position: 'relative', background: '#fff' }}>
        <WaveLines />

        <div style={{ maxWidth: 880, margin: '-36px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>
          <div className="p-options-grid">
            {state.categories.map(cat => (
              <div key={cat.id} className="p-cat-card-light">
                <div className="p-cat-name" style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600 }}>{cat.name}</div>
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
                <div className="p-cat-avail">
                  {nights > 1 && `€${(parseFloat(cat.price_per_night) * nights).toFixed(2)} total · `}
                  {cat.available_count} available
                </div>
                <button className="p-btn-gold" onClick={() => handleSelect(cat)} style={{ marginTop: 4 }}>
                  Select →
                </button>
              </div>
            ))}
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
