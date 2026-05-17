import { useState } from 'react';
import useStorageSlots from '../../hooks/useStorageSlots.js';

/**
 * Bulk dry-storage slot setup. Used in two places:
 *  - Boatyard "Dry Storage Map" tab as a quick-create CTA when no slots exist
 *  - Infrastructure "Dry Storage" tab as the canonical management UI
 *
 * Props:
 *   compact?: boolean — true = button + modal; false = inline panel.
 *   onCreated?: () => void — fires after a successful create (for parents that
 *               want to re-fetch or change view state).
 */
export default function DryStorageSetup({ compact = false, onCreated }) {
  const { slots, createSlot } = useStorageSlots();
  const [open, setOpen] = useState(!compact);
  const [lane, setLane] = useState('A');
  const [cols, setCols] = useState(5);
  const [tiers, setTiers] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastCreated, setLastCreated] = useState(0);

  async function handleSubmit(e) {
    e?.preventDefault();
    setSaving(true);
    setError('');
    const want = [];
    for (let c = 1; c <= Number(cols); c++) {
      for (let t = 1; t <= Number(tiers); t++) {
        want.push({ lane: String(lane).trim(), col: String(c), tier: t });
      }
    }
    // Skip ones that already exist for this marina.
    const have = new Set(slots.map(s => `${s.lane}|${s.col}|${s.tier}`));
    const toCreate = want.filter(s => !have.has(`${s.lane}|${s.col}|${s.tier}`));
    let created = 0;
    try {
      for (const p of toCreate) {
        await createSlot(p);
        created += 1;
      }
      setLastCreated(created);
      onCreated?.();
      if (compact) setOpen(false);
    } catch (ex) {
      setError(ex?.response?.data?.detail ?? ex?.message ?? 'Failed to create slots.');
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.55)', lineHeight: 1.5 }}>
        Slots are organised by <b>lane</b> (a row of cradles), <b>column</b>
        {' '}(position in the row), and <b>tier</b> (vertical stack — set to 1
        for ground-level only). Existing slots are skipped, so it&apos;s safe
        to re-run this for additional lanes.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase' }}>Lane</span>
          <input value={lane} onChange={e => setLane(e.target.value)} placeholder="A" required maxLength={50} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase' }}>Columns</span>
          <input type="number" min={1} max={200} value={cols} onChange={e => setCols(e.target.value)} required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase' }}>Tiers</span>
          <input type="number" min={1} max={5} value={tiers} onChange={e => setTiers(e.target.value)} required />
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
        Will create up to <b>{Number(cols) * Number(tiers) || 0}</b> slots in lane <b>{lane || '—'}</b>.
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
      {!error && lastCreated > 0 && (
        <div style={{ fontSize: 12, color: 'var(--green)' }}>Created {lastCreated} slot{lastCreated === 1 ? '' : 's'}.</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Creating…' : 'Create slots'}
        </button>
        {compact && (
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
        )}
      </div>
    </form>
  );

  if (!compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Add dry-storage slots</div>
          {form}
        </div>
        <div className="card" style={{ padding: 16, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          <b>Current capacity:</b> {slots.length} slot{slots.length === 1 ? '' : 's'} across{' '}
          {new Set(slots.map(s => s.lane)).size} lane(s).
        </div>
      </div>
    );
  }

  // compact mode → button + inline panel
  return (
    <div>
      {!open ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          Set up dry storage
        </button>
      ) : (
        <div className="card" style={{ padding: 16, marginTop: 8, maxWidth: 520 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add dry-storage slots</div>
          {form}
        </div>
      )}
    </div>
  );
}
