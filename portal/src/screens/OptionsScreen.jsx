import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const AMENITY_LABELS = {
  power_30a:   '30A Power',
  power_50a:   '50A Power',
  water:       'Water',
  wifi:        'WiFi',
  fuel_nearby: 'Fuel Nearby',
  pump_out:    'Pump-out',
};

const AMENITY_ICONS = {
  power_30a: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  power_50a: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  water: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
    </svg>
  ),
  wifi: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
      <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  ),
  fuel_nearby: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="22" x2="15" y2="22"/>
      <line x1="4" y1="9" x2="14" y2="9"/>
      <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/>
      <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>
    </svg>
  ),
  pump_out: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <polyline points="23 20 23 14 17 14"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
  ),
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
      <div className="p-hero" style={{ minHeight: 360 }}>
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
      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />

        <div style={{ maxWidth: 880, margin: '-36px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>
          <div className="p-options-grid">
            {state.categories.map(cat => (
              <div key={cat.id ?? '__uncat'} className="p-cat-card-light">
                {/* Left body */}
                <div className="p-cat-card-body">
                  {cat.tier_note && (
                    <div style={{ fontSize: 11, color: '#b8965a', fontWeight: 600, letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                      {cat.tier_note}
                    </div>
                  )}
                  <div className="p-cat-name">{cat.name}</div>
                  {cat.tagline && <div className="p-cat-tagline">{cat.tagline}</div>}
                  {cat.mooring_type && (
                    <div className="p-cat-mooring">{MOORING_LABELS[cat.mooring_type] ?? cat.mooring_type}</div>
                  )}
                  {cat.description && <p className="p-cat-desc">{cat.description}</p>}
                  {cat.highlights?.length > 0 && (
                    <ul className="p-cat-highlights">
                      {cat.highlights.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  )}
                  {cat.amenities.length > 0 && (
                    <div className="p-amenity-pills" style={{ marginTop: 4 }}>
                      {cat.amenities.map(a => (
                        <span key={a} className="p-amenity-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {AMENITY_ICONS[a]}
                          {AMENITY_LABELS[a] ?? a}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right sidebar */}
                <div className="p-cat-card-sidebar">
                  <div>
                    <div className="p-cat-price">
                      €{cat.price_per_night}
                      <span>/night</span>
                    </div>
                    {nights > 1 && (
                      <div className="p-cat-avail">€{(parseFloat(cat.price_per_night) * nights).toFixed(2)} total</div>
                    )}
                    <div className="p-cat-avail" style={{ marginTop: 6 }}>{cat.available_count} berth{cat.available_count !== 1 ? 's' : ''} available</div>
                  </div>
                  <button className="p-btn-gold" onClick={() => handleSelect(cat)} style={{ marginTop: 16, whiteSpace: 'nowrap' }}>
                    Select →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
