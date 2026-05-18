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
      <div className="f-screen">
        <Topbar onBack={onBack} title="Message Guest" />
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="send" size={48} color="var(--db-gold-light)" strokeWidth={1.5} />
          </div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 8 }}>Message sent</div>
          <div style={{ fontSize: 14, color: 'var(--db-on-dark-muted)', marginBottom: 28 }}>
            Message sent to {sentTo}
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
        <Topbar onBack={() => { setSelected(null); setMessage(''); setError(null); }} title="Message Guest" />
        <div style={{ padding: 20 }}>
          <div className="f-card" style={{ margin: '0 0 20px' }}>
            <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 2 }}>Berth {berth}</div>}
            {selected.guest_email && (
              <div style={{ fontSize: 13, color: 'var(--db-on-dark-faint)' }}>{selected.guest_email}</div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--db-gold-light)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
            Message
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your message to the guest…"
            rows={5}
            className="f-textarea"
            style={{ marginBottom: 16 }}
          />

          {error && <div style={{ color: 'var(--db-status-red)', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}

          <button
            className="f-btn-primary"
            style={{ width: '100%' }}
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
    <div className="f-screen">
      <Topbar onBack={onBack} title="Message Guest" />
      <div style={{ position: 'sticky', top: 0, background: 'var(--db-bezel)', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', zIndex: 10 }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vessel, berth or guest…"
          className="f-input"
        />
      </div>
      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="f-dw-loading" style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="message-square" size={36} color="var(--db-on-dark-faint)" />
          </div>
          <div style={{ fontSize: 15 }}>{search ? 'No matches.' : 'No active bookings.'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
          {filtered.map(b => {
            const berth = berthCode(b);
            return (
              <div key={b.id} onClick={() => setSelected(b)} className="f-card" style={{ cursor: 'pointer' }}>
                <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(b)}</div>
                <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>
                  {[berth ? `Berth ${berth}` : null, b.guest_email || null].filter(Boolean).join(' · ')}
                </div>
                {b.status && (
                  <div style={{ fontSize: 11, marginTop: 4, color: 'var(--db-on-dark-faint)', textTransform: 'capitalize' }}>
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
