import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import useBerths from '../../hooks/useBerths.js'
import useBookings from '../../hooks/useBookings.js'

const STATUS_COLOR = {
  confirmed:        { bg: '#dbeeff', border: '#0075de', text: '#004fa3' },
  pending:          { bg: '#f6e7b0', border: '#b8965a', text: '#7a5c00' },
  awaiting_payment: { bg: '#f6e7b0', border: '#b8965a', text: '#7a5c00' },
  pending_payment:  { bg: '#f6e7b0', border: '#b8965a', text: '#7a5c00' },
  checked_in:       { bg: '#c2ecce', border: '#1a8c2e', text: '#0f5c1c' },
  overstay:         { bg: '#f5cccc', border: '#c0392b', text: '#8b0000' },
  checked_out:      { bg: '#ececec', border: '#aaa',    text: '#555' },
  cancelled:        { bg: '#ececec', border: '#ccc',    text: '#999' },
}

const STATUS_LABEL = {
  confirmed: 'Confirmed', pending: 'Pending', awaiting_payment: 'Awaiting Payment',
  pending_payment: 'Pending Payment', checked_in: 'Checked In',
  overstay: 'Overstay', checked_out: 'Checked Out', cancelled: 'Cancelled',
}

const PERIODS = [
  { id: '7',     label: '7 days',  days: 7 },
  { id: '14',    label: '14 days', days: 14 },
  { id: '30',    label: '30 days', days: 30 },
  { id: 'month', label: 'Month',   days: null },
]

const COL_W  = 38  // px per day column
const ROW_H  = 32  // px per berth row
const MIN_LABEL_W = 60
const MAX_LABEL_W = 260

// Use berth_type if set; otherwise derive from the alphabetic prefix of the code
// so berths named "Small1", "Small2" automatically appear as type "Small".
function berthDisplayType(berth) {
  if (berth.berth_type) return berth.berth_type
  const m = (berth.code || '').match(/^([A-Za-z]+)/)
  return m ? m[1] : ''
}

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function isoDate(d) { return d.toISOString().slice(0, 10) }

function buildDays(anchor, period) {
  const start = startOfDay(anchor)
  if (period.days) return Array.from({ length: period.days }, (_, i) => addDays(start, i))
  const first = new Date(start.getFullYear(), start.getMonth(), 1)
  const last  = new Date(start.getFullYear(), start.getMonth() + 1, 0)
  const days = []
  for (let d = new Date(first); d <= last; d = addDays(d, 1)) days.push(new Date(d))
  return days
}

function periodForWidth(availW) {
  const days = Math.floor(availW / COL_W)
  if (days >= 31) return PERIODS[3]  // month
  if (days >= 28) return PERIODS[2]  // 30 days
  if (days >= 14) return PERIODS[1]  // 14 days
  return PERIODS[0]                   // 7 days
}

// ── Booking detail modal ────────────────────────────────────────────────────

