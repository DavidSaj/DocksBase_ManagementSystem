import { useState, useEffect } from 'react';
import useBerths from '../hooks/useBerths.js';
import usePiers from '../hooks/usePiers.js';
import useServiceCatalog from '../hooks/useServiceCatalog.js';
import MapBuilder from '../components/harbor-map/MapBuilder.jsx';
import Ic from '../components/ui/Icon.jsx';
import api from '../api.js';

const STATUS_BADGE = {
  available:   'badge-green',
  occupied:    'badge-blue',
  reserved:    'badge-gold',
  maintenance: 'badge-red',
};

const AMENITY_OPTIONS = ['electricity', 'water', 'wifi', 'pump_out', 'fuel', 'security', 'cctv'];

const inputSt = {
  width: '100%', border: 'var(--border)', borderRadius: 5,
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)',
  boxSizing: 'border-box', outline: 'none',
};

function BerthDetailModal({ berth, onClose, onSaved }) {
  const { items: pricingTiers } = useServiceCatalog('berth');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      berth_type:       berth.berth_type       || '',
      berth_class:      berth.berth_class      || 'standard',
      operational_type: berth.operational_type || '',
      status:           berth.status,
      length_m:         berth.length_m     != null ? String(berth.length_m)     : '',
      max_beam_m:       berth.max_beam_m   != null ? String(berth.max_beam_m)   : '',
      max_draft_m:      berth.max_draft_m  != null ? String(berth.max_draft_m)  : '',
      side:             berth.side         || '',
      pricing_tier:     berth.pricing_tier != null ? String(berth.pricing_tier) : '',
      amenities:        berth.amenities    ?? [],
    });
    setError('');
  }, [berth?.id]);

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })); }

  function toggleAmenity(a) {
    setForm(f => ({
      ...f,
      amenities: f.amenities.includes(a) ? f.amenities.filter(x => x !== a) : [...f.amenities, a],
    }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const patch = {
        berth_type:       form.berth_type.trim(),
        berth_class:      form.berth_class,
        operational_type: form.berth_class === 'operational' ? form.operational_type : '',
        status:           form.status,
        side:             form.side || null,
        length_m:         form.length_m    !== '' ? Number(form.length_m)    : null,
        max_beam_m:       form.max_beam_m  !== '' ? Number(form.max_beam_m)  : null,
        max_draft_m:      form.max_draft_m !== '' ? Number(form.max_draft_m) : null,
        pricing_tier:     form.pricing_tier !== '' ? Number(form.pricing_tier) : null,
        amenities:        form.amenities,
      };
      await api.patch(`/berths/${berth.id}/`, patch);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail ?? Object.values(e.response?.data ?? {}).flat().join(' ') ?? 'Save failed.');
    } finally { setSaving(false); }
  }

  if (!form) return null;

  const lbl = { fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 500, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.22)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Berth {berth.code}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
              {berth.pier_code ? `Pier ${berth.pier_code}` : 'Unassigned'}{berth.side ? ` · ${berth.side} side` : ''}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 16, lineHeight: 1, padding: '3px 8px' }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Berth Type */}
          <div>
            <label style={lbl}>Berth Type</label>
            <input value={form.berth_type} onChange={set('berth_type')} placeholder="e.g. Small, Large, Visitor…" style={inputSt} />
          </div>

          {/* Classification */}
          <div>
            <label style={lbl}>Classification</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: form.berth_class === 'operational' ? 8 : 0 }}>
              {[['standard', 'Standard'], ['operational', 'Operational']].map(([v, l]) => (
                <button
                  key={v} type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    berth_class: v,
                    operational_type: v === 'standard' ? '' : f.operational_type,
                  }))}
                  style={{
                    padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    border: `1.5px solid ${form.berth_class === v ? 'var(--navy)' : 'rgba(0,0,0,0.15)'}`,
                    background: form.berth_class === v ? 'var(--navy)' : '#fff',
                    color: form.berth_class === v ? '#fff' : 'rgba(0,0,0,0.6)',
                    fontFamily: 'var(--font)',
                  }}
                >{l}</button>
              ))}
            </div>
            {form.berth_class === 'operational' && (
              <select
                value={form.operational_type}
                onChange={e => setForm(f => ({ ...f, operational_type: e.target.value }))}
                style={inputSt}
              >
                <option value="">Select operational type…</option>
                <option value="fuel_dock">Fuel Dock</option>
              </select>
            )}
          </div>

          {/* Status + Side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Status</label>
              <select value={form.status} onChange={set('status')} style={inputSt}>
                {['available','maintenance'].map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Side</label>
              <select value={form.side} onChange={set('side')} style={inputSt}>
                <option value="">— not set —</option>
                <option value="port">Port</option>
                <option value="starboard">Starboard</option>
              </select>
            </div>
          </div>

          {/* Dimensions */}
          <div>
            <label style={lbl}>Dimensions</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[['length_m','Length (m)'],['max_beam_m','Max Beam (m)'],['max_draft_m','Max Draft (m)']].map(([k,l]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 3 }}>{l}</div>
                  <input type="number" step="0.1" min="0" value={form[k]} onChange={set(k)} placeholder="—" style={inputSt} />
                </div>
              ))}
            </div>
          </div>

          {/* Pricing tier */}
          <div>
            <label style={lbl}>Pricing Tier (Berth Rate)</label>
            <select value={form.pricing_tier} onChange={set('pricing_tier')} style={inputSt}>
              <option value="">— No rate assigned —</option>
              {pricingTiers.filter(p => p.is_active).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — €{Number(p.unit_price).toFixed(2)} / {p.pricing_model?.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Amenities */}
          <div>
            <label style={lbl}>Amenities</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {AMENITY_OPTIONS.map(a => {
                const active = form.amenities.includes(a);
                return (
                  <button
                    key={a} type="button"
                    onClick={() => toggleAmenity(a)}
                    style={{
                      padding: '4px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                      border: `1.5px solid ${active ? 'var(--navy)' : 'rgba(0,0,0,0.15)'}`,
                      background: active ? 'var(--navy)' : '#fff',
                      color: active ? '#fff' : 'rgba(0,0,0,0.6)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {a.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--red)', background: '#fff5f5', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

function BulkCreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    prefix: '', start: 1, count: 10, berth_type: '',
    berth_class: 'standard', operational_type: '',
    length_m: '', beam_m: '', max_draft_m: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.prefix.trim()) { setError('Prefix is required.'); return; }
    if (!form.count || form.count < 1) { setError('Count must be at least 1.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/berths/bulk-create/', {
        prefix:           form.prefix.trim().toUpperCase(),
        start:            Number(form.start),
        count:            Number(form.count),
        berth_type:       form.berth_type.trim(),
        berth_class:      form.berth_class,
        operational_type: form.berth_class === 'operational' ? form.operational_type : '',
        length_m:         form.length_m    ? Number(form.length_m)    : null,
        beam_m:           form.beam_m      ? Number(form.beam_m)      : null,
        max_draft_m:      form.max_draft_m ? Number(form.max_draft_m) : null,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create berths.');
    } finally {
      setSaving(false);
    }
  }

  const preview = form.prefix && form.count > 0
    ? `${form.prefix}${form.start} – ${form.prefix}${Number(form.start) + Number(form.count) - 1}`
    : '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 420, maxWidth: '90vw', boxShadow: 'var(--shadow2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Bulk Create Berths</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>
          Physical berth records only — attach pricing in the Service Catalog.
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="field-label">Berth Type <span style={{ color: 'rgba(0,0,0,0.35)', fontWeight: 400 }}>(used for grouping &amp; filtering)</span></div>
          <input className="field-input" placeholder="e.g. Small, Large, Visitor, Floating…" value={form.berth_type} onChange={e => set('berth_type', e.target.value)} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="field-label">Classification</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: form.berth_class === 'operational' ? 8 : 0 }}>
            {[['standard', 'Standard'], ['operational', 'Operational']].map(([v, l]) => (
              <button
                key={v} type="button"
                onClick={() => set('berth_class', v)}
                style={{
                  padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  border: `1.5px solid ${form.berth_class === v ? 'var(--navy)' : 'rgba(0,0,0,0.15)'}`,
                  background: form.berth_class === v ? 'var(--navy)' : '#fff',
                  color: form.berth_class === v ? '#fff' : 'rgba(0,0,0,0.6)',
                  fontFamily: 'var(--font)',
                }}
              >{l}</button>
            ))}
          </div>
          {form.berth_class === 'operational' && (
            <select className="field-input" value={form.operational_type} onChange={e => set('operational_type', e.target.value)}>
              <option value="">Select operational type…</option>
              <option value="fuel_dock">Fuel Dock</option>
            </select>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <div className="field-label">Prefix</div>
            <input className="field-input" placeholder="e.g. S" value={form.prefix} onChange={e => set('prefix', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Start number</div>
            <input className="field-input" type="number" min={1} value={form.start} onChange={e => set('start', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Count</div>
            <input className="field-input" type="number" min={1} max={500} value={form.count} onChange={e => set('count', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Length (m)</div>
            <input className="field-input" type="number" step="0.1" placeholder="e.g. 12" value={form.length_m} onChange={e => set('length_m', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Beam / Width (m)</div>
            <input className="field-input" type="number" step="0.1" placeholder="e.g. 4" value={form.beam_m} onChange={e => set('beam_m', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Max draft (m)</div>
            <input className="field-input" type="number" step="0.1" placeholder="e.g. 2" value={form.max_draft_m} onChange={e => set('max_draft_m', e.target.value)} />
          </div>
        </div>

        {preview && (
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 12 }}>
            Will create <strong>{form.count}</strong> berths: <strong>{preview}</strong>
          </div>
        )}

        {error && <div style={{ marginBottom: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : `Create ${form.count || ''} Berths`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BerthsTable() {
  const { berths, loading, refetch } = useBerths();
  const [bulkOpen,      setBulkOpen]      = useState(false);
  const [selectedBerth, setSelectedBerth] = useState(null);
  const [typeFilter,    setTypeFilter]    = useState('');   // '' = all

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;

  // Distinct berth types for filter buttons
  const types = [...new Set(berths.map(b => b.berth_type).filter(Boolean))].sort();
  const displayed = typeFilter ? berths.filter(b => b.berth_type === typeFilter) : berths;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>{displayed.length} of {berths.length} berths</div>

        {/* Type filter pills */}
        {types.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              className={typeFilter === '' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setTypeFilter('')}
            >All</button>
            {types.map(t => (
              <button
                key={t}
                className={typeFilter === t ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                onClick={() => setTypeFilter(t)}
              >{t}</button>
            ))}
          </div>
        )}

        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>
            <Ic n="plus" s={12} /> Bulk Create
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: 'var(--border)', background: 'var(--bg)' }}>
              {['Code', 'Type', 'Pier', 'Status', 'Length', 'Beam', 'Max Draft', 'Side', 'Rate'].map(h => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((b, i) => (
              <tr key={b.id}
                style={{ borderBottom: i < displayed.length - 1 ? 'var(--border)' : 'none', cursor: 'pointer' }}
                onClick={() => setSelectedBerth(b)}
                onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{b.code}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>
                  {b.berth_type ? <span className="badge badge-gray">{b.berth_type}</span> : '—'}
                </td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{b.pier_code || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span className={`badge ${STATUS_BADGE[b.status] ?? 'badge-gray'}`}>{b.status}</span>
                </td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{b.length_m ? `${b.length_m}m` : '—'}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{b.max_beam_m ? `${b.max_beam_m}m` : '—'}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{b.max_draft_m ? `${b.max_draft_m}m` : '—'}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)', textTransform: 'capitalize' }}>{b.side || '—'}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>
                  {b.pricing_tier ? <span className="badge badge-gold">Rate set</span> : <span style={{ color: 'rgba(0,0,0,0.3)' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {displayed.length === 0 && (
          <div className="empty">
            <div className="empty-title">No berths yet</div>
            <div className="empty-sub">Use Bulk Create to add your first berths.</div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setBulkOpen(true)}>Bulk Create</button>
          </div>
        )}
      </div>

      {bulkOpen && <BulkCreateModal onClose={() => setBulkOpen(false)} onCreated={refetch} />}
      {selectedBerth && (
        <BerthDetailModal
          berth={selectedBerth}
          onClose={() => setSelectedBerth(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

function PiersTable() {
  const { piers, loading } = usePiers();

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: 'var(--border)', background: 'var(--bg)' }}>
            {['Code', 'Label', 'Type', 'On Map'].map(h => (
              <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {piers.map((p, i) => (
            <tr key={p.id} style={{ borderBottom: i < piers.length - 1 ? 'var(--border)' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.code}</td>
              <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{p.label || '—'}</td>
              <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)', textTransform: 'capitalize' }}>{p.pier_type?.replace('_', ' ') || '—'}</td>
              <td style={{ padding: '10px 14px' }}>
                <span className={`badge ${p.canvas_x != null ? 'badge-green' : 'badge-gray'}`}>
                  {p.canvas_x != null ? 'Placed' : 'Unplaced'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {piers.length === 0 && (
        <div className="empty">
          <div className="empty-title">No piers yet</div>
          <div className="empty-sub">Add piers using the Map Editor tab.</div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  ['berths', 'Berths'],
  ['piers',  'Piers'],
  ['map',    'Map Editor'],
];

export default function Infrastructure() {
  const [tab, setTab] = useState('berths');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="tabs" style={{ marginBottom: 20 }}>
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'berths' && <BerthsTable />}
      {tab === 'piers'  && <PiersTable />}
      {tab === 'map'    && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <MapBuilder />
        </div>
      )}
    </div>
  );
}
