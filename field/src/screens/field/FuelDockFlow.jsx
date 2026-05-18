import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

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
      background: 'rgba(212,176,122,0.1)',
      border: '1px solid rgba(212,176,122,0.3)',
      borderRadius: 'var(--db-radius-md)',
      padding: 22,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 'var(--db-radius-sm)', background: 'var(--db-gold-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="droplet" size={18} color="var(--db-navy)" />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--db-gold-light)', fontFamily: 'var(--db-font-sans)' }}>Now Fueling</div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', lineHeight: 1.2 }}>{displayName(entry)}</div>
        </div>
        {elapsed && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--db-on-dark-muted)' }}>
            <Icon name="clock" size={13} color="var(--db-on-dark-muted)" />
            <span style={{ fontSize: 13 }}>{elapsed}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span className="f-pill f-pill--gold">{fuelLabel(entry.fuel_type)}</span>
        {entry.estimated_litres && (
          <span className="f-pill">~{entry.estimated_litres}L estimated</span>
        )}
      </div>
      <button onClick={onComplete} className="f-btn-primary" style={{ width: '100%' }}>
        Complete Fueling
      </button>
    </div>
  );
}

function NextCard({ entry, onAtPump, acting }) {
  return (
    <div className="f-card" style={{ borderColor: 'rgba(212,176,122,0.3)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--db-gold-light)', marginBottom: 4 }}>Next Up — SMS Sent</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>{displayName(entry)}</div>
          <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)', marginTop: 2 }}>{fuelLabel(entry.fuel_type)}</div>
        </div>
        <button
          disabled={acting}
          onClick={onAtPump}
          className="f-btn-primary"
          style={{ padding: '10px 18px', fontSize: 13, whiteSpace: 'nowrap' }}
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
      <div className="f-section-title">Queue — {entries.length} waiting</div>
      {entries.map((entry, idx) => (
        <div key={entry.id} className="f-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--db-radius-sm)', background: 'rgba(212,176,122,0.12)', border: '1px solid rgba(212,176,122,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--db-gold-light)', flexShrink: 0 }}>
              {idx + 1}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--db-on-dark)' }}>{displayName(entry)}</div>
              <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>{fuelLabel(entry.fuel_type)}{entry.estimated_litres ? ` · ~${entry.estimated_litres}L` : ''}</div>
            </div>
          </div>
          {idx === 0 && (
            <button
              disabled={acting}
              onClick={() => onCallNext(entry)}
              className="f-btn-ghost"
              style={{ padding: '8px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
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

  const LABEL = { fontSize: 11, fontWeight: 700, color: 'var(--db-gold-light)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--db-font-sans)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 50 }}>
      <div style={{ background: 'var(--db-bezel)', borderTop: '1px solid rgba(255,255,255,0.07)', borderRadius: '20px 20px 0 0', padding: '24px 20px 32px' }}>
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 20 }}>Add to Fuel Queue</div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>Vessel / Guest name *</label>
            <input className="f-input" value={form.guest_description} onChange={e => set('guest_description', e.target.value)} placeholder="e.g. Sea Breeze or John Smith" autoFocus />
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
                    flex: 1, padding: '10px 0', borderRadius: 'var(--db-radius-sm)',
                    border: `1px solid ${form.fuel_type === f.id ? 'var(--db-gold-light)' : 'rgba(255,255,255,0.12)'}`,
                    background: form.fuel_type === f.id ? 'rgba(212,176,122,0.15)' : 'var(--db-card-bg)',
                    color: 'var(--db-on-dark)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'var(--db-font-sans)',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={LABEL}>Estimated litres <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--db-on-dark-faint)' }}>(optional)</span></label>
            <input className="f-input" type="number" min="1" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} placeholder="e.g. 80" />
          </div>
          {error && <div style={{ color: 'var(--db-status-red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="f-btn-primary" style={{ width: '100%', marginBottom: 10 }} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add to Queue'}
          </button>
          <button type="button" onClick={onCancel} style={{ width: '100%', height: 44, background: 'none', border: 'none', fontSize: 15, color: 'var(--db-on-dark-muted)', cursor: 'pointer' }}>
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

  const LABEL = { fontSize: 11, fontWeight: 700, color: 'var(--db-gold-light)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--db-font-sans)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 50 }}>
      <div style={{ background: 'var(--db-bezel)', borderTop: '1px solid rgba(255,255,255,0.07)', borderRadius: '20px 20px 0 0', padding: '24px 20px 32px' }}>
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>Complete Fueling</div>
        <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 20 }}>{displayName(entry)} · {fuelLabel(entry.fuel_type)}</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Actual litres *</label>
              <input className="f-input" type="number" min="0" step="0.1" value={litres} onChange={e => setLitres(e.target.value)} placeholder="0.0" autoFocus />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>€ per litre</label>
              <input className="f-input" type="number" min="0" step="0.001" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.000" />
            </div>
          </div>
          {total && (
            <div style={{ background: 'var(--db-card-bg)', border: 'var(--db-card-border)', borderRadius: 'var(--db-radius-sm)', padding: '12px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--db-on-dark-muted)' }}>Total</span>
              <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-gold-light)' }}>€{total}</span>
            </div>
          )}
          {error && <div style={{ color: 'var(--db-status-red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="f-btn-primary" style={{ width: '100%', marginBottom: 10 }} disabled={submitting}>
            {submitting ? 'Saving…' : 'Complete & Bill'}
          </button>
          <button type="button" onClick={onCancel} style={{ width: '100%', height: 44, background: 'none', border: 'none', fontSize: 15, color: 'var(--db-on-dark-muted)', cursor: 'pointer' }}>
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
    <div className="f-screen" style={{ paddingBottom: 100 }}>
      <div className="f-topbar">
        <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
          Back
        </button>
        <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>Fuel Dock</span>
        <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--db-on-dark-muted)', padding: '4px 8px' }}>
          <Icon name="clock" size={18} color="var(--db-on-dark-muted)" />
        </button>
      </div>

      {loading ? (
        <div className="f-dw-loading">Loading…</div>
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
            <div className="f-dw-loading" style={{ padding: 60 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                <Icon name="droplet" size={40} color="var(--db-on-dark-faint)" />
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
          className="f-btn-primary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Icon name="plus-circle" size={18} color="var(--db-navy)" />
          Add to Queue
        </button>
      </div>

      {showAdd && <AddForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} />}
      {completing && <CompleteModal entry={completing} onComplete={handleComplete} onCancel={() => setCompleting(null)} />}
    </div>
  );
}
