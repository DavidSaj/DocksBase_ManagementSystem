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

const HDR    = { background: '#0c1f3d', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff', minHeight: 56 };
const BACK   = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const BTN    = { width: '100%', height: 56, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif' };

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
    <div style={{ minHeight: '100vh', background: '#f4f3f0', paddingBottom: 80 }}>
      <div style={HDR}>
        <button style={BACK} onClick={onBack} aria-label="Back">
          <Icon name="chevron-left" size={22} color="#fff" />
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'Jost, system-ui, sans-serif' }}>Quick Charge</div>
      </div>
      <div style={{ padding: 16 }}>
        <input
          autoFocus
          placeholder="Name, berth, RES-…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width: '100%', height: 48, borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
            padding: '0 14px', fontSize: 15, boxSizing: 'border-box',
          }}
        />
        {err && <div style={{ color: '#dc2626', marginTop: 12 }}>{err}</div>}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => (
            <button key={r.reservation_id} onClick={() => onPick(r)} style={{
              textAlign: 'left', background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 12, padding: '14px 16px', cursor: 'pointer', minHeight: 56,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: '#b8965a',
                color: '#0c1f3d', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13,
              }}>{r.berth_code || '?'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0c1f3d' }}>{r.boat_name || '—'}</div>
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>{r.member_name}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && !err && (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>No active boats.</div>
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
    <div style={{ minHeight: '100vh', background: '#f4f3f0', paddingBottom: 80 }}>
      <div style={HDR}>
        <button style={BACK} onClick={onBack} aria-label="Back">
          <Icon name="chevron-left" size={22} color="#fff" />
        </button>
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 }}>Charging</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{boat.boat_name || boat.member_name || '—'} · {boat.berth_code}</div>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {err && <div style={{ color: '#dc2626', marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {items.map(item => (
            <div key={item.id} style={{
              background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.05)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: 130,
            }}>
              <button onClick={() => commit(item)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', flex: 1,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0c1f3d', lineHeight: 1.2 }}>{item.name}</div>
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>€{Number(item.unit_price).toFixed(2)}</div>
              </button>
              {item.qty_variable && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                  <button onClick={() => bump(item.id, -1)} style={stepBtn}>−</button>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0c1f3d', minWidth: 24, textAlign: 'center' }}>{getQty(item.id)}</div>
                  <button onClick={() => bump(item.id, 1)} style={stepBtn}>+</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {items.length === 0 && !err && (
          <div style={{ padding: 24, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>No quick-charge items configured.</div>
        )}
      </div>
    </div>
  );
}

const stepBtn = {
  width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)',
  background: '#f4f3f0', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#0c1f3d',
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
      position: 'fixed', left: 12, right: 12, bottom: 16, background: '#0c1f3d', color: '#fff',
      borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 50,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>€{toast.total} added</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{toast.description}</div>
      </div>
      <button onClick={onUndo} style={{
        background: '#b8965a', color: '#0c1f3d', border: 'none', borderRadius: 10,
        padding: '10px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13,
      }}>
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
    return <div style={{ padding: 24 }}>Submitting…</div>;
  }

  return (
    <>
      {!boat && <PickBoat onPick={setBoat} onBack={onBack} />}
      {boat && <PickItem boat={boat} onCommit={(item, qty) => post(boat, item, qty)} onBack={() => setBoat(null)} />}
      {err && (
        <div style={{
          position: 'fixed', left: 12, right: 12, bottom: 80, background: '#dc2626', color: '#fff',
          padding: '10px 14px', borderRadius: 10, zIndex: 60,
        }}>{err}</div>
      )}
      <UndoToast toast={toast} onUndo={handleUndo} onDismiss={() => setToast(null)} />
    </>
  );
}
