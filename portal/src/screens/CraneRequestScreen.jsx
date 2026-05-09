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
const LABEL = { fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 };
const INPUT = {
  width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 8,
  border: '1.5px solid #d0d6de', boxSizing: 'border-box', outline: 'none',
};

const SERVICE_OPTIONS = [
  { value: 'launch',   label: 'Launch',   icon: '⬇️', desc: 'Put your vessel in the water' },
  { value: 'haul_out', label: 'Haul-Out', icon: '⬆️', desc: 'Lift your vessel out of the water' },
  { value: 'both',     label: 'Both',     icon: '↕️', desc: 'Haul-out and re-launch' },
];

function todayPlusOne() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function CraneRequestScreen({ booking, onBack }) {
  const [serviceType, setServiceType] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const minDate = todayPlusOne();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceType || !preferredDate) return;
    setStatus('submitting');
    setErrorMsg('');

    try {
      await api.post('/portal/crane-requests/', {
        service_type: serviceType,
        preferred_date: preferredDate,
        notes: notes.trim() || undefined,
        booking: booking.id,
      });
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
          <div style={{ fontSize: 20, fontWeight: 700 }}>Crane / Lift Request</div>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>Request a hoist service from the harbour team</div>
        </div>
      </div>

      <div style={{ padding: '16px 16px 48px' }}>

        {status === 'success' ? (
          <div style={CARD}>
            <div style={{ fontSize: 32, marginBottom: 12, textAlign: 'center' }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2d4a', textAlign: 'center', marginBottom: 8 }}>
              Request submitted
            </div>
            <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', textAlign: 'center', lineHeight: 1.6 }}>
              The harbour team will contact you to confirm the time.
            </div>
            <button style={BTN_GHOST} onClick={onBack}>Back to my booking</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>

            <div style={CARD}>
              <div style={LABEL}>Service type</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {SERVICE_OPTIONS.map(opt => {
                  const selected = serviceType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setServiceType(opt.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 16px',
                        borderRadius: 10,
                        border: selected ? '2px solid #1a2d4a' : '1.5px solid #d0d6de',
                        background: selected ? '#eef1f7' : '#fff',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border 0.15s, background 0.15s',
                      }}
                    >
                      <span style={{ fontSize: 26, lineHeight: 1 }}>{opt.icon}</span>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2d4a' }}>{opt.label}</div>
                        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>{opt.desc}</div>
                      </div>
                      {selected && (
                        <span style={{ marginLeft: 'auto', color: '#1a2d4a', fontSize: 18, fontWeight: 700 }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={CARD}>
              <div style={LABEL}>Preferred date</div>
              <input
                type="date"
                style={INPUT}
                value={preferredDate}
                min={minDate}
                onChange={e => setPreferredDate(e.target.value)}
                required
              />
            </div>

            <div style={CARD}>
              <div style={LABEL}>Notes (optional)</div>
              <textarea
                style={{ ...INPUT, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="e.g. hull inspection needed, preferred time of day…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {status === 'error' && errorMsg && (
              <div style={{ background: '#fdf2f2', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 13, color: '#c0392b' }}>
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              style={{ ...BTN_PRIMARY, opacity: (!serviceType || !preferredDate || status === 'submitting') ? 0.5 : 1 }}
              disabled={!serviceType || !preferredDate || status === 'submitting'}
            >
              {status === 'submitting' ? 'Submitting…' : 'Submit request'}
            </button>
            <button type="button" style={BTN_GHOST} onClick={onBack}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
