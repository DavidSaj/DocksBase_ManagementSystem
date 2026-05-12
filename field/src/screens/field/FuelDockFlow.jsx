import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const ACTION_BTN = { width: '100%', height: 56, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif' };

const FUEL_TYPES = [
  { id: 'diesel',   label: 'Diesel' },
  { id: 'petrol',   label: 'Petrol' },
  { id: 'pump_out', label: 'Pump-out' },
];

function fuelLabel(type) {
  return FUEL_TYPES.find(f => f.id === type)?.label ?? type;
}

function displayName(entry) {
  return entry.vessel_name || entry.guest_description || '—';
}

function useElapsed(startIso) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startIso) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [startIso]);
  if (!startIso) return null;
  const secs = Math.floor((Date.now() - new Date(startIso)) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// ── Sub-views ────────────────────────────────────────────────────────────────

function ActiveCard({ entry, onComplete }) {
  const elapsed = useElapsed(entry.service_start);
  return (
    <div style={{
      margin: '16px 16px 0',
      background: '#0c1f3d',
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 4px 20px rgba(12,31,61,0.18)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#b8965a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="droplet" size={18} color="#0c1f3d" />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#b8965a', fontFamily: 'Jost, system-ui, sans-serif' }}>Now Fueling</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{displayName(entry)}</div>
        </div>
        {elapsed && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(245,240,230,0.55)' }}>
            <Icon name="clock" size={13} color="rgba(245,240,230,0.55)" />
            <span style={{ fontSize: 13, fontFamily: 'IBM Plex Sans, system-ui, sans-serif' }}>{elapsed}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: 'rgba(245,240,230,0.8)', fontSize: 12, fontWeight: 600 }}>
          {fuelLabel(entry.fuel_type)}
        </span>
        {entry.estimated_litres && (
          <span style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'rgba(245,240,230,0.6)', fontSize: 12 }}>
            ~{entry.estimated_litres}L estimated
          </span>
        )}
      </div>
      <button onClick={onComplete} style={{ ...ACTION_BTN, background: '#b8965a', color: '#0c1f3d' }}>
        Complete Fueling
      </button>
    </div>
  );
}

