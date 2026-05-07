import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

export default function BookingConfirmed({ marina, bookingId, cancelled }) {
  const slug = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
  const marinaName = marina?.name || 'Your Marina';

  return (
    <div>
      {/* Dark hero */}
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)' }}>
            {marinaName}
          </span>
        </nav>

        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">{cancelled ? 'Payment not completed' : 'Booking confirmed'}</div>
          <h1 className="p-title">{cancelled ? 'No charge was made.' : 'You\'re all set.'}</h1>
        </div>

        <HarbourScene />
      </div>

      {/* White section */}
      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />

        <div style={{ maxWidth: 560, margin: '-40px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>

          {/* Confirmation card */}
          <div style={{
            background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10,
            padding: '36px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
            textAlign: 'center', marginBottom: 16,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', margin: '0 auto 16px',
              background: cancelled ? 'rgba(220,38,38,0.07)' : 'rgba(184,150,90,0.12)',
              border: `1.5px solid ${cancelled ? '#dc2626' : 'var(--gold)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: cancelled ? '#dc2626' : 'var(--gold)',
            }}>
              {cancelled ? '✕' : '✓'}
            </div>

            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>
              {cancelled ? 'Payment cancelled' : 'Booking confirmed'}
            </div>

            {!cancelled && bookingId && (
              <div style={{
                fontFamily: 'var(--font-brand)', fontSize: 22, fontWeight: 700,
                letterSpacing: 3, color: '#1a1a1a',
              }}>
                #{bookingId}
              </div>
            )}
          </div>

          {cancelled ? (
            <>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 24, textAlign: 'center' }}>
                Your payment was not completed and no charge was made.
              </p>
              <div style={{ textAlign: 'center' }}>
                <a href={`/${slug}`} className="p-btn-gold">Try again</a>
              </div>
            </>
          ) : (
            <div style={{
              background: '#f7f7f7', border: '1px solid #ebebeb',
              borderRadius: 8, padding: '16px 20px',
              fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
            }}>
              A confirmation email is on its way — it includes your berth assignment,
              arrival details, and a personal boarding pass link for digital check-in.
              If you don't see it within a few minutes, check your spam folder or contact the marina directly.
            </div>
          )}
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
