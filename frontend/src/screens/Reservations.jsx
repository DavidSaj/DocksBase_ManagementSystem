import { useState, useEffect, useRef, useCallback } from 'react';
import useBookings from '../hooks/useBookings.js';
import useBookingRequests from '../hooks/useBookingRequests.js';
import useVessels from '../hooks/useVessels.js';
import useBerths from '../hooks/useBerths.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api from '../api.js';
import PendingRequestsTab from '../components/reservations/PendingRequestsTab.jsx';
import BerthCalendar from '../components/harbor-map/BerthCalendar.jsx';

const filterMap = {
  all:       {},
  transient: { booking_type: 'transient' },
  seasonal:  { booking_type: 'seasonal' },
  pending:   { status: 'pending' },
  overdue:   { status: 'overstay' },
};

const bookingTabs = ['all', 'transient', 'seasonal', 'pending', 'overdue'];

const LABEL = { fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' };

function fmt(b) {
  return {
    ...b,
    vessel:   b.vessel_name  ?? b.vessel  ?? '—',
    owner:    b.owner_name   ?? b.owner   ?? '—',
    berth:    b.berth_code   ?? b.berth   ?? '—',
    checkin:  b.check_in     ?? b.checkin ?? '—',
    checkout: b.check_out    ?? b.checkout ?? '—',
    type:     b.booking_type ? (b.booking_type.charAt(0).toUpperCase() + b.booking_type.slice(1)) : (b.type ?? '—'),
    amount:   b.amount != null ? `€${Number(b.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—',
  };
}

// ---------------------------------------------------------------------------
// useAvailableBerthsForDates — fetches date-aware berth availability from the
// management API. Fires whenever check_in, check_out, or any dimension changes.
// Returns { berths, loading, noDatesYet } so the caller can render appropriate UI.
// ---------------------------------------------------------------------------
function useAvailableBerthsForDates({ check_in, check_out, boat_loa, boat_beam, boat_draft }) {
  const [berths, setBerths] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const fetchBerths = useCallback(async () => {
    if (!check_in || !check_out) {
      setBerths([]);
      setLoading(false);
      return;
    }
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = { check_in, check_out };
      if (boat_loa)   params.boat_loa   = boat_loa;
      if (boat_beam)  params.boat_beam  = boat_beam;
      if (boat_draft) params.boat_draft = boat_draft;
      const { data } = await api.get('/bookings/available-berths/', {
        params,
        signal: controller.signal,
      });
      const list = Array.isArray(data) ? data : (data.results ?? []);
      setBerths(list);
    } catch (err) {
      if (err.name !== 'CanceledError' && err.name !== 'AbortError') setBerths([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [check_in, check_out, boat_loa, boat_beam, boat_draft]);

  useEffect(() => {
    fetchBerths();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchBerths]);

  return { berths, loading, noDatesYet: !check_in || !check_out };
}

// Renders the berth <select> with loading / empty-state awareness.
function BerthSelect({ value, onChange, check_in, check_out, boat_loa, boat_beam, boat_draft, required, style }) {
  const { berths, loading, noDatesYet } = useAvailableBerthsForDates({ check_in, check_out, boat_loa, boat_beam, boat_draft });

  let placeholder;
  if (noDatesYet)   placeholder = 'Set check-in & check-out first';
  else if (loading) placeholder = 'Checking availability…';
  else if (!berths.length) placeholder = 'No berths available for these dates';
  else placeholder = 'Select berth…';

  return (
    <select
      className="input"
      value={value}
      onChange={onChange}
      required={required}
      disabled={noDatesYet || loading}
      style={style}
    >
      <option value="">{placeholder}</option>
      {berths.map(b => (
        <option key={b.id} value={b.id}>
          {b.code}{b.price_per_night ? ` — €${b.price_per_night}/night` : ''}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// BerthPickerOverlay — full-screen calendar for selecting a berth
// ---------------------------------------------------------------------------
function BerthPickerOverlay({ initialFrom, initialTo, initialLoa, onSelectBerth, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#f4f6f8' }}>
      <div style={{ background: '#1a2d4a', color: '#fff', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 0 }}>←</button>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Select a Berth</span>
        {initialFrom && initialTo && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>{initialFrom} → {initialTo}{initialLoa ? ` · LOA ${initialLoa}m` : ''}</span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <BerthCalendar
          initialFrom={initialFrom}
          initialTo={initialTo}
          initialLoa={initialLoa}
          initialAvailOnly={!!(initialFrom && initialTo)}
          onSelectBerth={onSelectBerth}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SmartBookingModal
// ---------------------------------------------------------------------------
function SmartBookingModal({ onClose, onCreated, createRequest, convertRequest }) {
  // State machine
  const [phase, setPhase] = useState('search');

  // Search phase state
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const debounceRef = useRef(null);

  // Shared across phases
  const [selectedMember, setSelectedMember] = useState(null);
  const [guestName, setGuestName] = useState('');

  // memberFound form
  const [mForm, setMForm] = useState({ vessel: '', berth: '', booking_type: 'transient', check_in: '', check_out: '' });

  // guestQuick form
  const [qForm, setQForm] = useState({ guest_name: '', guest_phone: '', guest_loa: '', berth: '', booking_type: 'transient', check_in: '', check_out: '' });

  // guestFull form
  const [fForm, setFForm] = useState({ name: '', email: '', phone: '', vessel_name: '', loa: '', draft: '', berth: '', booking_type: 'transient', check_in: '', check_out: '' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [berthPicker, setBerthPicker] = useState(null); // { from, to, loa, onSelect } | null

  // Hover state for result rows
  const [hoveredIdx, setHoveredIdx] = useState(null);

  // Derived amount preview — works off the berth id selected; we look it up
  // from the live availability results via a small lookup cache stored on the
  // select element's data attribute. Instead we keep a berth-price lookup map
  // that BerthSelect populates indirectly. Simpler: just store selected berth
  // metadata in state when the user changes the select.
  const [selectedBerthMeta, setSelectedBerthMeta] = useState(null); // { id, price_per_night }

  function handleMBerthChange(e, berths) {
    const id = e.target.value;
    setMForm(f => ({ ...f, berth: id }));
    const found = berths.find(b => String(b.id) === id);
    setSelectedBerthMeta(found ? { id: found.id, price_per_night: found.price_per_night } : null);
  }

  function amountPreview(berthId, checkIn, checkOut) {
    if (!selectedBerthMeta || String(selectedBerthMeta.id) !== String(berthId)) return '—';
    if (!selectedBerthMeta.price_per_night || !checkIn || !checkOut) return '—';
    const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
    return `€${(selectedBerthMeta.price_per_night * nights).toLocaleString('de-DE', { minimumFractionDigits: 2 })} (${nights} nights)`;
  }

  // Search debounce
  useEffect(() => {
    if (q.length < 2) { setResults([]); setSearchDone(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchDone(false);
      try {
        const { data } = await api.get('/members/', { params: { search: q } });
        const list = Array.isArray(data) ? data : (data.results ?? []);
        setResults(list);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
        setSearchDone(true);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  function pickMember(m) {
    setSelectedMember(m);
    setMForm({ vessel: '', berth: '', booking_type: 'transient', check_in: '', check_out: '' });
    setSelectedBerthMeta(null);
    setPhase('memberFound');
  }

  function goGuestQuick() {
    setQForm(f => ({ ...f, guest_name: q }));
    setGuestName(q);
    setPhase('guestQuick');
  }

  function goGuestFull() {
    setFForm(f => ({ ...f, name: q }));
    setGuestName(q);
    setPhase('guestFull');
  }

  function resetToSearch() {
    setPhase('search');
    setSelectedMember(null);
    setResults([]);
    setSearchDone(false);
    setError(null);
    setSelectedBerthMeta(null);
  }

  // Submit: memberFound
  async function submitMember(e) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const { data } = await api.post('/bookings/', {
        vessel:       Number(mForm.vessel),
        berth:        Number(mForm.berth),
        booking_type: mForm.booking_type,
        check_in:     mForm.check_in,
        check_out:    mForm.check_out,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data ? JSON.stringify(err.response.data) : 'Failed to create booking.');
    } finally {
      setSubmitting(false);
    }
  }

  // Submit: guestQuick
  async function submitGuestQuick(e) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      await createRequest({
        guest_name:   qForm.guest_name,
        guest_phone:  qForm.guest_phone,
        guest_loa:    qForm.guest_loa ? Number(qForm.guest_loa) : null,
        berth:        Number(qForm.berth),
        booking_type: qForm.booking_type,
        start_date:   qForm.check_in,
        end_date:     qForm.check_out,
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data ? JSON.stringify(err.response.data) : 'Failed to create guest booking.');
    } finally {
      setSubmitting(false);
    }
  }

  // Submit: guestFull
  async function submitGuestFull(e) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    let req;
    try {
      req = await createRequest({
        guest_name:   fForm.name,
        guest_phone:  fForm.phone,
        guest_email:  fForm.email,
        guest_vessel: fForm.vessel_name,
        guest_loa:    fForm.loa ? Number(fForm.loa) : null,
        berth:        Number(fForm.berth),
        booking_type: fForm.booking_type,
        start_date:   fForm.check_in,
        end_date:     fForm.check_out,
      });
    } catch (err) {
      setError(err.response?.data ? JSON.stringify(err.response.data) : 'Failed to create request.');
      setSubmitting(false);
      return;
    }
    try {
      await convertRequest(req.id);
      onCreated();
    } catch (err) {
      setError(err.response?.data ? JSON.stringify(err.response.data) : 'Request created but registration failed. You can convert from the waitlist.');
    } finally {
      setSubmitting(false);
    }
  }

  // Modal title
  const titles = {
    search:      'New Booking',
    memberFound: selectedMember ? `New Booking — ${selectedMember.name}` : 'New Booking',
    guestQuick:  'Guest Check-In',
    guestFull:   'Register & Book',
  };

  // memberFound — we need access to the live berth list for amount preview.
  // Use the hook at modal level for the member phase; the BerthSelect component
  // will also call it internally (React dedupes by key identity so the second
  // call reuses the same effect in practice — two fetches at most, negligible).
  const mBerths = useAvailableBerthsForDates({
    check_in:   mForm.check_in,
    check_out:  mForm.check_out,
  });

  return (
    <>
    {berthPicker && (
      <BerthPickerOverlay
        initialFrom={berthPicker.from}
        initialTo={berthPicker.to}
        initialLoa={berthPicker.loa}
        onSelectBerth={berthPicker.onSelect}
        onClose={() => setBerthPicker(null)}
      />
    )}
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 480, padding: 24, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(phase === 'guestQuick' || phase === 'guestFull') && (
              <button className="btn btn-ghost btn-sm" onClick={resetToSearch} style={{ padding: '3px 7px' }}>←</button>
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{titles[phase]}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={12} /></button>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: '#fff5f5', borderRadius: 6, marginBottom: 12 }}>{error}</div>
        )}

        {/* ── PHASE: search ── */}
        {phase === 'search' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={LABEL}>Search by name or email</label>
            <input
              className="input"
              placeholder="Search by name or email…"
              value={q}
              onChange={e => setQ(e.target.value)}
              autoFocus
              style={{ width: '100%' }}
            />

            {q.length >= 2 && searching && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '6px 2px' }}>Searching…</div>
            )}

            {q.length >= 2 && !searching && results.length > 0 && (
              <div style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.12)', borderRadius: 6, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                {results.map((m, i) => (
                  <div
                    key={m.id}
                    style={{ padding: '10px 14px', cursor: 'pointer', background: hoveredIdx === i ? '#f5f8ff' : '#fff', borderBottom: i < results.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onClick={() => pickMember(m)}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{m.email}</div>
                  </div>
                ))}
              </div>
            )}

            {q.length >= 2 && !searching && searchDone && results.length === 0 && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '4px 2px' }}>No results for &ldquo;{q}&rdquo;</div>
            )}

            <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Or add without searching:</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={goGuestQuick}>+ Continue as Guest</button>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={goGuestFull}>+ Register New Member &amp; Vessel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE: memberFound ── */}
        {phase === 'memberFound' && selectedMember && (
          <form onSubmit={submitMember}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Member card */}
              <div style={{ background: '#f5f8ff', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedMember.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{selectedMember.email}</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={resetToSearch} style={{ fontSize: 11 }}>✕ Change</button>
              </div>

              <label style={LABEL}>
                Vessel
                {selectedMember.vessels?.length > 0 ? (
                  <select className="input" value={mForm.vessel} onChange={e => setMForm(f => ({ ...f, vessel: e.target.value }))} required style={{ marginTop: 4, width: '100%', fontWeight: 400 }}>
                    <option value="">Select vessel…</option>
                    {selectedMember.vessels.map(v => <option key={v.id} value={v.id}>{v.name}{v.loa ? ` (${v.loa}m)` : ''}</option>)}
                  </select>
                ) : (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'rgba(0,0,0,0.35)', fontWeight: 400 }}>No vessels on record</div>
                )}
              </label>

              <label style={LABEL}>
                Type
                <select className="input" value={mForm.booking_type} onChange={e => setMForm(f => ({ ...f, booking_type: e.target.value }))} style={{ marginTop: 4, width: '100%', fontWeight: 400 }}>
                  <option value="transient">Transient</option>
                  <option value="seasonal">Seasonal</option>
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={LABEL}>
                  Check-in
                  <input type="date" className="input" value={mForm.check_in} onChange={e => { setMForm(f => ({ ...f, check_in: e.target.value, berth: '' })); setSelectedBerthMeta(null); }} required style={{ marginTop: 4, width: '100%' }} />
                </label>
                <label style={LABEL}>
                  Check-out
                  <input type="date" className="input" value={mForm.check_out} onChange={e => { setMForm(f => ({ ...f, check_out: e.target.value, berth: '' })); setSelectedBerthMeta(null); }} required style={{ marginTop: 4, width: '100%' }} />
                </label>
              </div>

              <div>
                <div style={LABEL}>Berth</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'flex-start' }}>
                  <select
                    className="input"
                    value={mForm.berth}
                    onChange={e => handleMBerthChange(e, mBerths.berths)}
                    required
                    disabled={mBerths.noDatesYet || mBerths.loading}
                    style={{ flex: 1, fontWeight: 400 }}
                  >
                    <option value="">
                      {mBerths.noDatesYet
                        ? 'Set check-in & check-out first'
                        : mBerths.loading
                          ? 'Checking availability…'
                          : mBerths.berths.length === 0
                            ? 'No berths available for these dates'
                            : 'Select berth…'}
                    </option>
                    {mBerths.berths.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.code}{b.price_per_night ? ` — €${b.price_per_night}/night` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={mBerths.noDatesYet}
                    onClick={() => setBerthPicker({
                      from: mForm.check_in, to: mForm.check_out, loa: '',
                      onSelect: (berth) => {
                        setMForm(f => ({ ...f, berth: String(berth.id) }));
                        setSelectedBerthMeta({ id: berth.id, price_per_night: berth.price_per_night });
                        setBerthPicker(null);
                      },
                    })}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Browse calendar
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f5f8ff', borderRadius: 6 }}>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Estimated amount</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>{amountPreview(mForm.berth, mForm.check_in, mForm.check_out)}</span>
              </div>

              <button type="submit" className="btn btn-primary" disabled={submitting || !selectedMember.vessels?.length} style={{ justifyContent: 'center' }}>
                {submitting ? 'Creating…' : 'Create Booking'}
              </button>
            </div>
          </form>
        )}

        {/* ── PHASE: guestQuick ── */}
        {phase === 'guestQuick' && (
          <form onSubmit={submitGuestQuick}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                Guest booking — no member profile will be created. You can convert this later.
              </div>

              <label style={LABEL}>
                Guest Name
                <input className="input" value={qForm.guest_name} onChange={e => setQForm(f => ({ ...f, guest_name: e.target.value }))} required style={{ marginTop: 4, width: '100%' }} />
              </label>

              <label style={LABEL}>
                Phone
                <input className="input" type="tel" value={qForm.guest_phone} onChange={e => setQForm(f => ({ ...f, guest_phone: e.target.value }))} style={{ marginTop: 4, width: '100%' }} />
              </label>

              <label style={LABEL}>
                Boat Length (m)
                <input className="input" type="number" step="0.1" min="0" value={qForm.guest_loa} onChange={e => setQForm(f => ({ ...f, guest_loa: e.target.value, berth: '' }))} style={{ marginTop: 4, width: '100%' }} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={LABEL}>
                  Check-in
                  <input type="date" className="input" value={qForm.check_in} onChange={e => setQForm(f => ({ ...f, check_in: e.target.value, berth: '' }))} required style={{ marginTop: 4, width: '100%' }} />
                </label>
                <label style={LABEL}>
                  Check-out
                  <input type="date" className="input" value={qForm.check_out} onChange={e => setQForm(f => ({ ...f, check_out: e.target.value, berth: '' }))} required style={{ marginTop: 4, width: '100%' }} />
                </label>
              </div>

              <div>
                <div style={LABEL}>Berth</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'flex-start' }}>
                  <BerthSelect
                    value={qForm.berth}
                    onChange={e => setQForm(f => ({ ...f, berth: e.target.value }))}
                    check_in={qForm.check_in}
                    check_out={qForm.check_out}
                    boat_loa={qForm.guest_loa || undefined}
                    required
                    style={{ flex: 1, fontWeight: 400 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!qForm.check_in || !qForm.check_out}
                    onClick={() => setBerthPicker({
                      from: qForm.check_in, to: qForm.check_out, loa: qForm.guest_loa || '',
                      onSelect: (berth) => {
                        setQForm(f => ({ ...f, berth: String(berth.id) }));
                        setBerthPicker(null);
                      },
                    })}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Browse calendar
                  </button>
                </div>
              </div>

              <label style={LABEL}>
                Type
                <select className="input" value={qForm.booking_type} onChange={e => setQForm(f => ({ ...f, booking_type: e.target.value }))} style={{ marginTop: 4, width: '100%', fontWeight: 400 }}>
                  <option value="transient">Transient</option>
                  <option value="seasonal">Seasonal</option>
                </select>
              </label>

              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
                {submitting ? 'Saving…' : 'Create Guest Booking'}
              </button>
            </div>
          </form>
        )}

        {/* ── PHASE: guestFull ── */}
        {phase === 'guestFull' && (
          <form onSubmit={submitGuestFull}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Section 1: New Member */}
              <div style={LABEL}>New Member</div>
              <label style={LABEL}>
                Name
                <input className="input" value={fForm.name} onChange={e => setFForm(f => ({ ...f, name: e.target.value }))} required style={{ marginTop: 4, width: '100%' }} />
              </label>
              <label style={LABEL}>
                Email
                <input className="input" type="email" value={fForm.email} onChange={e => setFForm(f => ({ ...f, email: e.target.value }))} required style={{ marginTop: 4, width: '100%' }} />
              </label>
              <label style={LABEL}>
                Phone
                <input className="input" type="tel" value={fForm.phone} onChange={e => setFForm(f => ({ ...f, phone: e.target.value }))} style={{ marginTop: 4, width: '100%' }} />
              </label>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '4px 0' }} />

              {/* Section 2: Their Vessel */}
              <div style={LABEL}>Their Vessel</div>
              <label style={LABEL}>
                Vessel Name
                <input className="input" value={fForm.vessel_name} onChange={e => setFForm(f => ({ ...f, vessel_name: e.target.value }))} required style={{ marginTop: 4, width: '100%' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={LABEL}>
                  LOA (m)
                  <input className="input" type="number" step="0.1" min="0" value={fForm.loa} onChange={e => setFForm(f => ({ ...f, loa: e.target.value, berth: '' }))} style={{ marginTop: 4, width: '100%' }} />
                </label>
                <label style={LABEL}>
                  Draft (m)
                  <input className="input" type="number" step="0.01" min="0" value={fForm.draft} onChange={e => setFForm(f => ({ ...f, draft: e.target.value, berth: '' }))} style={{ marginTop: 4, width: '100%' }} />
                </label>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '4px 0' }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={LABEL}>
                  Check-in
                  <input type="date" className="input" value={fForm.check_in} onChange={e => setFForm(f => ({ ...f, check_in: e.target.value, berth: '' }))} required style={{ marginTop: 4, width: '100%' }} />
                </label>
                <label style={LABEL}>
                  Check-out
                  <input type="date" className="input" value={fForm.check_out} onChange={e => setFForm(f => ({ ...f, check_out: e.target.value, berth: '' }))} required style={{ marginTop: 4, width: '100%' }} />
                </label>
              </div>

              <div>
                <div style={LABEL}>Berth</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'flex-start' }}>
                  <BerthSelect
                    value={fForm.berth}
                    onChange={e => setFForm(f => ({ ...f, berth: e.target.value }))}
                    check_in={fForm.check_in}
                    check_out={fForm.check_out}
                    boat_loa={fForm.loa || undefined}
                    boat_draft={fForm.draft || undefined}
                    required
                    style={{ flex: 1, fontWeight: 400 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!fForm.check_in || !fForm.check_out}
                    onClick={() => setBerthPicker({
                      from: fForm.check_in, to: fForm.check_out, loa: fForm.loa || '',
                      onSelect: (berth) => {
                        setFForm(f => ({ ...f, berth: String(berth.id) }));
                        setBerthPicker(null);
                      },
                    })}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Browse calendar
                  </button>
                </div>
              </div>

              <label style={LABEL}>
                Type
                <select className="input" value={fForm.booking_type} onChange={e => setFForm(f => ({ ...f, booking_type: e.target.value }))} style={{ marginTop: 4, width: '100%', fontWeight: 400 }}>
                  <option value="transient">Transient</option>
                  <option value="seasonal">Seasonal</option>
                </select>
              </label>

              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
                {submitting ? 'Registering & booking…' : 'Register & Create Booking'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AssignBerthModal
// ---------------------------------------------------------------------------
function AssignBerthModal({ booking, berths, onClose, onAssign }) {
  const compatible = berths.filter(b => {
    if (b.status !== 'available') return false;
    if (booking.boat_loa && b.length_m && parseFloat(b.length_m) < parseFloat(booking.boat_loa)) return false;
    if (booking.boat_beam && b.max_beam_m && parseFloat(b.max_beam_m) < parseFloat(booking.boat_beam)) return false;
    return true;
  });
  const [selectedBerth, setSelectedBerth] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!selectedBerth) return;
    setSaving(true);
    setError(null);
    try {
      await onAssign(booking.id, parseInt(selectedBerth));
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Failed to assign berth.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">Assign Berth</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button>
        </div>
        <div style={{ fontSize: 12, marginBottom: 10, color: 'rgba(0,0,0,0.5)' }}>
          {booking.guest_name} · LOA {booking.boat_loa || '?'}m · {booking.check_in} – {booking.check_out}
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Compatible Berth
            <select className="input" value={selectedBerth} onChange={e => setSelectedBerth(e.target.value)} required>
              <option value="">Select berth…</option>
              {compatible.map(b => (
                <option key={b.id} value={b.id}>{b.code} — {b.length_m}m · €{b.price_per_night}/night</option>
              ))}
            </select>
          </label>
          {compatible.length === 0 && <p style={{ fontSize: 12, color: 'var(--red)' }}>No compatible berths available.</p>}
          {error && <p style={{ fontSize: 12, color: 'var(--red)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !selectedBerth}>{saving ? 'Assigning…' : 'Assign & Send Invoice'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reservations screen
// ---------------------------------------------------------------------------
export default function Reservations() {
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState(null);
  const [selReq, setSelReq] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'pending_approval' } })
      .then(r => {
        const items = r.data.results ?? r.data;
        setPendingCount(Array.isArray(items) ? items.length : 0);
      })
      .catch(() => {});
  }, []);

  const { bookings, loading, updateBooking, refetch, assignBerth } = useBookings(
    bookingTabs.includes(tab) ? filterMap[tab] : {}
  );
  const { berths } = useBerths();
  const { requests, loading: wlLoading, convertRequest, createRequest } = useBookingRequests(
    tab === 'waitlist' ? { status: 'pending' } : {}
  );

  const rows = bookings.map(fmt);

  async function markPaid(b) {
    await updateBooking(b.id, { paid: true, status: 'checked_in' });
    setSel(prev => prev?.id === b.id ? { ...prev, paid: true, status: 'checked_in' } : prev);
  }

  async function handleConvert(id) {
    await convertRequest(id);
    setSelReq(null);
    // convertRequest already calls refetch internally
  }

  return (
    <div>
      {showModal && (
        <SmartBookingModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); refetch(); }}
          createRequest={createRequest}
          convertRequest={convertRequest}
        />
      )}
      {assignModal && (
        <AssignBerthModal
          booking={assignModal}
          berths={berths}
          onClose={() => setAssignModal(null)}
          onAssign={assignBerth}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div className="search"><Ic n="search" s={13} /><input placeholder="Search vessel, owner, booking…" /></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Ic n="plus" s={12} />New Booking</button>
      </div>
      <div className="tabs">
        {[['all','All'],['transient','Transient'],['seasonal','Seasonal'],['pending_approval','Pending Approval'],['pending_requests','Pending Requests'],['pending','Pending'],['overdue','Overdue'],['waitlist','Wait List']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => { setTab(v); setSel(null); setSelReq(null); }}>
            {l}
            {v === 'pending_requests' && pendingCount > 0 && (
              <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700, verticalAlign: 'middle' }}>
                {pendingCount}
              </span>
            )}
          </div>
        ))}
      </div>

      {bookingTabs.includes(tab) && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Booking</th><th>Vessel / Owner</th><th>Slip</th><th>Dates</th><th>Type</th><th>Status</th><th>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No bookings found.</td></tr>
                ) : rows.map(b => (
                  <tr key={b.id} style={{ cursor: 'pointer', background: sel?.id === b.id ? '#f5f8ff' : '' }} onClick={() => setSel(b)}>
                    <td><div className="tbl-name">{b.id}</div></td>
                    <td><div className="tbl-name">{b.vessel}</div><div className="tbl-sub">{b.owner}</div></td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{b.berth}</td>
                    <td><div style={{ fontSize: 12 }}>{b.checkin} → {b.checkout}</div><div className="tbl-sub">{b.nights} nights</div></td>
                    <td><StatusBadge s={b.type} /></td>
                    <td><StatusBadge s={b.status} /></td>
                    <td><div style={{ fontWeight: 600 }}>{b.amount}</div><div className="tbl-sub">{b.paid ? 'Paid' : 'Unpaid'}</div></td>
                    <td>
                      {b.status === 'pending_approval' && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); setAssignModal(b); }}
                        >
                          Assign Berth
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sel && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div className="detail-title">{sel.id}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
              </div>
              <StatusBadge s={sel.status} />
              <div style={{ marginTop: 14 }}>
                {[['Vessel',sel.vessel],['Owner',sel.owner],['Slip',sel.berth],['Check-in',sel.checkin],['Check-out',sel.checkout],['Duration',`${sel.nights} nights`],['Type',sel.type],['Amount',sel.amount],['Payment',sel.paid?'Paid':'Outstanding']].map(([k,v]) => (
                  <div key={k} className="detail-row">
                    <div className="detail-key">{k}</div>
                    <div className="detail-val" style={{ color: k==='Payment' && !sel.paid ? 'var(--orange)' : k==='Payment' ? 'var(--green)' : undefined }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="detail-actions">
                {!sel.paid && <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => markPaid(sel)}>Mark as Paid</button>}
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Edit Booking</button>
                <button className="btn btn-danger" style={{ justifyContent: 'center' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'pending_requests' && (
        <div className="card" style={{ padding: 20 }}>
          <PendingRequestsTab
            onApproved={() => setPendingCount(c => Math.max(0, c - 1))}
            onRejected={() => setPendingCount(c => Math.max(0, c - 1))}
          />
        </div>
      )}

      {tab === 'waitlist' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Berth Wait List</div>
              <span className="badge badge-navy">{requests.length}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: selReq ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Applicant / Vessel</th><th>LOA</th><th>Berth Requested</th><th>Dates</th><th>Type</th><th>Status</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {wlLoading ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</td></tr>
                  ) : requests.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No pending requests.</td></tr>
                  ) : requests.map(w => (
                    <tr
                      key={w.id}
                      style={{ cursor: 'pointer', background: selReq?.id === w.id ? '#f5f8ff' : '' }}
                      onClick={() => setSelReq(w)}
                    >
                      <td>
                        <div className="tbl-name">{w.member_name || w.guest_name || '—'}</div>
                        <div className="tbl-sub">{w.vessel_name || w.guest_vessel || '—'}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{w.guest_loa ? `${w.guest_loa}m` : '—'}</td>
                      <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{w.berth_code}</td>
                      <td style={{ fontSize: 12 }}>{w.start_date} → {w.end_date}</td>
                      <td><span className="badge badge-navy">{w.booking_type}</span></td>
                      <td><StatusBadge s={w.status} /></td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{w.notes || '—'}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={e => { e.stopPropagation(); setSelReq(w); }}
                        >
                          Convert →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selReq && (
              <div className="detail">
                {selReq.guest_name && !selReq.booking && (
                  <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Guest booking — not yet registered</div>
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => handleConvert(selReq.id)}
                    >
                      👤 Convert to Registered Member
                    </button>
                  </div>
                )}
                <div className="detail-title">{selReq.member_name || selReq.guest_name || '—'}</div>
                <div className="detail-sub">{selReq.vessel_name || selReq.guest_vessel || '—'}</div>
                {[
                  ['Phone', selReq.guest_phone || '—'],
                  ['Email', selReq.guest_email || '—'],
                  ['LOA', selReq.guest_loa ? `${selReq.guest_loa}m` : '—'],
                  ['Berth', selReq.berth_code || '—'],
                  ['Dates', `${selReq.start_date} → ${selReq.end_date}`],
                  ['Type', selReq.booking_type],
                  ['Status', selReq.status],
                  ['Notes', selReq.notes || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="detail-row">
                    <div className="detail-key">{k}</div>
                    <div className="detail-val">{v}</div>
                  </div>
                ))}
                <div className="detail-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelReq(null)}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
