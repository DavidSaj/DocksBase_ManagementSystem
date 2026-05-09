import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

const PAYMENT_METHODS = [
  { id: 'cash',          label: 'Cash',          icon: '💵' },
  { id: 'card',          label: 'Card',          icon: '💳' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: '🏦' },
];

function paymentLabel(method) {
  return PAYMENT_METHODS.find(m => m.id === method)?.label ?? method;
}

function vesselLabel(b) {
  if (b.vessel && typeof b.vessel === 'object') return b.vessel.name || b.guest_name || '—';
  return b.vessel_name || b.guest_name || '—';
}

function berthCode(b) {
  if (b.berth && typeof b.berth === 'object') return b.berth.code;
  return b.berth_code || null;
}

export default function CheckOutFlow({ onBack }) {
  const [allBookings, setAllBookings] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [checkedOut, setCheckedOut]   = useState(null);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'checked_in' } })
      .then(r => setAllBookings(r.data.results ?? r.data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = allBookings.filter(b => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (vesselLabel(b).toLowerCase().includes(q)) || ((berthCode(b) || '').toLowerCase().includes(q));
  });

  async function handleCheckOut() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch(`/bookings/${selected.id}/`, {
        status: 'checked_out',
        payment_method: paymentMethod,
      });
      setCheckedOut(data);
      setAllBookings(prev => prev.filter(b => b.id !== selected.id));
    } catch {
      setError('Check-out failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Success / receipt screen ──────────────────────────────────────────────
  if (checkedOut) {
    const amount = checkedOut.amount ?? selected?.amount;
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🧾</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Checked Out</div>

          {/* Receipt card */}
          <div style={{
            background: '#fff', borderRadius: 14, padding: 24,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24, textAlign: 'left',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#1a2d4a' }}>
              Receipt
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Vessel</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{vesselLabel(selected)}</span>
            </div>
            {amount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Amount paid</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1a2d4a' }}>
                  €{Number(amount).toFixed(2)}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Payment method</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {paymentLabel(paymentMethod)}
              </span>
            </div>
          </div>

          <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  // ── Booking details + payment method selection ────────────────────────────
  if (selected) {
    const berth = berthCode(selected);
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={() => { setSelected(null); setPaymentMethod(null); setError(null); }}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 20 }}>
          {/* Booking details card */}
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arrived: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Departs: {selected.check_out}</div>
            {selected.nights && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Nights: {selected.nights}</div>}
            {selected.amount && (
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1a2d4a', marginTop: 10 }}>
                €{Number(selected.amount).toFixed(2)}
              </div>
            )}
          </div>

          {/* Payment method selection */}
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Payment method
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {PAYMENT_METHODS.map(m => {
              const isSelected = paymentMethod === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setPaymentMethod(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    width: '100%', padding: '16px 18px', borderRadius: 14,
                    border: `2px solid ${isSelected ? '#1a2d4a' : 'rgba(0,0,0,0.1)'}`,
                    background: isSelected ? '#1a2d4a' : '#fff',
                    color: isSelected ? '#fff' : '#1a2d4a',
                    cursor: 'pointer', textAlign: 'left',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  <span style={{ fontSize: 26 }}>{m.icon}</span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{m.label}</span>
                </button>
              );
            })}
          </div>

          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}

          <button
            style={{
              ...ACTION_BTN,
              opacity: paymentMethod ? 1 : 0.4,
              cursor: paymentMethod ? 'pointer' : 'default',
            }}
            disabled={!paymentMethod || saving}
            onClick={handleCheckOut}
          >
            {saving ? 'Saving…' : '🚪 Confirm Check-Out'}
          </button>
        </div>
      </div>
    );
  }

  // ── Vessel list ───────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
      </div>
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', zIndex: 10 }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vessel or berth…"
          style={{ width: '100%', height: 40, padding: '0 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box' }}
        />
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚓</div>
          <div style={{ fontSize: 15 }}>{search ? 'No matches.' : 'No vessels checked in.'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => {
            const berth = berthCode(b);
            return (
              <div key={b.id} onClick={() => setSelected(b)}
                style={{ background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(b)}</div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                  {[berth ? `Berth ${berth}` : null, b.check_in].filter(Boolean).join(' · ')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
