import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import ScreenInfo from '../components/ui/ScreenInfo.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function fmtCurrency(n) {
  if (n == null) return '—';
  return '€' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const TIER_COLOURS = ['#7c8fa6', '#c0a45c', '#6b9e78', '#1a2d4a', '#7c3aed'];

function TierBadge({ name, rank }) {
  const colour = TIER_COLOURS[rank % TIER_COLOURS.length] ?? '#1a2d4a';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px',
      borderRadius: 12, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.3px',
      background: colour + '18', color: colour, border: `1px solid ${colour}44`,
    }}>
      {name ?? 'No Tier'}
    </span>
  );
}

function EntryTypeBadge({ type }) {
  const map = {
    earn: { label: 'Earned', bg: '#d1fae5', color: '#065f46' },
    redeem: { label: 'Redeemed', bg: '#dbeafe', color: '#1e40af' },
    expire: { label: 'Expired', bg: '#fee2e2', color: '#991b1b' },
    adjust: { label: 'Adjusted', bg: '#fef3c7', color: '#92400e' },
    referral: { label: 'Referral', bg: '#ede9fe', color: '#5b21b6' },
  };
  const s = map[type] ?? { label: type, bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>{s.label}</span>
  );
}

function BenefitStatusBadge({ status }) {
  const map = {
    pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
    applied: { label: 'Applied', bg: '#d1fae5', color: '#065f46' },
    rejected: { label: 'Rejected', bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { label: status, bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>{s.label}</span>
  );
}

function EmptyState({ icon, message }) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'rgba(0,0,0,0.35)' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{message}</div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      Loading…
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  const bg = type === 'error' ? '#fee2e2' : '#d1fae5';
  const color = type === 'error' ? '#991b1b' : '#065f46';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: bg, color, borderRadius: 8, padding: '12px 20px',
      fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      maxWidth: 360,
    }}>
      {message}
    </div>
  );
}

// ── Award Points Modal ─────────────────────────────────────────────────────

function AwardPointsModal({ membership, onClose, onSuccess }) {
  const [points, setPoints] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const pts = parseInt(points, 10);
    if (!pts || isNaN(pts)) { setError('Enter a valid number of points.'); return; }
    if (!description.trim()) { setError('Enter a description.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post(`/loyalty-memberships/${membership.id}/adjust/`, {
        points: pts,
        description: description.trim(),
      });
      onSuccess();
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Failed to award points.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#fff', borderRadius: 12, width: 420, padding: 28,
        boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Award / Adjust Points</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.4)', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg, #f8f9fa)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 2 }}>Member</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {membership.member_name ?? `Member #${membership.member}`}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
            Current balance: <strong>{fmt(membership.points_balance)} pts</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>
              Points (use negative to deduct)
            </label>
            <input
              className="form-control"
              type="number"
              placeholder="e.g. 500 or -100"
              value={points}
              onChange={e => setPoints(e.target.value)}
              style={{ fontSize: 13 }}
            />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>
              Reason / Description
            </label>
            <input
              className="form-control"
              type="text"
              placeholder="e.g. Goodwill gesture – delayed berth"
              value={description}
              onChange={e => setDescription(e.target.value)}
              style={{ fontSize: 13 }}
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 6 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Apply Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tier Form Drawer ───────────────────────────────────────────────────────

const EMPTY_TIER = {
  name: '',
  rank: 0,
  qualification_basis: 'cumulative_spend',
  threshold: '',
  berth_discount_pct: '0.00',
  points_multiplier: '1.00',
  priority_berth_allocation: false,
  requalification_policy: 'permanent',
  grace_period_days: 0,
  is_active: true,
};

