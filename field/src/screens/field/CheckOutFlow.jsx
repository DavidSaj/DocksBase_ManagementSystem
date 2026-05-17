import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

function Topbar({ onBack, title }) {
  return (
    <div className="f-topbar">
      <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
        Back
      </button>
      <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>{title}</span>
      <span style={{ width: 50 }} />
    </div>
  );
}

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
      <div className="f-screen">
        <Topbar onBack={onBack} title="Check Out" />
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="check-circle" size={56} color="var(--db-status-green)" strokeWidth={1.5} />
          </div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 20 }}>Checked Out</div>
          <div className="f-card" style={{ margin: '0 0 24px', textAlign: 'left', padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--db-gold-light)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Receipt</div>
            <div className="f-row">
              <span className="f-row__label">Vessel</span>
              <span className="f-row__value">{vesselLabel(selected)}</span>
            </div>
            {amount && (
              <div className="f-row">
                <span className="f-row__label">Amount paid</span>
                <span className="f-row__value" style={{ color: 'var(--db-gold-light)' }}>€{Number(amount).toFixed(2)}</span>
              </div>
            )}
            <div className="f-row">
              <span className="f-row__label">Payment method</span>
              <span className="f-row__value">{paymentLabel(paymentMethod)}</span>
            </div>
          </div>
          <button className="f-btn-primary" style={{ width: '100%' }} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  if (selected) {
    const berth = berthCode(selected);
    return (
      <div className="f-screen">
        <Topbar onBack={() => { setSelected(null); setPaymentMethod(null); setError(null); }} title="Check Out" />
        <div style={{ padding: 20 }}>
          <div className="f-card" style={{ margin: '0 0 20px' }}>
            <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 4 }}>Arrived: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 4 }}>Departs: {selected.check_out}</div>
            {selected.nights && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 4 }}>Nights: {selected.nights}</div>}
            {selected.amount && (
              <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 26, fontWeight: 700, color: 'var(--db-gold-light)', marginTop: 10 }}>
                €{Number(selected.amount).toFixed(2)}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--db-gold-light)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
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
                    width: '100%', padding: '16px 18px', borderRadius: 'var(--db-radius-sm)',
                    border: `1px solid ${isSelected ? 'var(--db-gold-light)' : 'rgba(255,255,255,0.12)'}`,
                    background: isSelected ? 'rgba(212,176,122,0.15)' : 'var(--db-card-bg)',
                    color: 'var(--db-on-dark)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--db-font-sans)' }}>{m.label}</span>
                </button>
              );
            })}
          </div>

          {error && <div style={{ color: 'var(--db-status-red)', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}

          <button
            className="f-btn-primary"
            style={{ width: '100%' }}
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
    <div className="f-screen">
      <Topbar onBack={onBack} title="Check Out" />
      <div style={{ position: 'sticky', top: 0, background: 'var(--db-bezel)', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', zIndex: 10 }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vessel or berth…"
          className="f-input"
        />
      </div>
      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="f-dw-loading" style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="anchor" size={36} color="var(--db-on-dark-faint)" />
          </div>
          <div style={{ fontSize: 15 }}>{search ? 'No matches.' : 'No vessels checked in.'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
          {filtered.map(b => {
            const berth = berthCode(b);
            return (
              <div key={b.id} onClick={() => setSelected(b)} className="f-card" style={{ cursor: 'pointer' }}>
                <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(b)}</div>
                <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>
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
