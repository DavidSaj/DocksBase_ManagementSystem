import { useState } from 'react';
import api from '../api';

const HDR = { background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff', display: 'flex', alignItems: 'center', gap: 14 };
const CARD = { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const BTN_PRIMARY = {
  display: 'block', width: '100%', padding: '15px 0', background: '#1a2d4a', color: '#fff',
  border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 8,
};
const BTN_GHOST = {
  display: 'block', width: '100%', padding: '13px 0', background: 'transparent', color: '#1a2d4a',
  border: '1.5px solid #1a2d4a', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8,
};
const LABEL = { fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 };
const INPUT = {
  width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 8,
  border: '1.5px solid #d0d6de', boxSizing: 'border-box', outline: 'none',
};

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// status: 'idle' | 'checking' | 'available' | 'unavailable' | 'submitting' | 'success' | 'error'

export default function ExtendStayScreen({ booking, onBack }) {
  const defaultDate = booking.check_out ? addDays(booking.check_out, 1) : '';
  const [newCheckOut, setNewCheckOut] = useState(defaultDate);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleCheck(e) {
    e.preventDefault();
    if (!newCheckOut) return;
    setStatus('checking');
    setErrorMsg('');

    try {
      const params = {
        check_in: booking.check_out,
        check_out: newCheckOut,
      };
      if (booking.boat_loa != null) params.boat_loa = booking.boat_loa;

      const res = await api.get('/public/bookings/available-berths/', { params });
      // Expect array of available berths; check if current berth is in the list
      const berths = res.data;
      const berthId = booking.berth ?? booking.berth_id;
      const isAvailable =
        Array.isArray(berths) &&
        (berthId != null
          ? berths.some(b => b.id === berthId || b.id === Number(berthId))
          : berths.length > 0);

      setStatus(isAvailable ? 'available' : 'unavailable');
    } catch {
      setStatus('unavailable');
    }
  }

  async function handleConfirm() {
    setStatus('submitting');
    try {
      const berthId = booking.berth ?? booking.berth_id;
      const payload = {
        check_in: booking.check_out,
        check_out: newCheckOut,
        berth: berthId,
        guest_name: booking.guest_name,
        guest_email: booking.guest_email,
        guest_phone: booking.guest_phone,
        boat_name: booking.boat_name,
        boat_loa: booking.boat_loa,
        boat_beam: booking.boat_beam,
        boat_draft: booking.boat_draft,
      };
      // Strip undefined/null keys to keep payload clean
      Object.keys(payload).forEach(k => payload[k] == null && delete payload[k]);

      await api.post('/public/bookings/', payload);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}
          aria-label="Back"
        >
          ←
        </button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Extend Your Stay</div>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>Request additional nights at the same berth</div>
        </div>
      </div>

      <div style={{ padding: '16px 16px 48px' }}>

        {status === 'success' ? (
          <div style={CARD}>
            <div style={{ fontSize: 32, marginBottom: 12, textAlign: 'center' }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2d4a', textAlign: 'center', marginBottom: 8 }}>
              Extension requested
            </div>
            <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', textAlign: 'center', lineHeight: 1.6 }}>
              The marina will confirm your extended stay by email.
            </div>
            <button style={BTN_GHOST} onClick={onBack}>Back to my booking</button>
          </div>
        ) : (
          <>
            <div style={CARD}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2d4a', marginBottom: 14 }}>
                Current check-out: <span style={{ fontWeight: 400 }}>{booking.check_out}</span>
              </div>
              <form onSubmit={handleCheck}>
                <div style={{ marginBottom: 16 }}>
                  <div style={LABEL}>New check-out date</div>
                  <input
                    type="date"
                    style={INPUT}
                    value={newCheckOut}
                    min={booking.check_out ? addDays(booking.check_out, 1) : undefined}
                    onChange={e => { setNewCheckOut(e.target.value); setStatus('idle'); }}
                    required
                  />
                </div>

                {status === 'idle' || status === 'error' ? (
                  <button type="submit" style={BTN_PRIMARY} disabled={!newCheckOut}>
                    Check availability
                  </button>
                ) : null}

                {status === 'checking' && (
                  <div style={{ textAlign: 'center', padding: '12px 0', color: 'rgba(0,0,0,0.45)', fontSize: 14 }}>
                    Checking availability…
                  </div>
                )}
              </form>

              {status === 'available' && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ background: '#eafaf1', borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 14, color: '#27ae60', fontWeight: 600 }}>
                    Your berth is free — you can extend your stay.
                  </div>
                  <button
                    style={{ ...BTN_PRIMARY, background: '#27ae60' }}
                    onClick={handleConfirm}
                  >
                    Confirm extension
                  </button>
                  <button style={BTN_GHOST} onClick={() => setStatus('idle')}>
                    Change dates
                  </button>
                </div>
              )}

              {status === 'unavailable' && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ background: '#fdf2f2', borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 14, color: '#c0392b', fontWeight: 600 }}>
                    Sorry, your berth isn't available for those dates. Please contact the marina.
                  </div>
                  <button style={BTN_GHOST} onClick={() => setStatus('idle')}>
                    Try different dates
                  </button>
                </div>
              )}

              {status === 'submitting' && (
                <div style={{ textAlign: 'center', padding: '12px 0', color: 'rgba(0,0,0,0.45)', fontSize: 14 }}>
                  Submitting request…
                </div>
              )}

              {status === 'error' && errorMsg && (
                <div style={{ background: '#fdf2f2', borderRadius: 8, padding: '10px 14px', marginTop: 8, fontSize: 13, color: '#c0392b' }}>
                  {errorMsg}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
