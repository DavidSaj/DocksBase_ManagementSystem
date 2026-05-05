const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 };
const card = { background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function AlternativesScreen({ state, navigate }) {
  return (
    <div style={page}>
      <div style={card}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>Nearby Availability</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 24px' }}>
          Your exact dates aren&apos;t available — but we found these options:
        </p>

        {state.alternatives.map(alt => (
          <button
            key={`${alt.check_in}_${alt.check_out}`}
            onClick={() =>
              navigate('quote', {
                checkIn: alt.check_in,
                checkOut: alt.check_out,
                quotedPrice: parseFloat(alt.price_per_night),
                quotedTotal: parseFloat(alt.total),
              })
            }
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '14px 16px', marginBottom: 10,
              background: '#f8fafc', border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 8, cursor: 'pointer', fontSize: 15, textAlign: 'left',
            }}
          >
            <span>
              {formatDate(alt.check_in)} – {formatDate(alt.check_out)}
              <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginLeft: 8 }}>
                {alt.nights} night{alt.nights !== 1 ? 's' : ''}
              </span>
            </span>
            <span style={{ fontWeight: 700, color: '#1d4ed8' }}>€{alt.total}</span>
          </button>
        ))}

        <button
          onClick={() => navigate('search')}
          style={{ marginTop: 12, background: 'none', border: 'none', color: 'rgba(0,0,0,0.5)', cursor: 'pointer', fontSize: 14 }}
        >
          ← Try different dates
        </button>
      </div>
    </div>
  );
}
