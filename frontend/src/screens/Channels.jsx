import { useState, useEffect } from 'react';
import api from '../api.js';
import useMarina from '../hooks/useMarina.js';
import useOTAConnections from '../hooks/useOTAConnections.js';

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
        {['manual_approval', 'auto_tetris'].map(mode => {
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

function BerthGrid({ berths, setBerths, connections, piersFilter, setPiersFilter }) {
  const piers = [...new Set(berths.map(b => b.pier_code).filter(Boolean))].sort();
  const [saving, setSaving] = useState(null);

  const filtered = piersFilter ? berths.filter(b => b.pier_code === piersFilter) : berths;

  async function handleChannelChange(berth, connId) {
    setSaving(berth.id);
    try {
      const { data } = await api.patch(`/berths/${berth.id}/`, {
        ota_connection: connId || null,
      });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...data } : b));
    } finally {
      setSaving(null);
    }
  }

  async function handleUnlock(berth) {
    setSaving(berth.id);
    try {
      const { data } = await api.patch(`/berths/${berth.id}/`, { channel_locked: false });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...data } : b));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Berth Assignment</div>
        <select
          value={piersFilter}
          onChange={e => setPiersFilter(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, border: 'var(--border)' }}
        >
          <option value="">All piers</option>
          {piers.map(p => <option key={p} value={p}>Pier {p}</option>)}
        </select>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Berth</th><th>Pier</th><th>Channel</th><th>Locked</th></tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} style={{ background: b.channel_locked ? 'rgba(26,45,74,0.03)' : undefined }}>
                <td style={{ fontWeight: 600 }}>{b.code}</td>
                <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{b.pier_code || '—'}</td>
                <td>
                  <select
                    value={b.ota_connection ?? ''}
                    disabled={saving === b.id}
                    onChange={e => handleChannelChange(b, e.target.value ? Number(e.target.value) : null)}
                    style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: 'var(--border)' }}
                  >
                    <option value="">Direct</option>
                    {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td>
                  {b.channel_locked ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => handleUnlock(b)}
                      disabled={saving === b.id}
                      title="Unlock — let allocator manage this berth"
                    >
                      🔒 Unlock
                    </button>
                  ) : (
                    <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 12 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BookingPipelineCard marina={marina} updateMarina={updateMarina} />
        <BookingPortalCard marina={marina} />
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
  );
}
