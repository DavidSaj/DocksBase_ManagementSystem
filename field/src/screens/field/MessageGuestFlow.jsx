import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif' };

const ACTIVE_STATUSES = ['checked_in', 'confirmed', 'pending'];

function vesselLabel(b) {
  if (b.vessel && typeof b.vessel === 'object') return b.vessel.name || b.guest_name || '—';
  return b.vessel_name || b.guest_name || '—';
}

function berthCode(b) {
  if (b.berth && typeof b.berth === 'object') return b.berth.code;
  return b.berth_code || null;
}

export default function MessageGuestFlow({ onBack }) {
  const [allBookings, setAllBookings] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);
  const [message, setMessage]         = useState('');
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState(null);
  const [sentTo, setSentTo]           = useState(null);

  useEffect(() => {
    Promise.all(
      ACTIVE_STATUSES.map(s => api.get('/bookings/', { params: { status: s } }).then(r => r.data.results ?? r.data))
    ).then(results => {
      const merged = results.flat();
      const seen = new Set();
      setAllBookings(merged.filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true; }));
    }).finally(() => setLoading(false));
  }, []);

  const filtered = allBookings.filter(b => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      vesselLabel(b).toLowerCase().includes(q) ||
      ((berthCode(b) || '').toLowerCase().includes(q)) ||
      (b.guest_name || '').toLowerCase().includes(q)
    );
  });

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { data } = await api.post('/mobile/send-guest-message/', {
        booking_id: selected.id,
        message: message.trim(),
      });
      setSentTo(data.guest_email || selected.guest_email || 'the guest');
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to send message. Please try again.';
      setError(detail);
    } finally {
      setSending(false);
    }
  }

  if (sentTo) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Message Guest</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="send" size={48} color="#0c1f3d" strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Message sent</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 28 }}>
            Message sent to {sentTo}
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
          <button style={BACK_BTN} onClick={() => { setSelected(null); setMessage(''); setError(null); }}><Icon name="arrow-left" size={22} color="#fff" /></button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Message Guest</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>Berth {berth}</div>}
            {selected.guest_email && (
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>{selected.guest_email}</div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
            Message
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your message to the guest…"
            rows={5}
            style={{
              width: '100%', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.15)',
              padding: '12px 14px', fontSize: 15, resize: 'vertical',
              fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 16,
            }}
          />

          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}

          <button
            style={{ ...ACTION_BTN, opacity: message.trim() ? 1 : 0.4, cursor: message.trim() ? 'pointer' : 'default' }}
            disabled={!message.trim() || sending}
            onClick={handleSend}
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Message Guest</span>
      </div>
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', zIndex: 10 }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vessel, berth or guest…"
          style={{ width: '100%', height: 40, padding: '0 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box' }}
        />
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="message-square" size={36} color="rgba(0,0,0,0.25)" />
          </div>
          <div style={{ fontSize: 15 }}>{search ? 'No matches.' : 'No active bookings.'}</div>
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
                  {[berth ? `Berth ${berth}` : null, b.guest_email || null].filter(Boolean).join(' · ')}
                </div>
                {b.status && (
                  <div style={{ fontSize: 11, marginTop: 4, color: 'rgba(0,0,0,0.35)', textTransform: 'capitalize' }}>
                    {b.status.replace('_', ' ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