function Field({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.8)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function BookingDetailModal({ booking, berth, onClose, onJumpToMap }) {
  const col = STATUS_COLOR[booking.status] ?? STATUS_COLOR.confirmed
  const guestOrVessel = booking.vessel_name || booking.guest_name || '—'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 520, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.22)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: 'var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--navy)' }}>{guestOrVessel}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 3 }}>
              Berth {booking.berth_code || berth?.code} · {booking.check_in} → {booking.check_out} · {booking.nights} night{booking.nights !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
              background: col.bg, border: `1px solid ${col.border}`, color: col.text,
            }}>
              {STATUS_LABEL[booking.status] || booking.status}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 16, lineHeight: 1, padding: '3px 8px' }}>×</button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Guest / vessel info */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Guest / Vessel</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
              <Field label="Vessel" value={booking.vessel_name} />
              <Field label="Owner"  value={booking.owner_name} />
              <Field label="Guest name"  value={booking.guest_name} />
              <Field label="Email"       value={booking.guest_email} />
              <Field label="Phone"       value={booking.guest_phone} />
              <Field label="Booking type" value={booking.booking_type} />
            </div>
          </section>

          {/* Boat specs */}
          {(booking.boat_loa || booking.boat_beam) && (
            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Boat Dimensions</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                <Field label="LOA"  value={booking.boat_loa  ? `${booking.boat_loa}m`  : null} />
                <Field label="Beam" value={booking.boat_beam ? `${booking.boat_beam}m` : null} />
              </div>
            </section>
          )}

          {/* Stay details */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Stay Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
              <Field label="Check-in"  value={booking.check_in} />
              <Field label="Check-out" value={booking.check_out} />
              <Field label="Nights"    value={booking.nights} />
              <Field label="Amount"    value={booking.amount != null ? `€${Number(booking.amount).toFixed(2)}` : null} />
              <Field label="Paid"      value={booking.paid ? 'Yes' : 'No'} />
            </div>
          </section>

          {/* Notes */}
          {booking.notes && (
            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>Notes</div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.7)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg)', borderRadius: 7 }}>{booking.notes}</div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: 'var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          {berth?.local_x != null && (
            <button className="btn btn-primary btn-sm" onClick={() => { onJumpToMap?.(berth); onClose() }}>
              <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="5" r="3.5" /><path d="M7.5 7.5L10.5 10.5" /><path d="M5 3v2h2" />
              </svg>
              Jump to Map
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Berth detail modal (from clicking the label) ────────────────────────────

function BerthDetailModal({ berth, bookings, onClose, onJumpToMap, onSelectBooking }) {
  const berthBookings = bookings
    .filter(bk => bk.berth === berth.id && bk.status !== 'cancelled')
    .sort((a, b) => a.check_in.localeCompare(b.check_in))

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, padding: 28, width: 480, maxWidth: '90vw', maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Berth {berth.code}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
              {[berth.length_m && `${berth.length_m}m LOA`, berth.max_beam_m && `${berth.max_beam_m}m beam`, berth.max_draft_m && `${berth.max_draft_m}m draft`].filter(Boolean).join(' · ') || 'No dimensions recorded'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 16, lineHeight: 1, padding: '4px 8px' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 20, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8 }}>
          {[['Status', berth.status], ['Side', berth.side || '—'], ['Pier', berth.pier_code || '—'], ['Amenities', berth.amenities?.length ? berth.amenities.join(', ') : 'None']].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.8)', marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(0,0,0,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Bookings</div>
        {berthBookings.length === 0 ? (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>No active bookings</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {berthBookings.map(bk => {
              const col = STATUS_COLOR[bk.status] ?? STATUS_COLOR.confirmed
              return (
                <div
                  key={bk.id}
                  onClick={() => onSelectBooking(bk)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 7, background: col.bg, border: `1px solid ${col.border}`, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {bk.vessel_name || bk.guest_name || 'Unknown vessel'}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 1 }}>{bk.check_in} → {bk.check_out} · {bk.nights} nights</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: col.text, background: 'rgba(255,255,255,0.6)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
                    {STATUS_LABEL[bk.status] || bk.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: 'var(--border)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          {berth.local_x != null && (
            <button className="btn btn-primary btn-sm" onClick={() => { onJumpToMap?.(berth); onClose() }}>
              <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="5" r="3.5" /><path d="M7.5 7.5L10.5 10.5" /><path d="M5 3v2h2" />
              </svg>
              Jump to Map
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main calendar ───────────────────────────────────────────────────────────

export default function BerthCalendar({ onJumpToMap, initialFrom = '', initialTo = '', initialLoa = '', initialAvailOnly = false, onSelectBerth }) {
  const { berths, loading: berthsLoading } = useBerths()
  const { bookings, loading: bookingsLoading } = useBookings()

  const [period, setPeriod]             = useState(PERIODS[2])
  // In picker mode shift 7 days back so the range isn't flush-left and can be centred
  const [anchor, setAnchor]             = useState(() =>
    initialFrom
      ? startOfDay(addDays(new Date(initialFrom + 'T00:00:00'), -7))
      : startOfDay(new Date())
  )
  const [searchFrom, setSearchFrom]     = useState(initialFrom)
  const [searchTo,   setSearchTo]       = useState(initialTo)
  const [filterType, setFilterType]     = useState('all')
  const [filterAvailOnly, setFilterAvailOnly] = useState(initialAvailOnly)
  const [boatLoa,    setBoatLoa]        = useState(initialLoa ? String(initialLoa) : '')
  const [selectedBerth,   setSelectedBerth]   = useState(null)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [labelWidth, setLabelWidth]     = useState(100)
  const [hoveredBerthId, setHoveredBerthId]   = useState(null)

  const gridRef       = useRef(null)
  const resizeDrag    = useRef(null)
  const labelWidthRef = useRef(labelWidth)
  const panDrag       = useRef(null)

  const today = useMemo(() => isoDate(new Date()), [])

  // Keep ref current so ResizeObserver always reads the latest labelWidth
  useEffect(() => { labelWidthRef.current = labelWidth }, [labelWidth])

  // ── Adaptive period based on container width ──────────────────────────────
  // useLayoutEffect fires before paint so getBoundingClientRect is reliable
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w > 0) setPeriod(periodForWidth(w - labelWidthRef.current))
  }, []) // initial measurement only

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w > 0) setPeriod(periodForWidth(w - labelWidthRef.current))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Recalculate when user drags label column wider/narrower
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w > 0) setPeriod(periodForWidth(w - labelWidth))
  }, [labelWidth])

  // Centre the pre-seeded date range when the calendar opens in picker mode
  useEffect(() => {
    if (!onSelectBerth || !initialFrom || !gridRef.current) return
    const el = gridRef.current
    const id = requestAnimationFrame(() => {
      const rangeDays = initialTo
        ? Math.max(0, Math.round((new Date(initialTo) - new Date(initialFrom)) / 86400000))
        : 0
      // anchor was shifted -7 days, so initialFrom is at column index 7
      const rangeMidPx = labelWidthRef.current + (7 + rangeDays / 2) * COL_W
      el.scrollLeft = Math.max(0, rangeMidPx - el.clientWidth / 2)
    })
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse-wheel horizontal scroll (vertical wheel → scroll left/right) ────
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    function onWheel(e) {
      // Trackpad: honour native deltaX; mouse wheel: remap deltaY → horizontal
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // trackpad horizontal — let browser handle
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Click-drag panning ────────────────────────────────────────────────────
  const onGridPointerDown = useCallback((e) => {
    // Only the plain grid background — not booking bars, berth labels, or resizers
    if (e.target.closest('[data-interactive]')) return
    if (e.button !== 0) return
    panDrag.current = {
      startX: e.clientX, startY: e.clientY,
      scrollLeft: gridRef.current.scrollLeft,
      scrollTop:  gridRef.current.scrollTop,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onGridPointerMove = useCallback((e) => {
    if (!panDrag.current) return
    const dx = e.clientX - panDrag.current.startX
    const dy = e.clientY - panDrag.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panDrag.current.moved = true
    if (!panDrag.current.moved) return
    gridRef.current.scrollLeft = panDrag.current.scrollLeft - dx
    gridRef.current.scrollTop  = panDrag.current.scrollTop  - dy
  }, [])

  const onGridPointerUp = useCallback(() => { panDrag.current = null }, [])

  // ── Resizable label column ────────────────────────────────────────────────
  const onResizerPointerDown = useCallback((e) => {
    e.preventDefault()
    resizeDrag.current = { startX: e.clientX, startW: labelWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [labelWidth])

  const onResizerPointerMove = useCallback((e) => {
    if (!resizeDrag.current) return
    const dx  = e.clientX - resizeDrag.current.startX
    const newW = Math.max(MIN_LABEL_W, Math.min(MAX_LABEL_W, resizeDrag.current.startW + dx))
    setLabelWidth(newW)
  }, [])

  const onResizerPointerUp = useCallback(() => { resizeDrag.current = null }, [])

  // ── Data ──────────────────────────────────────────────────────────────────
  const days = useMemo(() => buildDays(anchor, period), [anchor, period])

  const bookingsByBerth = useMemo(() => {
    const map = {}
    for (const bk of bookings) {
      if (bk.status === 'cancelled') continue
      if (!map[bk.berth]) map[bk.berth] = []
      map[bk.berth].push(bk)
    }
    return map
  }, [bookings])

  const berthById = useMemo(() => Object.fromEntries(berths.map(b => [b.id, b])), [berths])

  const berthTypes = useMemo(() =>
    [...new Set(berths.map(b => berthDisplayType(b)).filter(Boolean))].sort(),
    [berths]
  )

  function isBerthFreeInRange(berth, from, to) {
    if (!from || !to) return true
    return !(bookingsByBerth[berth.id] ?? []).some(bk => {
      if (bk.status === 'cancelled' || bk.status === 'checked_out') return false
      return bk.check_in < to && bk.check_out > from
    })
  }

  const filteredBerths = useMemo(() => {
    let list = [...berths]
    if (filterType !== 'all') {
      list = list.filter(b => berthDisplayType(b) === filterType)
    }
    if (filterAvailOnly && searchFrom && searchTo) {
      list = list.filter(b => isBerthFreeInRange(b, searchFrom, searchTo))
    }
    const loa = parseFloat(boatLoa)
    if (boatLoa && !isNaN(loa)) {
      list.sort((a, b) => {
        const aLen = parseFloat(a.length_m) || 0
        const bLen = parseFloat(b.length_m) || 0
        const aFits = aLen >= loa
        const bFits = bLen >= loa
        if (aFits !== bFits) return aFits ? -1 : 1
        return aLen - bLen
      })
    } else {
      list.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
    }
    return list
  }, [berths, filterType, filterAvailOnly, searchFrom, searchTo, bookingsByBerth, boatLoa])

  // ── Navigation ────────────────────────────────────────────────────────────
  function navPrev() {
    if (period.days) setAnchor(a => addDays(a, -period.days))
    else setAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1))
  }
  function navNext() {
    if (period.days) setAnchor(a => addDays(a, period.days))
    else setAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1))
  }

  const rangeLabel = useMemo(() => {
    if (!days.length) return ''
    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    if (period.id === 'month') return days[0].toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    return `${fmt(days[0])} – ${fmt(days[days.length - 1])}`
  }, [days, period])

  // ── Render ────────────────────────────────────────────────────────────────
  if (berthsLoading || bookingsLoading) {
    return <div style={{ padding: 40, color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>Loading calendar…</div>
  }

  const windowStart = days.length ? isoDate(days[0]) : ''
  const windowEnd   = days.length ? isoDate(addDays(days[days.length - 1], 1)) : ''

  function dayIdxFromWindow(iso) {
    const dt = new Date(iso + 'T00:00:00')
    const w0 = new Date(windowStart + 'T00:00:00')
    return Math.round((dt - w0) / 86400000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {onSelectBerth && (
        <div style={{ background: '#dbeeff', borderBottom: '1px solid rgba(0,117,222,0.2)', padding: '7px 16px', fontSize: 12, color: '#004fa3', fontWeight: 600, flexShrink: 0 }}>
          Click any berth row to select it
        </div>
      )}
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: 'var(--border)', flexWrap: 'wrap', background: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={navPrev}>‹</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(startOfDay(new Date()))} style={{ fontSize: 11 }}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={navNext}>›</button>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'rgba(0,0,0,0.8)', minWidth: 130 }}>{rangeLabel}</span>
        </div>

        <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 7, padding: 2 }}>
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p)}
              className={period.id === p.id ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              style={{ fontSize: 11, padding: '3px 10px' }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(0,0,0,0.1)', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" value={searchFrom} onChange={e => setSearchFrom(e.target.value)}
            style={{ fontSize: 11, padding: '4px 8px', border: 'var(--border)', borderRadius: 6, color: 'rgba(0,0,0,0.7)' }} />
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>→</span>
          <input type="date" value={searchTo} onChange={e => setSearchTo(e.target.value)}
            style={{ fontSize: 11, padding: '4px 8px', border: 'var(--border)', borderRadius: 6, color: 'rgba(0,0,0,0.7)' }} />
          <button
            className="btn btn-primary btn-sm"
            disabled={!searchFrom}
            onClick={() => { if (searchFrom) setAnchor(startOfDay(new Date(searchFrom + 'T00:00:00'))) }}
            style={{ fontSize: 11 }}
          >
            Search
          </button>
        </div>

        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          style={{ fontSize: 11, padding: '4px 8px', border: 'var(--border)', borderRadius: 6, color: 'rgba(0,0,0,0.7)', background: '#fff' }}
        >
          <option value="all">All types</option>
          {berthTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number" min="0" step="0.5"
            value={boatLoa}
            onChange={e => setBoatLoa(e.target.value)}
            placeholder="Boat LOA (m)"
            style={{ fontSize: 11, padding: '4px 8px', border: 'var(--border)', borderRadius: 6, color: 'rgba(0,0,0,0.7)', width: 110 }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.6)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={filterAvailOnly} onChange={e => setFilterAvailOnly(e.target.checked)} disabled={!searchFrom || !searchTo} />
          Available only
        </label>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>{filteredBerths.length} berths</span>
      </div>

      {/* Calendar grid */}
      <div
        ref={gridRef}
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerUp={onGridPointerUp}
        style={{ flex: 1, overflow: 'auto', position: 'relative', cursor: 'grab' }}
      >
        <div style={{ minWidth: labelWidth + days.length * COL_W }}>
          {/* Day header — sticky top */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1.5px solid rgba(0,0,0,0.1)' }}>
            {/* Label column header with resizer */}
            <div style={{ width: labelWidth, minWidth: labelWidth, flexShrink: 0, position: 'relative', borderRight: '1px solid rgba(0,0,0,0.08)', padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', userSelect: 'none' }}>
              Berth
              {/* Resize handle */}
              <div
                onPointerDown={onResizerPointerDown}
                onPointerMove={onResizerPointerMove}
                onPointerUp={onResizerPointerUp}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
                  cursor: 'col-resize', zIndex: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <div style={{ width: 2, height: '60%', background: 'rgba(0,0,0,0.15)', borderRadius: 1 }} />
              </div>
            </div>

            {days.map(d => {
              const iso = isoDate(d)
              const isToday = iso === today
              const isWeekend = d.getDay() === 0 || d.getDay() === 6
              const isInRange = searchFrom && searchTo && iso >= searchFrom && iso <= searchTo
              const isRangeStart = iso === searchFrom
              const isRangeEnd = iso === searchTo
              return (
                <div key={iso} style={{
                  width: COL_W, minWidth: COL_W, flexShrink: 0,
                  borderRight: '1px solid rgba(0,0,0,0.05)', textAlign: 'center', padding: '4px 0',
                  background: isInRange
                    ? (isRangeStart || isRangeEnd ? 'rgba(0,117,222,0.18)' : 'rgba(0,117,222,0.08)')
                    : isToday ? 'rgba(0,117,222,0.06)' : isWeekend ? 'rgba(0,0,0,0.02)' : 'transparent',
                  borderBottom: isInRange ? '2px solid rgba(0,117,222,0.5)' : undefined,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 500, color: isInRange || isToday ? '#0075de' : 'rgba(0,0,0,0.35)', textTransform: 'uppercase' }}>
                    {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: isToday || isRangeStart || isRangeEnd ? 700 : 500, color: isInRange || isToday ? '#0075de' : 'rgba(0,0,0,0.7)' }}>
                    {d.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Berth rows */}
          {filteredBerths.length === 0 ? (
            <div style={{ padding: '40px 20px', fontSize: 13, color: 'rgba(0,0,0,0.35)', textAlign: 'center' }}>
              No berths match your filter
            </div>
          ) : filteredBerths.map((berth, ri) => {
            const berthBks = bookingsByBerth[berth.id] ?? []
            const rowBg = ri % 2 === 0 ? '#fff' : '#fafafa'
            const loaNum = parseFloat(boatLoa)
            const berthLen = parseFloat(berth.length_m) || 0
            const doesFit = !boatLoa || isNaN(loaNum) || berthLen >= loaNum

            return (
              <div key={berth.id} style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.05)', background: rowBg, height: ROW_H, opacity: doesFit ? 1 : 0.45 }}>
                {/* Label with resizer */}
                <div data-interactive
                  style={{ width: labelWidth, minWidth: labelWidth, flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRight: '1px solid rgba(0,0,0,0.08)', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => onSelectBerth ? onSelectBerth(berth) : setSelectedBerth(berth)}
                  title={onSelectBerth ? 'Click to select this berth' : 'View berth details'}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {berth.code}
                  </span>
                  {berth.length_m && labelWidth > 80 && (
                    <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', flexShrink: 0 }}>{berth.length_m}m</span>
                  )}
                  {boatLoa && !isNaN(loaNum) && labelWidth > 90 && (
                    <span style={{ fontSize: 9, fontWeight: 700, flexShrink: 0, color: doesFit ? '#1a8c2e' : '#c0392b' }}>
                      {doesFit ? '✓' : '✗'}
                    </span>
                  )}
                  {/* Resize handle (invisible, but functional — matches header) */}
                  <div
                    onPointerDown={onResizerPointerDown}
                    onPointerMove={onResizerPointerMove}
                    onPointerUp={onResizerPointerUp}
                    onClick={e => e.stopPropagation()}
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 5 }}
                  />
                </div>

                {/* Day cells + booking bars */}
                <div
                  data-interactive={onSelectBerth ? '' : undefined}
                  style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: onSelectBerth && searchFrom && searchTo ? 'pointer' : undefined }}
                  onMouseEnter={() => { if (onSelectBerth) setHoveredBerthId(berth.id) }}
                  onMouseLeave={() => { if (onSelectBerth) setHoveredBerthId(null) }}
                  onClick={() => { if (onSelectBerth && searchFrom && searchTo) onSelectBerth(berth) }}
                >
                  <div style={{ display: 'flex', height: '100%' }}>
                    {days.map(d => {
                      const iso = isoDate(d)
                      const isToday = iso === today
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6
                      const isInRange = searchFrom && searchTo && iso >= searchFrom && iso <= searchTo
                      return (
                        <div key={iso} style={{
                          width: COL_W, minWidth: COL_W, flexShrink: 0, height: '100%',
                          borderRight: '1px solid rgba(0,0,0,0.04)',
                          background: isInRange
                            ? 'rgba(0,117,222,0.06)'
                            : isToday ? 'rgba(0,117,222,0.04)' : isWeekend ? 'rgba(0,0,0,0.015)' : 'transparent',
                        }} />
                      )
                    })}
                  </div>

                  {/* Booking bars */}
                  {berthBks.map(bk => {
                    if (bk.check_out <= windowStart || bk.check_in >= windowEnd) return null
                    const col = STATUS_COLOR[bk.status] ?? STATUS_COLOR.confirmed

                    const clampedStart = bk.check_in  > windowStart ? bk.check_in  : windowStart
                    const clampedEnd   = bk.check_out < windowEnd   ? bk.check_out : windowEnd

                    const barLeft  = dayIdxFromWindow(clampedStart) * COL_W + 1
                    const barWidth = (dayIdxFromWindow(clampedEnd) - dayIdxFromWindow(clampedStart)) * COL_W - 2
                    if (barWidth <= 0) return null

                    return (
                      <div
                        key={bk.id}
                        data-interactive
                        onClick={() => { if (onSelectBerth) onSelectBerth(berth); else setSelectedBooking(bk) }}
                        title={`${bk.vessel_name || bk.guest_name || 'Booking'} · ${bk.check_in} → ${bk.check_out}`}
                        style={{
                          position: 'absolute', top: 4, bottom: 4, left: barLeft, width: barWidth,
                          background: col.bg, border: `1px solid ${col.border}`, borderRadius: 4,
                          display: 'flex', alignItems: 'center', padding: '0 6px',
                          overflow: 'hidden', cursor: 'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.93)' }}
                        onMouseLeave={e => { e.currentTarget.style.filter = '' }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 600, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {bk.vessel_name || bk.guest_name || `BK-${bk.id}`}
                        </span>
                      </div>
                    )
                  })}

                  {/* Ghost bar — shows where the booking would land in picker mode */}
                  {onSelectBerth && hoveredBerthId === berth.id && searchFrom && searchTo && (() => {
                    const ghostLeft  = dayIdxFromWindow(searchFrom) * COL_W + 1
                    const ghostWidth = (dayIdxFromWindow(searchTo) - dayIdxFromWindow(searchFrom)) * COL_W - 2
                    if (ghostWidth <= 0) return null
                    return (
                      <div
                        key="ghost"
                        style={{
                          position: 'absolute', top: 3, bottom: 3, left: ghostLeft, width: ghostWidth,
                          background: 'rgba(0,117,222,0.18)',
                          border: '2px dashed rgba(0,117,222,0.65)',
                          borderRadius: 4,
                          pointerEvents: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#004fa3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 6px' }}>
                          {berth.code}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, padding: '7px 16px', borderTop: 'var(--border)', background: '#fff', flexShrink: 0, flexWrap: 'wrap' }}>
        {[
          ['Confirmed',   STATUS_COLOR.confirmed],
          ['Checked In',  STATUS_COLOR.checked_in],
          ['Pending',     STATUS_COLOR.pending],
          ['Overstay',    STATUS_COLOR.overstay],
          ['Checked Out', STATUS_COLOR.checked_out],
        ].map(([label, col]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: col.bg, border: `1.5px solid ${col.border}` }} />
            {label}
          </div>
        ))}
      </div>

      {/* Booking detail modal */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          berth={berthById[selectedBooking.berth]}
          onClose={() => setSelectedBooking(null)}
          onJumpToMap={b => { onJumpToMap?.(b); setSelectedBooking(null) }}
        />
      )}

      {/* Berth detail modal */}
      {selectedBerth && !selectedBooking && (
        <BerthDetailModal
          berth={selectedBerth}
          bookings={bookings}
          onClose={() => setSelectedBerth(null)}
          onJumpToMap={b => { onJumpToMap?.(b); setSelectedBerth(null) }}
          onSelectBooking={bk => { setSelectedBooking(bk) }}
        />
      )}
    </div>
  )
}
