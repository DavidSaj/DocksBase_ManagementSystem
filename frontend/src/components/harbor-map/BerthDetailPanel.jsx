// frontend/src/components/harbor-map/BerthDetailPanel.jsx
import { useState, useEffect } from 'react'
import api from '../../api.js'

export default function BerthDetailPanel({ berth, onClose }) {
  const [booking, setBooking] = useState(null)
  const [loadingBooking, setLoadingBooking] = useState(false)

  useEffect(() => {
    if (!berth) { setBooking(null); return }
    if (!['occupied', 'reserved'].includes(berth.status)) { setBooking(null); return }

    const controller = new AbortController()
    setLoadingBooking(true)
    api.get('/bookings/', { params: { berth: berth.id, status: 'checked_in' }, signal: controller.signal })
      .then(({ data }) => {
        const results = data.results ?? data
        setBooking(results[0] ?? null)
        setLoadingBooking(false)
      })
      .catch(err => {
        if (err.name !== 'CanceledError') {
          setBooking(null)
          setLoadingBooking(false)
        }
      })

    return () => controller.abort()
  }, [berth?.id, berth?.status])

  if (!berth) return null

  const STATUS_COLOR = {
    available:   'var(--green)',
    occupied:    'var(--blue)',
    reserved:    'var(--orange)',
    maintenance: 'var(--red)',
  }
  const STATUS_BADGE = {
    available:   'badge-green',
    occupied:    'badge-blue',
    reserved:    'badge-gold',
    maintenance: 'badge-red',
  }
  const statusColor = STATUS_COLOR[berth.status] ?? '#888'

  return (
    <div style={{
      width: 280, flexShrink: 0,
      background: 'var(--white)',
      borderLeft: 'var(--border)',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
      fontFamily: 'var(--font)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: 'var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>
            Berth {berth.code}
          </div>
          <div style={{ fontSize: 11, color: statusColor, marginTop: 3 }}>
            <span className={`badge ${STATUS_BADGE[berth.status] ?? 'badge-gray'}`}>{berth.status}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(0,0,0,0.35)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}
        >
          ×
        </button>
      </div>

      {/* Dimensions */}
      <div style={{ padding: '12px 16px', borderBottom: 'var(--border)' }}>
        <SectionLabel>Dimensions</SectionLabel>
        <Row label="Length"    value={berth.length_m    ? `${berth.length_m} m` : '—'} />
        <Row label="Max Draft" value={berth.max_draft_m ? `${berth.max_draft_m} m` : '—'} />
        <Row label="Max Beam"  value={berth.max_beam_m  ? `${berth.max_beam_m} m` : '—'} />

        {berth.price_per_night && (
          <>
            <SectionLabel style={{ marginTop: 12 }}>Pricing</SectionLabel>
            <Row label="Per Night" value={`€${Number(berth.price_per_night).toFixed(2)}`} />
          </>
        )}

        {berth.amenities?.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 12 }}>Amenities</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {berth.amenities.map(a => (
                <span key={a} className="badge badge-teal" style={{ fontSize: 10 }}>{a}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Booking */}
      <div style={{ padding: '12px 16px', flex: 1 }}>
        {berth.status === 'available' ? (
          <>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>No active booking.</div>
            <button className="btn btn-primary btn-sm" style={{ width: '100%' }}>
              Create Booking
            </button>
          </>
        ) : loadingBooking ? (
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>Loading booking…</div>
        ) : booking ? (
          <>
            <SectionLabel>Active Booking</SectionLabel>
            <Row label="Vessel"    value={booking.vessel_name ?? booking.guest_name ?? '—'} />
            <Row label="Check In"  value={booking.check_in} />
            <Row label="Check Out" value={booking.check_out} />
            <Row label="Nights"    value={booking.nights} />
            <Row label="Amount"    value={booking.amount ? `€${Number(booking.amount).toFixed(2)}` : '—'} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }}>Check Out</button>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }}>View Booking</button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>No checked-in booking found.</div>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.8px', color: 'var(--gold)', fontWeight: 700, marginBottom: 6, ...style }}>
      {String(children).toUpperCase()}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
      <span style={{ color: 'rgba(0,0,0,0.45)' }}>{label}</span>
      <span style={{ color: 'rgba(0,0,0,0.75)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}