function NextCard({ entry, onAtPump, acting }) {
  return (
    <div style={{
      margin: '12px 16px 0',
      background: '#fff',
      borderRadius: 14,
      padding: 16,
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      border: '1.5px solid rgba(184,150,90,0.3)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#b8965a', marginBottom: 4, fontFamily: 'Jost, system-ui, sans-serif' }}>Next Up — SMS Sent</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0c1f3d' }}>{displayName(entry)}</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{fuelLabel(entry.fuel_type)}</div>
        </div>
        <button
          disabled={acting}
          onClick={onAtPump}
          style={{ padding: '10px 18px', borderRadius: 10, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif', whiteSpace: 'nowrap' }}
        >
          At Pump
        </button>
      </div>
    </div>
  );
}

function QueueList({ entries, onCallNext, acting }) {
  return (
    <div>
      <div style={{ padding: '16px 16px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', fontFamily: 'Jost, system-ui, sans-serif' }}>
        Queue — {entries.length} waiting
      </div>
      {entries.map((entry, idx) => (
        <div key={entry.id} style={{ margin: '0 16px 8px', background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(12,31,61,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#0c1f3d', fontFamily: 'Jost, system-ui, sans-serif', flexShrink: 0 }}>
              {idx + 1}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0c1f3d' }}>{displayName(entry)}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{fuelLabel(entry.fuel_type)}{entry.estimated_litres ? ` · ~${entry.estimated_litres}L` : ''}</div>
            </div>
          </div>
          {idx === 0 && (
            <button
              disabled={acting}
              onClick={() => onCallNext(entry)}
              style={{ padding: '8px 14px', borderRadius: 8, background: '#f4f3f0', border: '1.5px solid rgba(0,0,0,0.1)', color: '#0c1f3d', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif', whiteSpace: 'nowrap' }}
            >
              Call Next
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddForm({ onAdd, onCancel }) {
  const [form, setForm] = useState({ guest_description: '', fuel_type: 'diesel', estimated_litres: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.guest_description.trim()) { setError('Vessel or guest name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        guest_description: form.guest_description.trim(),
        fuel_type: form.fuel_type,
      };
      if (form.estimated_litres) payload.estimated_litres = parseFloat(form.estimated_litres);
      await onAdd(payload);
    } catch {
      setError('Could not add to queue. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const LABEL = { fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'Jost, system-ui, sans-serif' };
  const INPUT = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px 32px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#0c1f3d', marginBottom: 20, fontFamily: 'Jost, system-ui, sans-serif' }}>Add to Fuel Queue</div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>Vessel / Guest name *</label>
            <input style={INPUT} value={form.guest_description} onChange={e => set('guest_description', e.target.value)} placeholder="e.g. Sea Breeze or John Smith" autoFocus />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>Fuel type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {FUEL_TYPES.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => set('fuel_type', f.id)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 10,
                    border: `2px solid ${form.fuel_type === f.id ? '#0c1f3d' : 'rgba(0,0,0,0.12)'}`,
                    background: form.fuel_type === f.id ? '#0c1f3d' : '#fff',
                    color: form.fuel_type === f.id ? '#fff' : '#0c1f3d',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'Jost, system-ui, sans-serif',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={LABEL}>Estimated litres <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'rgba(0,0,0,0.35)' }}>(optional)</span></label>
            <input style={INPUT} type="number" min="1" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} placeholder="e.g. 80" />
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" style={{ ...ACTION_BTN, marginBottom: 10 }} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add to Queue'}
          </button>
          <button type="button" onClick={onCancel} style={{ width: '100%', height: 44, background: 'none', border: 'none', fontSize: 15, color: 'rgba(0,0,0,0.45)', cursor: 'pointer' }}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

function CompleteModal({ entry, onComplete, onCancel }) {
  const [litres, setLitres] = useState('');
  const [price, setPrice]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const total = litres && price ? (parseFloat(litres) * parseFloat(price)).toFixed(2) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!litres) { setError('Enter actual litres dispensed.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await onComplete({ actual_litres: parseFloat(litres), price_per_litre: price ? parseFloat(price) : undefined });
    } catch {
      setError('Could not complete. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const LABEL = { fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'Jost, system-ui, sans-serif' };
  const INPUT = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px 32px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#0c1f3d', marginBottom: 4, fontFamily: 'Jost, system-ui, sans-serif' }}>Complete Fueling</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>{displayName(entry)} · {fuelLabel(entry.fuel_type)}</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Actual litres *</label>
              <input style={INPUT} type="number" min="0" step="0.1" value={litres} onChange={e => setLitres(e.target.value)} placeholder="0.0" autoFocus />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>€ per litre</label>
              <input style={INPUT} type="number" min="0" step="0.001" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.000" />
            </div>
          </div>
          {total && (
            <div style={{ background: '#f4f3f0', borderRadius: 10, padding: '12px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Total</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#0c1f3d', fontFamily: 'Jost, system-ui, sans-serif' }}>€{total}</span>
            </div>
          )}
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" style={{ ...ACTION_BTN, background: '#b8965a', color: '#0c1f3d', marginBottom: 10 }} disabled={submitting}>
            {submitting ? 'Saving…' : 'Complete & Bill'}
          </button>
          <button type="button" onClick={onCancel} style={{ width: '100%', height: 44, background: 'none', border: 'none', fontSize: 15, color: 'rgba(0,0,0,0.45)', cursor: 'pointer' }}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function FuelDockFlow({ onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [completing, setCompleting] = useState(null);

  const load = useCallback(() => {
    return api.get('/fuel-dock/queue/', { params: { active: 1 } })
      .then(r => setEntries(r.data.results ?? r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const inService = entries.find(e => e.status === 'service');
  const inNext    = entries.find(e => e.status === 'next');
  const waiting   = entries.filter(e => e.status === 'waiting');

  async function advance(entry, extraData = {}) {
    const transitions = { waiting: 'next', next: 'service', service: 'completed' };
    setActing(true);
    try {
      await api.patch(`/fuel-dock/queue/${entry.id}/`, { status: transitions[entry.status], ...extraData });
      await load();
    } finally {
      setActing(false);
    }
  }

  async function handleAdd(payload) {
    await api.post('/fuel-dock/queue/', payload);
    setShowAdd(false);
    await load();
  }

  async function handleComplete(data) {
    await advance(completing, data);
    setCompleting(null);
  }

  const isEmpty = !inService && !inNext && waiting.length === 0;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0', paddingBottom: 100 }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Fuel Dock</span>
        <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', padding: '4px 8px' }}>
          <Icon name="clock" size={18} color="rgba(255,255,255,0.6)" />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : (
        <>
          {inService && (
            <ActiveCard entry={inService} onComplete={() => setCompleting(inService)} />
          )}

          {inNext && (
            <NextCard entry={inNext} onAtPump={() => advance(inNext)} acting={acting} />
          )}

          {waiting.length > 0 && (
            <div style={{ marginTop: inService || inNext ? 16 : 12 }}>
              <QueueList entries={waiting} onCallNext={e => advance(e)} acting={acting} />
            </div>
          )}

          {isEmpty && (
            <div style={{ padding: 60, textAlign: 'center', color: 'rgba(0,0,0,0.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                <Icon name="droplet" size={40} color="rgba(0,0,0,0.15)" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Queue is clear</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>No vessels waiting for fuel.</div>
            </div>
          )}
        </>
      )}

      {/* Add to queue button */}
      <div style={{ position: 'fixed', bottom: 24, left: 16, right: 16 }}>
        <button
          onClick={() => setShowAdd(true)}
          style={{ ...ACTION_BTN, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Icon name="plus-circle" size={18} color="#fff" />
          Add to Queue
        </button>
      </div>

      {showAdd && <AddForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} />}
      {completing && <CompleteModal entry={completing} onComplete={handleComplete} onCancel={() => setCompleting(null)} />}
    </div>
  );
}
