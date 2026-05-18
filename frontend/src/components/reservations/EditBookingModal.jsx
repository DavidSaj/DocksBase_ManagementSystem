import { useEffect, useMemo, useState } from 'react';
import api from '../../api.js';
import useVessels from '../../hooks/useVessels.js';

/**
 * Deep edit modal for a Booking. Complements the inline check-in / check-out /
 * notes editor on the right-side card by exposing the fields that need an
 * explicit confirmation step:
 *
 *   vessel, berth, booking_type, guest_name, guest_email, guest_phone
 *
 * The inline editor is for fat-finger-safe values (dates, notes) that staff
 * change all the time. This modal is for the fields where an accidental
 * overwrite is expensive (e.g. flipping a transient booking to seasonal, or
 * detaching the wrong vessel).
 *
 * Backlog F8 (2026-05-17-backlog.md, open-question #2). Spec note: explicit
 * Confirm button required so staff can't tab-through and overwrite by mistake.
 */
export default function EditBookingModal({ booking, onClose, onSaved }) {
  const { vessels, loading: vesselsLoading } = useVessels();

  const [berths, setBerths] = useState([]);
  const [berthsLoading, setBerthsLoading] = useState(true);

  const [form, setForm] = useState({
    vessel: booking.vessel ?? '',
    berth: booking.berth ?? '',
    booking_type: booking.booking_type ?? 'transient',
    guest_name: booking.guest_name ?? '',
    guest_email: booking.guest_email ?? '',
    guest_phone: booking.guest_phone ?? '',
  });
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Berth list for the booking's date window. Filtered to berths that fit the
  // boat's LOA when available; falls back to the unfiltered list otherwise.
  useEffect(() => {
    if (!booking.check_in || !booking.check_out) {
      setBerthsLoading(false);
      return;
    }
    const params = { check_in: booking.check_in, check_out: booking.check_out };
    if (booking.boat_loa)  params.boat_loa  = booking.boat_loa;
    if (booking.boat_beam) params.boat_beam = booking.boat_beam;
    api.get('/berths/available/', { params })
      .then(r => setBerths(r.data.results ?? r.data))
      .catch(() => setBerths([]))
      .finally(() => setBerthsLoading(false));
  }, [booking.check_in, booking.check_out, booking.boat_loa, booking.boat_beam]);

  const dirty = useMemo(() => (
    String(form.vessel ?? '')       !== String(booking.vessel ?? '')       ||
    String(form.berth ?? '')        !== String(booking.berth ?? '')        ||
    form.booking_type               !== (booking.booking_type ?? 'transient') ||
    form.guest_name                 !== (booking.guest_name ?? '')         ||
    form.guest_email                !== (booking.guest_email ?? '')        ||
    form.guest_phone                !== (booking.guest_phone ?? '')
  ), [form, booking]);

  // Re-arm the confirm button on every form change.
  useEffect(() => { setConfirmArmed(false); }, [form]);

  async function submit() {
    if (!confirmArmed || !dirty || busy) return;
    setBusy(true);
    setError('');
    try {
      const patch = {};
      if (String(form.vessel ?? '') !== String(booking.vessel ?? '')) {
        patch.vessel = form.vessel === '' ? null : Number(form.vessel);
      }
      if (String(form.berth ?? '') !== String(booking.berth ?? '')) {
        patch.berth = form.berth === '' ? null : Number(form.berth);
      }
      if (form.booking_type !== (booking.booking_type ?? 'transient')) {
        patch.booking_type = form.booking_type;
      }
      if (form.guest_name  !== (booking.guest_name  ?? '')) patch.guest_name  = form.guest_name;
      if (form.guest_email !== (booking.guest_email ?? '')) patch.guest_email = form.guest_email;
      if (form.guest_phone !== (booking.guest_phone ?? '')) patch.guest_phone = form.guest_phone;

      const { data } = await api.patch(`/bookings/${booking.id}/`, patch);
      onSaved?.(data);
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.response?.data?.non_field_errors?.[0];
      setError(detail || 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  };
  const modal = {
    background: '#fff', borderRadius: 12, padding: 28,
    width: 460, maxHeight: '90vh', overflowY: 'auto',
  };
  const label = {
    display: 'block', fontWeight: 600, fontSize: 11, marginBottom: 4,
    color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: 0.4,
  };
  const input = {
    width: '100%', padding: '8px 10px', fontSize: 13,
    border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6,
    boxSizing: 'border-box',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div style={modal}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Edit booking details</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 18 }}>
          Booking #{booking.id} · {booking.check_in} – {booking.check_out}
          <div style={{ marginTop: 4, fontStyle: 'italic' }}>
            Dates and notes are edited inline on the right-hand card. Changes here
            require an explicit confirm step.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={label}>Vessel</div>
            <select
              style={input}
              value={form.vessel ?? ''}
              onChange={e => setForm(f => ({ ...f, vessel: e.target.value }))}
              disabled={vesselsLoading || busy}
            >
              <option value="">— no vessel —</option>
              {vessels.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.owner_name ? ` · ${v.owner_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={label}>Berth</div>
            <select
              style={input}
              value={form.berth ?? ''}
              onChange={e => setForm(f => ({ ...f, berth: e.target.value }))}
              disabled={berthsLoading || busy}
            >
              <option value="">— unassigned —</option>
              {/* Always render the booking's current berth so it's selectable
                  even if the availability query no longer returns it. */}
              {booking.berth && !berths.find(b => b.id === booking.berth) && (
                <option value={booking.berth}>{booking.berth_code || `#${booking.berth}`} (current)</option>
              )}
              {berths.map(b => (
                <option key={b.id} value={b.id}>{b.code}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={label}>Booking type</div>
            <select
              style={input}
              value={form.booking_type}
              onChange={e => setForm(f => ({ ...f, booking_type: e.target.value }))}
              disabled={busy}
            >
              <option value="transient">Transient</option>
              <option value="seasonal">Seasonal</option>
            </select>
          </div>

          <div>
            <div style={label}>Guest name</div>
            <input
              type="text" style={input}
              value={form.guest_name}
              onChange={e => setForm(f => ({ ...f, guest_name: e.target.value }))}
              disabled={busy}
            />
          </div>

          <div>
            <div style={label}>Guest email</div>
            <input
              type="email" style={input}
              value={form.guest_email}
              onChange={e => setForm(f => ({ ...f, guest_email: e.target.value }))}
              disabled={busy}
            />
          </div>

          <div>
            <div style={label}>Guest phone</div>
            <input
              type="tel" style={input}
              value={form.guest_phone}
              onChange={e => setForm(f => ({ ...f, guest_phone: e.target.value }))}
              disabled={busy}
            />
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#b91c1c', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dirty && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'rgba(0,0,0,0.7)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmArmed}
                onChange={e => setConfirmArmed(e.target.checked)}
                disabled={busy}
              />
              <span>
                I’ve double-checked the changes above. Replacing vessel, berth, or
                booking type can affect billing — overwrite this booking.
              </span>
            </label>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={submit}
              disabled={!confirmArmed || !dirty || busy}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
