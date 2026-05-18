import { HarbourScene, WaveLines } from '../components/HarbourScene';

export default function ReservationConfirmedScreen({ state, marina }) {
  const isPending = state.reservationStatus === 'pending_review';
  const marinaName = marina?.name || 'Your Marina';
  const contactEmail = marina?.contact_email || '';
  const contactPhone = marina?.phone || '';

  return (
    <div>
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
          <div className="p-eyebrow">{isPending ? 'Request received' : 'Reservation confirmed'}</div>
          <h1 className="p-title">{isPending ? "We'll be in touch." : "You're all set."}</h1>
        </div>
        <HarbourScene />
      </div>

      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />
        <div style={{ maxWidth: 560, margin: '-40px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>
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
            }}>✓</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 6, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Your reference
            </div>
            <div style={{ fontSize: 28, fontFamily: 'var(--font-brand)', fontWeight: 700, color: 'var(--navy)', letterSpacing: '2px' }}>
              {state.reservationReference}
            </div>
          </div>

          <div style={{
            background: '#f7f7f7', border: '1px solid #ebebeb',
            borderRadius: 8, padding: '16px 20px',
            fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
            marginBottom: 12,
          }}>
            {isPending ? (
              <>
                Your reservation request has been received. The harbour master will review it
                and you'll receive an email once your berths are assigned. Keep your reference
                handy — you can use it along with your email address to check your status.
              </>
            ) : (
              <>
                A confirmation email is on its way — it includes your berth assignment,
                arrival details, and a personal boarding pass link for digital check-in.
                If you don't see it within a few minutes, check your spam folder.
              </>
            )}
          </div>

          {(contactEmail || contactPhone) && (
            <div style={{
              border: '1px solid #e8e8e8', borderRadius: 8, padding: '14px 20px',
              fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
            }}>
              <span style={{ fontWeight: 600, color: '#1a1a1a' }}>Questions?</span>{' '}
              Contact {marinaName} directly
              {contactEmail && <> at <a href={`mailto:${contactEmail}`} style={{ color: '#1a1a1a' }}>{contactEmail}</a></>}
              {contactEmail && contactPhone && ' or '}
              {contactPhone && <><a href={`tel:${contactPhone}`} style={{ color: '#1a1a1a' }}>{contactPhone}</a></>}
              .
            </div>
          )}
        </div>
        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
