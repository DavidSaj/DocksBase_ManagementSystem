import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

const PAYMENT_METHODS = [
  { id: 'cash',          label: 'Cash' },
  { id: 'card',          label: 'Card' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
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

  if (checkedOut) {
    const amount = checkedOut.amount ?? selected?.amount;
    return (
      <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="check-circle" size={56} color="#27ae60" strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Checked Out</div>
          <div style={{
            background: '#fff', borderRadius: 14, padding: 24,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24, textAlign: 'left',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#0c1f3d' }}>Receipt</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Vessel</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{vesselLabel(selected)}</span>
            </div>
            {amount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Amount paid</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0c1f3d' }}>€{Number(amount).toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Payment method</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{paymentLabel(paymentMethod)}</span>
            </div>
          </div>
          <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  if (selected) {
    const berth = berthCode(selected);
    return (
      <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={() => { setSelected(null); setPaymentMethod(null); setError(null); }}><Icon name="arrow-left" size={22} color="#fff" /></button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arrived: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Departs: {selected.check_out}</div>
            {selected.nights && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Nights: {selected.nights}</div>}
            {selected.amount && (
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0c1f3d', marginTop: 10 }}>
                €{Number(selected.amount).toFixed(2)}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
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
                    display: 'flex', alignItems: 'center',
                    width: '100%', padding: '16px 18px', borderRadius: 14,
                    border: `2px solid ${isSelected ? '#0c1f3d' : 'rgba(0,0,0,0.1)'}`,
                    background: isSelected ? '#0c1f3d' : '#fff',
                    color: isSelected ? '#fff' : '#0c1f3d',
                    cursor: 'pointer', textAlign: 'left',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'Jost, system-ui, sans-serif' }}>{m.label}</span>
                </button>
              );
            })}
          </div>

          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}

          <button
            style={{ ...ACTION_BTN, opacity: paymentMethod ? 1 : 0.4, cursor: paymentMethod ? 'pointer' : 'default' }}
            disabled={!paymentMethod || saving}
            onClick={handleCheckOut}
          >
            {saving ? 'Saving…' : 'Confirm Check-Out'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
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
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="anchor" size={36} color="rgba(0,0,0,0.25)" />
          </div>
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
