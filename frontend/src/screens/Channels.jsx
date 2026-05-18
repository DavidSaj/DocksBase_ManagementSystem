import { useState, useEffect } from 'react';
import api from '../api.js';
import useMarina from '../hooks/useMarina.js';
import useOTAConnections from '../hooks/useOTAConnections.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';
import { isFeatureEnabled } from '../components/layout/Sidebar.jsx';

function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
      background: on ? 'var(--teal)' : 'rgba(0,0,0,0.15)',
      position: 'relative', transition: 'background 0.15s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

// ── Section 1: Booking Pipeline ────────────────────────────────────────────

function BookingPipelineCard({ marina, updateMarina }) {
  const isAuto = marina?.booking_mode === 'auto_tetris';
  const [saving, setSaving] = useState(false);
  const autoTetrisAvailable = isFeatureEnabled(marina?.features, 'booking_auto_tetris');
  const modes = autoTetrisAvailable ? ['manual_approval', 'auto_tetris'] : ['manual_approval'];

  async function toggle() {
    setSaving(true);
    try {
      await updateMarina({ booking_mode: isAuto ? 'manual_approval' : 'auto_tetris' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Booking Pipeline</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>How incoming booking requests are handled</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {modes.map(mode => {
          const active = marina?.booking_mode === mode;
          const label = mode === 'manual_approval' ? 'Manual approval' : 'Auto-confirm';
          const desc = mode === 'manual_approval'
            ? 'Bookings go to pending — you confirm each one'
            : 'Bookings are confirmed immediately on submission';
          return (
            <div
              key={mode}
              onClick={() => !saving && !active && updateMarina({ booking_mode: mode })}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                background: active ? 'rgba(26,45,74,0.06)' : 'var(--bg)',
                border: active ? '1.5px solid rgba(26,45,74,0.18)' : '1.5px solid transparent',
                transition: 'all 0.12s',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                border: `2px solid ${active ? 'var(--navy)' : 'rgba(0,0,0,0.25)'}`,
                background: active ? 'var(--navy)' : 'transparent',
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: active ? 700 : 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 2: Booking Portal ──────────────────────────────────────────────

const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'https://portal.docksbase.com';

function BookingPortalCard({ marina }) {
  const slug = marina?.slug;
  const portalUrl = slug ? `${PORTAL_URL}/${slug}` : null;
  const embedSnippet = portalUrl
    ? `<iframe src="${portalUrl}" width="100%" height="700" frameborder="0" allow="payment"></iframe>`
    : '';
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  function copy(text, setCopied) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Booking Portal</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Share your marina's booking page</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {portalUrl ? (
          <>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Direct link
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13, color: 'var(--teal)', wordBreak: 'break-all', flex: 1 }}
                >
                  {portalUrl}
                </a>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flexShrink: 0 }}
                  onClick={() => copy(portalUrl, setCopiedUrl)}
                >
                  {copiedUrl ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Embed on your website
              </div>
              <div style={{ position: 'relative' }}>
                <pre style={{
                  fontSize: 11, background: 'var(--bg)', borderRadius: 6, padding: '10px 12px',
                  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace',
                  border: 'var(--border)',
                }}>
                  {embedSnippet}
                </pre>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', top: 6, right: 6, fontSize: 11 }}
                  onClick={() => copy(embedSnippet, setCopiedEmbed)}
                >
                  {copiedEmbed ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 6 }}>
                Paste this into any page on your website. Contact us if you want a custom domain (e.g. book.yourmarina.com).
              </div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>Portal URL not available yet.</div>
        )}
      </div>
    </div>
  );
}

// ── Section 3: OTA Allocation ──────────────────────────────────────────────

function AllocationCard({ conn, berths, onUpdate }) {
  const total = berths.filter(b => b.status !== 'maintenance').length;
  const current = berths.filter(b => b.ota_connection === conn.id).length;
  const currentPct = total > 0 ? Math.round((current / total) * 100) : 0;
  const [rebalancing, setRebalancing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleTargetChange(val) {
    const pct = Math.min(100, Math.max(0, Number(val)));
    setSaving(true);
    try {
      const { data } = await api.patch(`/ota-connections/${conn.id}/`, { target_pct: pct });
      onUpdate(data);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoToggle(val) {
    if (saving) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/ota-connections/${conn.id}/`, { auto_allocate: val });
      onUpdate(data);
    } finally {
      setSaving(false);
    }
  }

  async function handleRebalance() {
    setRebalancing(true);
    try {
      await api.post(`/ota-connections/${conn.id}/rebalance/`);
    } finally {
      setRebalancing(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">{conn.name}</div>
        <span className="badge badge-navy">{currentPct}% current · {conn.auto_allocate ? 'auto' : `${conn.target_pct}% target`}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Auto-calculate target</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>System divides remaining % evenly among auto connections</div>
          </div>
          <Toggle on={conn.auto_allocate} onChange={handleAutoToggle} />
        </div>
        {!conn.auto_allocate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Target % · Direct: {100 - conn.target_pct}% · {conn.name}: {conn.target_pct}%
            </label>
            <input
              type="range" min={0} max={50} step={5}
              value={conn.target_pct}
              onChange={e => handleTargetChange(e.target.value)}
              style={{ width: '100%' }}
              disabled={saving}
            />
          </div>
        )}
        <div>
          <button className="btn btn-ghost btn-sm" disabled={rebalancing} onClick={handleRebalance}>
            {rebalancing ? 'Rebalancing…' : 'Rebalance now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section 4: Berth Assignment Grid ──────────────────────────────────────

// Group by the size-style "berth type" the calendar uses (e.g. "Small", "Large").
// Falls back to the alphabetic prefix of the code so legacy berths still group
// sensibly (matches BerthCalendar.berthDisplayType).
function berthDisplayType(berth) {
  if (berth.berth_type) return berth.berth_type;
  const m = (berth.code || '').match(/^([A-Za-z]+)/);
  return m ? m[1] : 'Other';
}

function BerthGrid({ berths, setBerths, connections, categories }) {
  const [savingBerthId, setSavingBerthId] = useState(null);
  const [savingGroup, setSavingGroup] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  function toggle(typeKey) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(typeKey)) next.delete(typeKey);
      else next.add(typeKey);
      return next;
    });
  }

  async function handleBerthChange(berthId, connId) {
    setSavingBerthId(berthId);
    try {
      await api.patch(`/berths/${berthId}/`, { ota_connection: connId });
      setBerths(prev => prev.map(b => b.id === berthId ? { ...b, ota_connection: connId } : b));
    } finally {
      setSavingBerthId(null);
    }
  }

  // Bulk-update every berth in a group to the chosen channel (or Direct).
  async function handleGroupChange(typeKey, typeBerths, connId) {
    if (!window.confirm(
      `Change channel for all ${typeBerths.length} berth${typeBerths.length === 1 ? '' : 's'} in "${typeKey}"?`
    )) return;
    setSavingGroup(typeKey);
    const updatedIds = new Set();
    try {
      // Sequential to keep the API gentle and roll back on first failure.
      for (const b of typeBerths) {
        await api.patch(`/berths/${b.id}/`, { ota_connection: connId });
        updatedIds.add(b.id);
      }
      setBerths(prev => prev.map(b => updatedIds.has(b.id) ? { ...b, ota_connection: connId } : b));
    } catch {
      // Partial: still apply what landed so the UI stays consistent.
      setBerths(prev => prev.map(b => updatedIds.has(b.id) ? { ...b, ota_connection: connId } : b));
    } finally {
      setSavingGroup(null);
    }
  }

  function summary(typeBerths) {
    const directCount = typeBerths.filter(b => b.ota_connection == null).length;
    const parts = [];
    if (directCount > 0) parts.push(`${directCount} Direct`);
    const byConn = new Map();
    typeBerths.forEach(b => {
      if (b.ota_connection != null) byConn.set(b.ota_connection, (byConn.get(b.ota_connection) || 0) + 1);
    });
    byConn.forEach((count, connId) => {
      const c = connections.find(x => x.id === connId);
      parts.push(`${count} ${c ? c.name : 'OTA'}`);
    });
    return parts.join(' · ') || 'No berths';
  }

  // Group berths by their display type ("Small", "Large", …) and sort the
  // groups alphabetically so the layout is stable across reloads.
  const grouped = new Map();
  berths.forEach(b => {
    const key = berthDisplayType(b);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(b);
  });
  const types = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  // Category-name lookup so we can append "(Premium Slip)" etc. per berth.
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Berth Assignment</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {types.length === 0 && (
          <div style={{ padding: '12px', fontSize: 12, opacity: 0.6 }}>No berths to assign.</div>
        )}
        {types.map(type => {
          const typeBerths = grouped.get(type);
          const isOpen = expanded.has(type);
          return (
            <div key={type} style={{ border: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', background: 'transparent', gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(type)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    textAlign: 'left', padding: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, opacity: 0.6, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{type}</span>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>({typeBerths.length})</span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{summary(typeBerths)}</div>
                </button>
                <select
                  title={`Change channel for all ${typeBerths.length} berths in "${type}"`}
                  value=""
                  disabled={savingGroup === type}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    const v = e.target.value;
                    e.target.value = '';
                    if (v === '__direct') handleGroupChange(type, typeBerths, null);
                    else if (v) handleGroupChange(type, typeBerths, Number(v));
                  }}
                  style={{ fontSize: 11, padding: '3px 6px', borderRadius: 5, border: 'var(--border)', flexShrink: 0 }}
                >
                  <option value="">{savingGroup === type ? 'Saving…' : 'Set all to…'}</option>
                  <option value="__direct">Direct</option>
                  {connections.map(c => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>
              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', borderTop: 'var(--border)' }}>
                  {typeBerths.map(b => {
                    const val = b.ota_connection == null ? '' : String(b.ota_connection);
                    const isSaving = savingBerthId === b.id;
                    const catName = b.category != null ? categoryNameById.get(b.category) : null;
                    return (
                      <div
                        key={b.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '6px 12px 6px 32px', fontSize: 12,
                        }}
                      >
                        <div>
                          <span>{b.code || b.name || `Berth #${b.id}`}</span>
                          {catName && (
                            <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.55 }}>
                              ({catName})
                            </span>
                          )}
                        </div>
                        <select
                          value={val}
                          disabled={isSaving}
                          onChange={e => {
                            const v = e.target.value;
                            handleBerthChange(b.id, v ? Number(v) : null);
                          }}
                          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: 'var(--border)' }}
                        >
                          <option value="">Direct</option>
                          {connections.map(c => (
                            <option key={c.id} value={String(c.id)}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function Channels() {
  const { marina, loading: marinaLoading, updateMarina } = useMarina();
  const { connections, setConnections, loading: connsLoading } = useOTAConnections();
  const [berths, setBerths] = useState([]);
  const [berthsLoading, setBerthsLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  useEffect(() => {
    api.get('/berths/')
      .then(r => setBerths((r.data.results ?? r.data).filter(b => b.berth_class === 'standard')))
      .catch(() => {})
      .finally(() => setBerthsLoading(false));
  }, []);

  useEffect(() => {
    api.get('/berths/berth-categories/')
      .then(r => setCategories(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setCategoriesLoading(false));
  }, []);

  if (marinaLoading || connsLoading || berthsLoading || categoriesLoading) {
    return <div style={{ padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Channels"
        subtitle="Booking sources feeding reservations — your portal and OTA partners."
        infoBody={SCREEN_INFO.channels}
      />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BookingPipelineCard marina={marina} updateMarina={updateMarina} />
        {isFeatureEnabled(marina?.features, 'guest_booking') && <BookingPortalCard marina={marina} />}
        {connections.length === 0 && (
          <div className="card">
            <div className="card-body" style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>
              No OTA connections configured. Add one in <strong>Settings → System → OTA Connections</strong>.
            </div>
          </div>
        )}
        {connections.map(conn => (
          <AllocationCard
            key={conn.id}
            conn={conn}
            berths={berths}
            onUpdate={updated => setConnections(prev => prev.map(c => c.id === updated.id ? updated : c))}
          />
        ))}
      </div>
      <div>
        <BerthGrid
          berths={berths}
          setBerths={setBerths}
          connections={connections}
          categories={categories}
        />
      </div>
    </div>
    </div>
  );
}
