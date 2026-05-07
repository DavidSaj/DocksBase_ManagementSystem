import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function AlternativesScreen({ state, navigate, marina }) {
  return (
    <div>
      {/* Dark hero */}
      <div className="p-hero" style={{ minHeight: 320 }}>
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
          <div className="p-eyebrow">Nearby availability</div>
          <h1 className="p-title">Adjust your dates.</h1>
          <p className="p-sub">Your exact dates aren&apos;t available — here are similar options.</p>
        </div>

        <HarbourScene />
      </div>

      {/* White section */}
      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />

        <div style={{ maxWidth: 640, margin: '-40px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>
          <div style={{
            background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10,
            padding: '32px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
          }}>
            {state.alternatives.map(alt => (
              <button
                key={`${alt.check_in}_${alt.check_out}`}
                onClick={() => navigate('quote', {
                  checkIn:  alt.check_in,
                  checkOut: alt.check_out,
                  boatLoa:   state.boatLoa,
                  boatBeam:  state.boatBeam,
                  boatDraft: state.boatDraft,
                  quotedPrice: parseFloat(alt.price_per_night),
                  quotedTotal: parseFloat(alt.total),
                  selectedCategory: null,
                  fromScreen: 'alternatives',
                })}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  width: '100%', padding: '14px 16px', marginBottom: 10,
                  background: '#f8fafc', border: '1px solid rgba(0,0,0,0.10)',
                  borderRadius: 8, cursor: 'pointer', fontSize: 15, textAlign: 'left',
                }}
              >
                <span>
                  <span style={{ color: '#1a1a1a', fontWeight: 500 }}>
                    {formatDate(alt.check_in)} – {formatDate(alt.check_out)}
                  </span>
                  <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginLeft: 10 }}>
                    {alt.nights} night{alt.nights !== 1 ? 's' : ''}
                  </span>
                </span>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>
                  €{parseFloat(alt.total).toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
