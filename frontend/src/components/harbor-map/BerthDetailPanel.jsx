// frontend/src/components/harbor-map/BerthDetailPanel.jsx
import { useState, useEffect } from 'react'
import api from '../../api.js'

export default function BerthDetailPanel({ berth, onClose }) {
  const [booking, setBooking] = useState(null)
  const [loadingBooking, setLoadingBooking] = useState(false)

  useEffect(() => {
    if (!berth) { setBooking(null); return }
    if (!['occupied', 'reserved'].includes(berth.status)) { setBooking(null); return }

    setLoadingBooking(true)
    api.get('/bookings/', { params: { berth: berth.id, status: 'checked_in' } })
      .then(({ data }) => {
        const results = data.results ?? data
        setBooking(results[0] ?? null)
      })
      .catch(() => setBooking(null))
      .finally(() => setLoadingBooking(false))
  }, [berth?.id])

  if (!berth) return null

  const statusColors = {
    available:   '#1a8c2e',
    occupied:    '#0075de',
    reserved:    '#dd5b00',
    maintenance: '#c0392b',
  }
  const statusColor = statusColors[berth.status] ?? '#888'

  return (
    <div style={{
      width: 280, flexShrink: 0,
      background: '#0c1f3d',
      borderLeft: '1px solid #1e3a5f',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
      fontFamily: 'var(--font)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px',
        borderBottom: '1px solid #1e3a5f',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f0e8d8' }}>
            Berth {berth.code}
          </div>
          <div style={{ fontSize: 11, color: statusColor, marginTop: 2, textTransform: 'capitalize' }}>
            ● {berth.status}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#5a7a9a', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Static berth info */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1e3a5f' }}>
        <Label>Dimensions</Label>
        <Row label="Length"    value={berth.length_m    ? `${berth.length_m}m` : '—'} />
        <Row label="Max Draft" value={berth.max_draft_m ? `${berth.max_draft_m}m` : '—'} />
        <Row label="Max Beam"  value={berth.max_beam_m  ? `${berth.max_beam_m}m` : '—'} />

        {berth.price_per_night && (
          <>
            <Label style={{ marginTop: 10 }}>Pricing</Label>
            <Row label="Per Night" value={`€${berth.price_per_night}`} />
          </>
        )}

        {berth.amenities?.length > 0 && (
          <>
            <Label style={{ marginTop: 10 }}>Amenities</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {berth.amenities.map(a => (
                <span key={a} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 10,
                  background: '#1e3a5f', color: '#a8c8d8', border: '1px solid #2a5a7a',
                }}>
                  {a}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Active booking section */}
      <div style={{ padding: '12px 14px', flex: 1 }}>
        {berth.status === 'available' ? (
          <>
            <div style={{ fontSize: 12, color: '#5a7a9a', marginBottom: 10 }}>No active booking</div>
            <ActionButton href={`/bookings/new?berth=${berth.id}`}>
              Create Booking
            </ActionButton>
          </>
        ) : loadingBooking ? (
          <div style={{ fontSize: 11, color: '#5a7a9a' }}>Loading booking…</div>
        ) : booking ? (
          <>
            <Label>Active Booking</Label>
            <Row label="Vessel"    value={booking.vessel_name ?? booking.guest_name ?? '—'} />
            <Row label="Check In"  value={booking.check_in} />
            <Row label="Check Out" value={booking.check_out} />
            <Row label="Nights"    value={booking.nights} />
            <Row label="Amount"    value={booking.amount ? `€${booking.amount}` : '—'} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              <ActionButton onClick={() => alert('Check-out flow TBD')}>
                Check Out
              </ActionButton>
              <ActionButton secondary href={`/bookings/${booking.id}`}>
                View Full Booking
              </ActionButton>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: '#5a7a9a' }}>No checked-in booking found.</div>
        )}
      </div>
    </div>
  )
}

function Label({ children, style }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.8px', color: '#b8965a', fontWeight: 700, marginBottom: 4, ...style }}>
      {children.toUpperCase()}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: '#7a9ab8' }}>{label}</span>
      <span style={{ color: '#c8d8e8', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function ActionButton({ children, onClick, href, secondary }) {
  const style = {
    display: 'block', textAlign: 'center', textDecoration: 'none',
    padding: '7px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: secondary ? 'transparent' : '#b8965a',
    color: secondary ? '#7a9ab8' : 'white',
    border: secondary ? '1px solid #2a5a7a' : 'none',
    fontFamily: 'var(--font)',
  }
  if (href) return <a href={href} style={style}>{children}</a>
  return <button onClick={onClick} style={style}>{children}</button>
}
