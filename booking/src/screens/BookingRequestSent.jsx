import { HarbourScene, WaveLines } from '../components/HarbourScene';

export default function BookingRequestSent({ marina }) {
  return (
    <div>
      {/* Dark hero */}
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)' }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>

        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Request received</div>
          <h1 className="p-title">We'll be in touch.</h1>
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
              background: 'rgba(184,150,90,0.12)', border: '1.5px solid var(--gold)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: 'var(--gold)',
            }}>
              ✓
            </div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>Request received</div>
            <div style={{ fontFamily: 'var(--font-brand)', fontSize: 16, fontWeight: 600, letterSpacing: 1, color: '#1a1a1a' }}>
              Pending review
            </div>
          </div>

          <div style={{
            background: '#f7f7f7', border: '1px solid #ebebeb',
            borderRadius: 8, padding: '16px 20px',
            fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
          }}>
            The harbour master will review your request and respond within 24 hours. You will receive
            a confirmation email with next steps once approved.
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