function TierFormDrawer({ tier, onClose, onSaved }) {
  const isEdit = !!tier?.id;
  const [form, setForm] = useState(isEdit ? { ...tier } : { ...EMPTY_TIER });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.patch(`/loyalty-tiers/${tier.id}/`, form);
      } else {
        await api.post('/loyalty-tiers/', form);
      }
      onSaved();
    } catch (err) {
      const d = err?.response?.data;
      setError(typeof d === 'string' ? d : JSON.stringify(d) ?? 'Failed to save tier.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div
        style={{ flex: 1, background: 'rgba(0,0,0,0.25)' }}
        onClick={onClose}
      />
      <div style={{
        width: 420, background: '#fff', height: '100%', overflowY: 'auto',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.13)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isEdit ? 'Edit Tier' : 'New Tier'}</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'rgba(0,0,0,0.4)', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Tier Name</label>
            <input
              className="form-control"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Gold"
              required
              style={{ fontSize: 13 }}
            />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Rank (0 = lowest)</label>
            <input
              className="form-control"
              type="number"
              min={0}
              value={form.rank}
              onChange={e => set('rank', parseInt(e.target.value, 10))}
              style={{ fontSize: 13 }}
            />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Qualification Basis</label>
            <select
              className="form-control"
              value={form.qualification_basis}
              onChange={e => set('qualification_basis', e.target.value)}
              style={{ fontSize: 13 }}
            >
              <option value="cumulative_spend">Cumulative Spend (€)</option>
              <option value="number_of_stays">Number of Stays</option>
              <option value="years_of_membership">Years of Membership</option>
            </select>
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>
              Threshold ({form.qualification_basis === 'cumulative_spend' ? '€' : form.qualification_basis === 'number_of_stays' ? 'stays' : 'years'})
            </label>
            <input
              className="form-control"
              type="number"
              min={0}
              step="0.01"
              value={form.threshold}
              onChange={e => set('threshold', e.target.value)}
              required
              style={{ fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Berth Discount %</label>
              <input
                className="form-control"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.berth_discount_pct}
                onChange={e => set('berth_discount_pct', e.target.value)}
                style={{ fontSize: 13 }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Points Multiplier</label>
              <input
                className="form-control"
                type="number"
                min={0}
                step="0.01"
                value={form.points_multiplier}
                onChange={e => set('points_multiplier', e.target.value)}
                style={{ fontSize: 13 }}
              />
            </div>
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Re-qualification Policy</label>
            <select
              className="form-control"
              value={form.requalification_policy}
              onChange={e => set('requalification_policy', e.target.value)}
              style={{ fontSize: 13 }}
            >
              <option value="permanent">Held Permanently Once Achieved</option>
              <option value="annual">Must Re-qualify Each Calendar Year</option>
            </select>
          </div>
          {form.qualification_basis !== 'years_of_membership' && (
            <div>
              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Grace Period (days)</label>
              <input
                className="form-control"
                type="number"
                min={0}
                value={form.grace_period_days}
                onChange={e => set('grace_period_days', parseInt(e.target.value, 10) || 0)}
                style={{ fontSize: 13 }}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="priority_berth"
              checked={!!form.priority_berth_allocation}
              onChange={e => set('priority_berth_allocation', e.target.checked)}
            />
            <label htmlFor="priority_berth" style={{ fontSize: 13, cursor: 'pointer' }}>
              Priority berth allocation
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="is_active"
              checked={!!form.is_active}
              onChange={e => set('is_active', e.target.checked)}
            />
            <label htmlFor="is_active" style={{ fontSize: 13, cursor: 'pointer' }}>
              Tier is active
            </label>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
            <button type="button" className="btn" onClick={onClose} disabled={saving} style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 2 }}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Tier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tiers Tab ──────────────────────────────────────────────────────────────

function TiersTab({ toast }) {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerTier, setDrawerTier] = useState(null); // null = closed, {} = new, {...} = edit
  const [deletingId, setDeletingId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/loyalty-tiers/');
      setTiers(data.results ?? data);
    } catch {
      toast('Failed to load tiers.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(tier) {
    if (!window.confirm(`Delete tier "${tier.name}"? This cannot be undone.`)) return;
    setDeletingId(tier.id);
    try {
      await api.delete(`/loyalty-tiers/${tier.id}/`);
      toast(`Tier "${tier.name}" deleted.`, 'success');
      load();
    } catch (err) {
      const msg = err?.response?.data?.detail ?? 'Cannot delete tier — it may have active members.';
      toast(msg, 'error');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="card-header-title">Loyalty Tiers</div>
          <button className="btn btn-primary btn-sm" onClick={() => setDrawerTier({})}>
            + New Tier
          </button>
        </div>
        {loading ? <Spinner /> : tiers.length === 0 ? (
          <div className="card-body">
            <EmptyState icon="🏅" message="No tiers configured yet. Create your first tier to get started." />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Basis</th>
                  <th>Threshold</th>
                  <th>Berth Disc.</th>
                  <th>Pts Mult.</th>
                  <th>Re-qual.</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tiers.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>#{t.rank}</td>
                    <td>
                      <TierBadge name={t.name} rank={t.rank} />
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {t.qualification_basis === 'cumulative_spend' ? 'Spend'
                        : t.qualification_basis === 'number_of_stays' ? 'Stays'
                          : 'Years'}
                    </td>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>
                      {t.qualification_basis === 'cumulative_spend'
                        ? fmtCurrency(t.threshold)
                        : fmt(t.threshold)}
                    </td>
                    <td style={{ fontSize: 13 }}>{t.berth_discount_pct}%</td>
                    <td style={{ fontSize: 13 }}>{t.points_multiplier}x</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
                      {t.requalification_policy === 'permanent' ? 'Permanent' : 'Annual'}
                    </td>
                    <td>
                      {t.is_active
                        ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>Active</span>
                        : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f3f4f6', color: '#6b7280', fontWeight: 600 }}>Inactive</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => setDrawerTier(t)}
                          style={{ fontSize: 11, padding: '3px 10px' }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleDelete(t)}
                          disabled={deletingId === t.id}
                          style={{ fontSize: 11, padding: '3px 10px', color: '#991b1b', borderColor: '#fca5a5' }}
                        >
                          {deletingId === t.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerTier !== null && (
        <TierFormDrawer
          tier={drawerTier.id ? drawerTier : null}
          onClose={() => setDrawerTier(null)}
          onSaved={() => {
            setDrawerTier(null);
            load();
            toast('Tier saved successfully.', 'success');
          }}
        />
      )}
    </div>
  );
}

// ── Members Tab ────────────────────────────────────────────────────────────

function MembersTab({ toast }) {
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [awardTarget, setAwardTarget] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/loyalty-memberships/');
      setMemberships(data.results ?? data);
    } catch {
      toast('Failed to load members.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = memberships.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (m.member_name ?? '').toLowerCase();
    return name.includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div className="card-header-title">Member Loyalty Status</div>
          <input
            className="form-control"
            placeholder="Search member…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', width: 220 }}
          />
        </div>
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div className="card-body">
            <EmptyState icon="👤" message={search ? 'No members match your search.' : 'No loyalty memberships yet.'} />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Tier</th>
                  <th>Points Balance</th>
                  <th>Lifetime Spend</th>
                  <th>Qualifying Stays</th>
                  <th>Last Activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>
                      {m.member_name ?? `Member #${m.member}`}
                    </td>
                    <td>
                      {m.tier_name
                        ? <TierBadge name={m.tier_name} rank={m.tier_rank ?? 0} />
                        : <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }}>No tier</span>}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{fmt(m.points_balance)}</span>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginLeft: 4 }}>pts</span>
                    </td>
                    <td style={{ fontSize: 13 }}>{fmtCurrency(m.lifetime_spend)}</td>
                    <td style={{ fontSize: 13, textAlign: 'center' }}>{fmt(m.qualifying_stays)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{fmtDate(m.last_activity_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => setAwardTarget(m)}
                      >
                        Award Points
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {awardTarget && (
        <AwardPointsModal
          membership={awardTarget}
          onClose={() => setAwardTarget(null)}
          onSuccess={() => {
            setAwardTarget(null);
            load();
            toast('Points adjustment applied.', 'success');
          }}
        />
      )}
    </div>
  );
}

// ── Points Ledger Tab ──────────────────────────────────────────────────────

function LedgerTab({ toast }) {
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = typeFilter ? { entry_type: typeFilter } : {};
        const { data } = await api.get('/points-ledger/', { params });
        setLedger(data.results ?? data);
      } catch {
        toast('Failed to load points ledger.', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [typeFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div className="card-header-title">Points Ledger</div>
          <select
            className="form-control"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', width: 160 }}
          >
            <option value="">All types</option>
            <option value="earn">Earned</option>
            <option value="redeem">Redeemed</option>
            <option value="expire">Expired</option>
            <option value="adjust">Adjusted</option>
            <option value="referral">Referral</option>
          </select>
        </div>
        {loading ? <Spinner /> : ledger.length === 0 ? (
          <div className="card-body">
            <EmptyState icon="📒" message="No ledger entries found." />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Member</th>
                  <th>Type</th>
                  <th>Points</th>
                  <th>Balance After</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
                      {fmtDateShort(e.created_at)}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>
                      {e.member_name ?? `Membership #${e.membership}`}
                    </td>
                    <td><EntryTypeBadge type={e.entry_type} /></td>
                    <td>
                      <span style={{
                        fontWeight: 700, fontSize: 13,
                        color: e.points > 0 ? '#065f46' : '#991b1b',
                      }}>
                        {e.points > 0 ? '+' : ''}{fmt(e.points)}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>{fmt(e.balance_after)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Referrals Tab ──────────────────────────────────────────────────────────

function ReferralsTab({ toast }) {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = statusFilter ? { benefit_status: statusFilter } : {};
        const { data } = await api.get('/referral-uses/', { params });
        setReferrals(data.results ?? data);
      } catch {
        toast('Failed to load referrals.', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [statusFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div className="card-header-title">Referral Uses</div>
          <select
            className="form-control"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', width: 180 }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="applied">Applied</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        {loading ? <Spinner /> : referrals.length === 0 ? (
          <div className="card-body">
            <EmptyState icon="🔗" message="No referral uses recorded yet." />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Referral Code</th>
                  <th>Referrer</th>
                  <th>Referee Member</th>
                  <th>Benefit Status</th>
                  <th>Referrer Benefit Applied</th>
                  <th>Referee Benefit Applied</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.created_at)}
                    </td>
                    <td>
                      <code style={{
                        fontSize: 12, background: 'rgba(0,0,0,0.05)',
                        padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace',
                        letterSpacing: '0.5px',
                      }}>
                        {r.code ?? r.referral_code_code ?? `Code #${r.referral_code}`}
                      </code>
                    </td>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>
                      {r.referrer_name ?? '—'}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {r.referee_member_name ?? (r.referee_member ? `Member #${r.referee_member}` : '—')}
                    </td>
                    <td><BenefitStatusBadge status={r.benefit_status} /></td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                      {fmtDate(r.referrer_benefit_applied_at)}
                    </td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                      {fmtDate(r.referee_benefit_applied_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'tiers', label: 'Tiers' },
  { id: 'members', label: 'Members' },
  { id: 'ledger', label: 'Points Ledger' },
  { id: 'referrals', label: 'Referrals' },
];

export default function Loyalty() {
  const [activeTab, setActiveTab] = useState('tiers');
  const [toastMsg, setToastMsg] = useState(null);

  const toast = useCallback((message, type = 'success') => {
    setToastMsg({ message, type, key: Date.now() });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Page header */}
      <div className="page-header">
        <div className="container-xl">
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--teal, #2da39a)', flexShrink: 0 }}>
              <polyline points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Loyalty Programme
            <ScreenInfo title="Loyalty Programme" body={SCREEN_INFO.loyalty} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 20px', fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
                color: activeTab === t.id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.5)',
                borderBottom: activeTab === t.id ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
                transition: 'all 0.12s', marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'tiers' && <TiersTab toast={toast} />}
        {activeTab === 'members' && <MembersTab toast={toast} />}
        {activeTab === 'ledger' && <LedgerTab toast={toast} />}
        {activeTab === 'referrals' && <ReferralsTab toast={toast} />}
      </div>

      {/* Toast notification */}
      {toastMsg && (
        <Toast
          key={toastMsg.key}
          message={toastMsg.message}
          type={toastMsg.type}
          onDone={() => setToastMsg(null)}
        />
      )}
    </div>
  );
}
