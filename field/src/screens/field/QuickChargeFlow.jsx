import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

// UUID v4 fallback (browsers without crypto.randomUUID).
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function Topbar({ onBack, title, sub }) {
  return (
    <div className="f-topbar">
      <button className="f-dw-back" onClick={onBack} aria-label="Back" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="chevron-left" size={18} color="var(--db-gold-light)" />
        Back
      </button>
      <div style={{ textAlign: 'center' }}>
        {sub && <div style={{ fontSize: 10, color: 'var(--db-gold-light)', textTransform: 'uppercase', letterSpacing: 2, fontWeight: 600 }}>{sub}</div>}
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>{title}</div>
      </div>
      <span style={{ width: 50 }} />
    </div>
  );
}

// ── Screen 1: pick a boat ───────────────────────────────────────────────────

function PickBoat({ onPick, onBack }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/quick-charge/active-boats/')
      .then(r => setRows(r.data || []))
      .catch(e => setErr(e.response?.data?.detail || 'Failed to load active boats.'));
  }, []);

  const q = filter.trim().toLowerCase();
  const filtered = q ? rows.filter(r =>
    (r.boat_name || '').toLowerCase().includes(q)
    || (r.member_name || '').toLowerCase().includes(q)
    || (r.berth_code || '').toLowerCase().includes(q)
    || String(r.reservation_id).includes(q)
  ) : rows;

  return (
    <div className="f-screen" style={{ paddingBottom: 80 }}>
      <Topbar onBack={onBack} title="Quick Charge" />
      <div style={{ padding: 16 }}>
        <input
          autoFocus
          placeholder="Name, berth, RES-…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="f-input"
        />
        {err && <div style={{ color: 'var(--db-status-red)', marginTop: 12 }}>{err}</div>}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => (
            <button key={r.reservation_id} onClick={() => onPick(r)} style={{
              textAlign: 'left', background: 'var(--db-card-bg)', border: 'var(--db-card-border)',
              borderRadius: 'var(--db-radius-md)', padding: '14px 16px', cursor: 'pointer', minHeight: 56,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 'var(--db-radius-sm)', background: 'var(--db-gold-light)',
                color: 'var(--db-navy)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13,
              }}>{r.berth_code || '?'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 17, fontWeight: 700, color: 'var(--db-on-dark)' }}>{r.boat_name || '—'}</div>
                <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)' }}>{r.member_name}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && !err && (
            <div className="f-dw-loading">No active boats.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Screen 2: pick an item ──────────────────────────────────────────────────

function PickItem({ boat, onCommit, onBack }) {
  const [items, setItems] = useState([]);
  const [qty, setQty] = useState({}); // item.id -> qty
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/quick-charge/items/')
      .then(r => setItems(r.data || []))
      .catch(e => setErr(e.response?.data?.detail || 'Failed to load items.'));
  }, []);

  function getQty(id) { return qty[id] ?? 1; }
  function bump(id, delta) {
    setQty(prev => {
      const next = Math.max(1, Math.min(99, (prev[id] ?? 1) + delta));
      return { ...prev, [id]: next };
    });
  }

  function commit(item) {
    onCommit(item, getQty(item.id));
  }

  return (
    <div className="f-screen" style={{ paddingBottom: 80 }}>
      <Topbar onBack={onBack} title={`${boat.boat_name || boat.member_name || '—'} · ${boat.berth_code}`} sub="Charging" />
      <div style={{ padding: 16 }}>
        {err && <div style={{ color: 'var(--db-status-red)', marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {items.map(item => (
            <div key={item.id} style={{
              background: 'var(--db-card-bg)', borderRadius: 'var(--db-radius-md)', border: 'var(--db-card-border)',
              padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: 130,
            }}>
              <button onClick={() => commit(item)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', flex: 1,
              }}>
                <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 16, fontWeight: 700, color: 'var(--db-on-dark)', lineHeight: 1.2 }}>{item.name}</div>
                <div style={{ fontSize: 13, color: 'var(--db-gold-light)', marginTop: 4, fontWeight: 600 }}>€{Number(item.unit_price).toFixed(2)}</div>
              </button>
              {item.qty_variable && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                  <button onClick={() => bump(item.id, -1)} style={stepBtn}>−</button>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--db-on-dark)', minWidth: 24, textAlign: 'center' }}>{getQty(item.id)}</div>
                  <button onClick={() => bump(item.id, 1)} style={stepBtn}>+</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {items.length === 0 && !err && (
          <div className="f-dw-loading">No quick-charge items configured.</div>
        )}
      </div>
    </div>
  );
}

const stepBtn = {
  width: 36, height: 36, borderRadius: 'var(--db-radius-sm)', border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)',
};

// ── Undo toast ──────────────────────────────────────────────────────────────

function UndoToast({ toast, onUndo, onDismiss }) {
  const [secondsLeft, setSecondsLeft] = useState(30);
  useEffect(() => {
    if (!toast) return;
    setSecondsLeft(30);
    const start = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, 30 - Math.floor((Date.now() - start) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) { clearInterval(id); onDismiss(); }
    }, 250);
    return () => clearInterval(id);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 16, background: 'var(--db-bezel)', color: 'var(--db-on-dark)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 'var(--db-radius-md)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 50,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--db-gold-light)' }}>€{toast.total} added</div>
        <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>{toast.description}</div>
      </div>
      <button onClick={onUndo} className="f-btn-primary" style={{ padding: '10px 16px', fontSize: 13 }}>
        Undo {secondsLeft}s
      </button>
    </div>
  );
}

// ── Root flow ───────────────────────────────────────────────────────────────

export default function QuickChargeFlow({ onBack }) {
  const [boat, setBoat] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const post = useCallback(async (boatRow, item, qty) => {
    const key = uuidv4();
    const body = {
      reservation_id: boatRow.reservation_id,
      item_id: item.id,
      qty,
      idempotency_key: key,
    };
    setBusy(true);
    setErr(null);
    try {
      // Retry once on network failure using the same idempotency key.
      let resp;
      try {
        resp = await api.post('/quick-charge/', body, { headers: { 'Idempotency-Key': key } });
      } catch (e) {
        if (!e.response) {
          resp = await api.post('/quick-charge/', body, { headers: { 'Idempotency-Key': key } });
        } else {
          throw e;
        }
      }
      setToast({
        line_id: resp.data.invoice_line_id,
        undo_token: resp.data.undo_token,
        total: resp.data.total_price,
        description: resp.data.description,
      });
      setBoat(null); // return to boat list
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to add charge.');
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleUndo() {
    if (!toast) return;
    try {
      await api.post(`/quick-charge/${toast.line_id}/undo/`, { undo_token: toast.undo_token });
    } catch (_) {
      // best-effort; toast dismisses below
    }
    setToast(null);
  }

  if (busy && !boat) {
    return <div className="f-dw-loading" style={{ padding: 24 }}>Submitting…</div>;
  }

  return (
    <>
      {!boat && <PickBoat onPick={setBoat} onBack={onBack} />}
      {boat && <PickItem boat={boat} onCommit={(item, qty) => post(boat, item, qty)} onBack={() => setBoat(null)} />}
      {err && (
        <div style={{
          position: 'fixed', left: 12, right: 12, bottom: 80, background: 'rgba(224,85,85,0.15)', color: 'var(--db-status-red)',
          border: '1px solid rgba(224,85,85,0.3)',
          padding: '10px 14px', borderRadius: 'var(--db-radius-sm)', zIndex: 60,
        }}>{err}</div>
      )}
      <UndoToast toast={toast} onUndo={handleUndo} onDismiss={() => setToast(null)} />
    </>
  );
}
