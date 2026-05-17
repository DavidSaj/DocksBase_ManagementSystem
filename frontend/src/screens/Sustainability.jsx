import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import useMarina from '../hooks/useMarina.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n, decimals = 3) {
  if (n == null) return '—';
  return Number(n).toFixed(decimals);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentYear() {
  return new Date().getFullYear();
}

// ── Shared UI primitives ───────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ padding: 32, color: 'rgba(0,0,0,0.35)', fontSize: 13, textAlign: 'center' }}>
      Loading…
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: 32, color: 'rgba(0,0,0,0.35)', fontSize: 13, textAlign: 'center' }}>
      {message}
    </div>
  );
}

function StaleBadge() {
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, padding: '2px 7px', borderRadius: 99,
      background: 'rgba(255,165,0,0.12)', color: '#b36b00', fontWeight: 600, marginLeft: 6,
    }}>
      Recalculating…
    </span>
  );
}

function KpiCard({ label, value, unit, sub }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 0 }}>
      <div className="card-body" style={{ padding: '16px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--navy)', lineHeight: 1.1 }}>
          {value}
          {unit && <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.45)', marginLeft: 4 }}>{unit}</span>}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SectionHeader({ title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)' }}>{title}</div>
      {action}
    </div>
  );
}

function PeriodPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Period</span>
      <input
        type="month"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.15)' }}
      />
    </div>
  );
}

// ── Tab: Dashboard ─────────────────────────────────────────────────────────

function DashboardTab() {
  const [ledger, setLedger] = useState([]);
  const [offsets, setOffsets] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/sustainability/ledger/'),
      api.get('/sustainability/offset-contributions/summary/').catch(() => ({ data: null })),
    ]).then(([ledRes, offRes]) => {
      const rows = ledRes.data.results ?? ledRes.data;
      setLedger(Array.isArray(rows) ? rows : []);
      setOffsets(offRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  // Year-to-date totals from ledger
  const year = currentYear();
  const ytdRows = ledger.filter(r => r.period?.startsWith(String(year)));
  const ytdScope1 = ytdRows.reduce((s, r) => s + parseFloat(r.scope1_co2e_tco2e ?? 0), 0);
  const ytdScope2 = ytdRows.reduce((s, r) => s + parseFloat(r.scope2_co2e_tco2e ?? 0), 0);
  const ytdScope3 = ytdRows.reduce((s, r) => s + parseFloat(r.scope3_co2e_tco2e ?? 0), 0);
  const ytdTotal = ytdScope1 + ytdScope2 + ytdScope3;
  const ytdOffset = ytdRows.reduce((s, r) => s + parseFloat(r.offset_co2e_tco2e ?? 0), 0);

  // Intensity: use latest ledger row with data
  const latest = ytdRows.find(r => r.co2e_kg_per_gbp_revenue != null);
  const latestBerth = ytdRows.find(r => r.co2e_kg_per_berth_night != null);

  // 12-month rolling trend
  const last12 = ledger.slice(0, 12).reverse();

  const pigTotal = offsets?.total_gbp;
  const pigUnits = offsets?.total_units_purchased;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard
          label={`Total tCO₂e ${year} YTD`}
          value={fmt(ytdTotal)}
          unit="tCO₂e"
          sub={`Scope 1: ${fmt(ytdScope1)} · Scope 2: ${fmt(ytdScope2)} · Scope 3: ${fmt(ytdScope3)}`}
        />
        <KpiCard
          label="Intensity — per £ revenue"
          value={latest ? fmt(latest.co2e_kg_per_gbp_revenue, 6) : '—'}
          unit={latest ? 'kgCO₂e/£' : ''}
          sub={latest ? `Period: ${latest.period}` : 'No revenue data'}
        />
        <KpiCard
          label="Intensity — per berth-night"
          value={latestBerth ? fmt(latestBerth.co2e_kg_per_berth_night, 4) : '—'}
          unit={latestBerth ? 'kgCO₂e/night' : ''}
          sub={latestBerth ? `Period: ${latestBerth.period}` : 'No berth data'}
        />
        <KpiCard
          label={`Total offset ${year} YTD`}
          value={fmt(ytdOffset)}
          unit="tCO₂e"
          sub={`Net: ${fmt(ytdTotal - ytdOffset)} tCO₂e`}
        />
      </div>

      {/* Monthly trend table */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Monthly Emissions Trend (last 12 months)</div>
        </div>
        {last12.length === 0 ? (
          <EmptyState message="No ledger data yet. Data populates after the first monthly roll-up." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Scope 1</th>
                  <th style={{ textAlign: 'right' }}>Scope 2</th>
                  <th style={{ textAlign: 'right' }}>Scope 3</th>
                  <th style={{ textAlign: 'right' }}>Total tCO₂e</th>
                  <th style={{ textAlign: 'right' }}>Offset</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {last12.map(r => (
                  <tr key={r.period}>
                    <td style={{ fontWeight: 600 }}>
                      {r.period}
                      {r.is_stale && <StaleBadge />}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.scope1_co2e_tco2e)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.scope2_co2e_tco2e)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.scope3_co2e_tco2e)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{fmt(r.total_co2e_tco2e)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: 'var(--teal)' }}>{fmt(r.offset_co2e_tco2e)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(parseFloat(r.total_co2e_tco2e ?? 0) - parseFloat(r.offset_co2e_tco2e ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Play It Green tile */}
      {(pigTotal != null || pigUnits != null) && (
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Carbon Offsets — Play It Green</div>
          </div>
          <div className="card-body" style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total contributed</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>
                £{pigTotal != null ? Number(pigTotal).toFixed(2) : '—'}
              </div>
            </div>
            {pigUnits != null && (
              <div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Units purchased</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal)' }}>{Number(pigUnits).toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Scope 1 ───────────────────────────────────────────────────────────

const FUEL_TYPES = ['diesel', 'petrol', 'lpg', 'natural_gas', 'hvo'];
const FUEL_LABELS = { diesel: 'Diesel', petrol: 'Petrol', lpg: 'LPG', natural_gas: 'Natural Gas', hvo: 'HVO', electricity: 'Grid Electricity' };
const SOURCE_LABELS = {
  vehicle_fuel: 'Marina Vehicle', workboat_fuel: 'Workboat / Launch',
  generator: 'Generator', machinery: 'Machinery / Equipment', manual: 'Manual Entry',
};

function Scope1Drawer({ factors, onSave, onClose }) {
  const [form, setForm] = useState({
    date: currentPeriod() + '-01',
    source: 'vehicle_fuel',
    fuel_type: 'diesel',
    quantity: '',
    emission_factor: '',
    notes: '',
    ap_reference: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const availableFactors = factors.filter(f => f.energy_type === form.fuel_type);

  async function submit(e) {
    e.preventDefault();
    if (!form.emission_factor) { setErr('Select an emission factor.'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.post('/sustainability/scope1/', form);
      onSave();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const F = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: 420, background: '#fff', height: '100%', overflowY: 'auto',
        padding: 28, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Add Scope 1 Entry</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <F label="Date">
            <input type="date" className="form-control" value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
          </F>
          <F label="Source">
            <select className="form-control" value={form.source}
              onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
              {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </F>
          <F label="Fuel Type">
            <select className="form-control" value={form.fuel_type}
              onChange={e => setForm(f => ({ ...f, fuel_type: e.target.value, emission_factor: '' }))}>
              {FUEL_TYPES.map(ft => <option key={ft} value={ft}>{FUEL_LABELS[ft]}</option>)}
            </select>
          </F>
          <F label="Emission Factor">
            <select className="form-control" value={form.emission_factor}
              onChange={e => setForm(f => ({ ...f, emission_factor: e.target.value }))}>
              <option value="">Select factor…</option>
              {availableFactors.map(ef => (
                <option key={ef.id} value={ef.id}>
                  {ef.kg_co2e_per_unit} kgCO₂e/{ef.unit} ({ef.source}, {ef.valid_from})
                </option>
              ))}
            </select>
          </F>
          <F label="Quantity">
            <input type="number" className="form-control" value={form.quantity} step="0.001" min="0"
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} required
              placeholder="e.g. 150.000" />
          </F>
          <F label="AP Reference (optional)">
            <input type="text" className="form-control" value={form.ap_reference}
              onChange={e => setForm(f => ({ ...f, ap_reference: e.target.value }))}
              placeholder="Purchase order / invoice ref" />
          </F>
          <F label="Notes (optional)">
            <textarea className="form-control" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </F>
          {err && <div style={{ fontSize: 12, color: '#c0392b', background: 'rgba(192,57,43,0.08)', padding: '8px 12px', borderRadius: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Entry'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Scope1Tab() {
  const [records, setRecords] = useState([]);
  const [factors, setFactors] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/sustainability/scope1/?period=${period}`),
      api.get('/sustainability/emission-factors/'),
    ]).then(([r1, r2]) => {
      setRecords(r1.data.results ?? r1.data ?? []);
      setFactors(r2.data.results ?? r2.data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const total = records.reduce((s, r) => s + parseFloat(r.co2e_kg ?? 0), 0);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Scope 1 — Direct Fuel Combustion</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowDrawer(true)}>+ Add Entry</button>
        </div>
      </div>
      {loading ? <Spinner /> : records.length === 0 ? (
        <EmptyState message="No Scope 1 records for this period. Add a fuel combustion entry above." />
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th><th>Source</th><th>Fuel Type</th>
                  <th style={{ textAlign: 'right' }}>Quantity</th><th>Unit</th>
                  <th style={{ textAlign: 'right' }}>kgCO₂e</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12 }}>{fmtDate(r.date)}</td>
                    <td style={{ fontSize: 12 }}>{SOURCE_LABELS[r.source] ?? r.source}</td>
                    <td style={{ fontSize: 12 }}>{FUEL_LABELS[r.fuel_type] ?? r.fuel_type}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{Number(r.quantity).toFixed(3)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{r.unit}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.co2e_kg, 4)}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(26,45,74,0.04)' }}>
                  <td colSpan={5} style={{ fontWeight: 700, fontSize: 12 }}>Total</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{fmt(total, 4)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {showDrawer && (
        <Scope1Drawer
          factors={factors}
          onSave={() => { setShowDrawer(false); load(); }}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </div>
  );
}

// ── Tab: Scope 2 ───────────────────────────────────────────────────────────

function Scope2Tab() {
  const [records, setRecords] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ kwh_consumed: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/sustainability/scope2/?period=${period}`)
      .then(r => setRecords(r.data.results ?? r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  async function recalculate() {
    setRecalculating(true);
    try {
      await api.get(`/sustainability/scope2/recalculate/?period=${period}`);
      load();
    } catch {
      // silent — existing record may remain
    } finally {
      setRecalculating(false);
    }
  }

  async function submitManual(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await api.post('/sustainability/scope2/', { ...manualForm, period, data_source: 'manual' });
      setShowManual(false);
      load();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const record = records[0];

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Scope 2 — Purchased Electricity</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <button className="btn btn-ghost btn-sm" onClick={recalculate} disabled={recalculating}>
            {recalculating ? 'Recalculating…' : 'Recalculate'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowManual(v => !v)}>Override</button>
        </div>
      </div>
      {loading ? <Spinner /> : !record ? (
        <EmptyState message="No Scope 2 data for this period. Click Recalculate to pull from the utility module, or use Override to enter manually." />
      ) : (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>kWh Consumed</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>{Number(record.kwh_consumed).toLocaleString()} kWh</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Grid Intensity Used</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>{record.kg_co2e_per_kwh_used} kgCO₂e/kWh</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Emissions</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>{fmt(record.co2e_kg, 4)} kgCO₂e</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>
            Data source: {record.data_source === 'utility' ? 'Utility Module (auto)' : 'Manual Entry'}
            {record.notes && ` · ${record.notes}`}
          </div>
        </div>
      )}
      {showManual && (
        <div className="card-body" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Manual Electricity Entry — {period}</div>
          <form onSubmit={submitManual} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label className="form-label">kWh Consumed</label>
                <input type="number" className="form-control" value={manualForm.kwh_consumed}
                  onChange={e => setManualForm(f => ({ ...f, kwh_consumed: e.target.value }))}
                  step="0.001" min="0" required />
              </div>
              <div style={{ flex: 2, minWidth: 200 }}>
                <label className="form-label">Notes</label>
                <input type="text" className="form-control" value={manualForm.notes}
                  onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Utility bill for Jan — meter readings 12400–15200" />
              </div>
            </div>
            {err && <div style={{ fontSize: 12, color: '#c0392b' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Manual Entry'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowManual(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Tab: Scope 3 ───────────────────────────────────────────────────────────

const SCOPE3_CATEGORY_LABELS = {
  fuel_sold_vessels: 'Fuel Sold to Vessels',
  supplier_delivery: 'Supplier Deliveries',
  staff_commute: 'Staff Commute',
  other: 'Other',
};

function Scope3Tab() {
  const [records, setRecords] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ category: 'supplier_delivery', quantity: '', unit: 'litre', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/sustainability/scope3/?period=${period}`)
      .then(r => setRecords(r.data.results ?? r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  async function recalculate() {
    setRecalculating(true);
    try {
      await api.get(`/sustainability/scope3/recalculate/?period=${period}`);
      load();
    } catch { } finally {
      setRecalculating(false);
    }
  }

  async function submitAdd(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await api.post('/sustainability/scope3/', { ...addForm, period });
      setShowAdd(false);
      load();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const autoPop = records.filter(r => r.data_source === 'fuel_dock_auto');
  const manual = records.filter(r => r.data_source !== 'fuel_dock_auto');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Auto-populated section */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Scope 3 — Fuel Sold to Vessels (auto)</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <PeriodPicker value={period} onChange={setPeriod} />
            <button className="btn btn-ghost btn-sm" onClick={recalculate} disabled={recalculating}>
              {recalculating ? 'Recalculating…' : 'Recalculate'}
            </button>
          </div>
        </div>
        {loading ? <Spinner /> : autoPop.length === 0 ? (
          <EmptyState message="No fuel dock auto data for this period. Run Recalculate to pull from the fuel dock." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Period</th><th>Fuel Type</th>
                  <th style={{ textAlign: 'right' }}>Quantity</th><th>Unit</th>
                  <th style={{ textAlign: 'right' }}>kgCO₂e</th>
                  <th>Source Ref</th>
                </tr>
              </thead>
              <tbody>
                {autoPop.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12 }}>{r.period}</td>
                    <td style={{ fontSize: 12 }}>{FUEL_LABELS[r.fuel_type] ?? r.fuel_type ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{Number(r.quantity).toFixed(3)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{r.unit}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.co2e_kg, 4)}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>{r.source_reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual entries section */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Scope 3 — Manual Entries (supply chain, other)</div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(v => !v)}>+ Add Manual Entry</button>
        </div>
        {loading ? <Spinner /> : manual.length === 0 ? (
          <EmptyState message="No manual Scope 3 entries for this period." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Period</th><th>Category</th>
                  <th style={{ textAlign: 'right' }}>Quantity</th><th>Unit</th>
                  <th style={{ textAlign: 'right' }}>kgCO₂e</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {manual.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12 }}>{r.period}</td>
                    <td style={{ fontSize: 12 }}>{SCOPE3_CATEGORY_LABELS[r.category] ?? r.category}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{Number(r.quantity).toFixed(3)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{r.unit}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.co2e_kg, 4)}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showAdd && (
          <div className="card-body" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <form onSubmit={submitAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="form-label">Category</label>
                  <select className="form-control" value={addForm.category}
                    onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}>
                    {['supplier_delivery', 'staff_commute', 'other'].map(c => (
                      <option key={c} value={c}>{SCOPE3_CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label className="form-label">Quantity</label>
                  <input type="number" className="form-control" value={addForm.quantity}
                    onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))}
                    step="0.001" min="0" required />
                </div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <label className="form-label">Unit</label>
                  <select className="form-control" value={addForm.unit}
                    onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}>
                    <option value="litre">Litre</option>
                    <option value="kwh">kWh</option>
                    <option value="kg">kg</option>
                    <option value="tkm">Tonne-km</option>
                    <option value="gbp">GBP</option>
                  </select>
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <label className="form-label">Notes</label>
                  <input type="text" className="form-control" value={addForm.notes}
                    onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              {err && <div style={{ fontSize: 12, color: '#c0392b' }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Waste ─────────────────────────────────────────────────────────────

const WASTE_CATEGORIES = [
  { value: 'general', label: 'General Waste', unit: 'kg' },
  { value: 'recycling', label: 'Recycling', unit: 'kg' },
  { value: 'hazardous', label: 'Hazardous Waste', unit: 'kg' },
  { value: 'antifouling', label: 'Antifouling Paint', unit: 'kg' },
  { value: 'bilge_oil', label: 'Bilge Oil', unit: 'litres' },
  { value: 'pump_out', label: 'Pump-out (sewage)', unit: 'litres' },
];

const DISPOSAL_METHODS = [
  { value: 'landfill', label: 'Landfill' },
  { value: 'recycled', label: 'Recycled' },
  { value: 'composted', label: 'Composted' },
  { value: 'specialist', label: 'Specialist Disposal' },
  { value: 'incinerated', label: 'Incinerated (energy recovery)' },
  { value: 'returned_supplier', label: 'Returned to Supplier' },
];

const CATEGORY_UNIT = Object.fromEntries(WASTE_CATEGORIES.map(c => [c.value, c.unit]));
const CATEGORY_LABEL = Object.fromEntries(WASTE_CATEGORIES.map(c => [c.value, c.label]));
const DISPOSAL_LABEL = Object.fromEntries(DISPOSAL_METHODS.map(d => [d.value, d.label]));

function WasteLogDrawer({ onSave, onClose }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: 'general',
    quantity: '',
    disposal_method: 'landfill',
    waste_carrier: '',
    carrier_licence_ref: '',
    disposal_note: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const unitLabel = CATEGORY_UNIT[form.category] ?? 'kg';

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await api.post('/sustainability/waste/', form);
      onSave();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const F = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: 420, background: '#fff', height: '100%', overflowY: 'auto',
        padding: 28, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Log Waste Entry</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <F label="Date">
            <input type="date" className="form-control" value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
          </F>
          <F label="Category">
            <select className="form-control" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {WASTE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </F>
          <F label={`Quantity (${unitLabel})`}>
            <input type="number" className="form-control" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              step="0.001" min="0" required />
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
              Unit: <strong>{unitLabel}</strong> (set automatically by category)
            </div>
          </F>
          <F label="Disposal Method">
            <select className="form-control" value={form.disposal_method}
              onChange={e => setForm(f => ({ ...f, disposal_method: e.target.value }))}>
              {DISPOSAL_METHODS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </F>
          <F label="Waste Carrier (optional)">
            <input type="text" className="form-control" value={form.waste_carrier}
              onChange={e => setForm(f => ({ ...f, waste_carrier: e.target.value }))}
              placeholder="e.g. Green Waste Solutions Ltd" />
          </F>
          <F label="Carrier Licence Ref (optional)">
            <input type="text" className="form-control" value={form.carrier_licence_ref}
              onChange={e => setForm(f => ({ ...f, carrier_licence_ref: e.target.value }))} />
          </F>
          <F label="Note (optional)">
            <textarea className="form-control" value={form.disposal_note}
              onChange={e => setForm(f => ({ ...f, disposal_note: e.target.value }))} rows={3} />
          </F>
          {err && <div style={{ fontSize: 12, color: '#c0392b', background: 'rgba(192,57,43,0.08)', padding: '8px 12px', borderRadius: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Log Waste'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DiversionGauge({ pct }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 70 ? 'var(--teal)' : pct >= 40 ? '#f39c12' : '#e74c3c';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={radius} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={10} />
        <circle
          cx={50} cy={50} r={radius} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.5s' }}
        />
        <text x={50} y={55} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--navy)">
          {pct.toFixed(1)}%
        </text>
      </svg>
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', fontWeight: 600 }}>Landfill Diversion Rate</div>
    </div>
  );
}

function WasteTab() {
  const [logs, setLogs] = useState([]);
  const [diversion, setDiversion] = useState(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/sustainability/waste/?period=${period}`),
      api.get(`/sustainability/waste/diversion-rate/?period=${period}`).catch(() => ({ data: null })),
    ]).then(([wRes, dRes]) => {
      setLogs(wRes.data.results ?? wRes.data ?? []);
      setDiversion(dRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Waste Log</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowDrawer(true)}>+ Log Waste</button>
        </div>
      </div>
      {loading ? <Spinner /> : (
        <>
          {diversion && (
            <div className="card-body" style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <DiversionGauge pct={parseFloat(diversion.diversion_rate_pct ?? 0)} />
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Waste</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)' }}>{Number(diversion.total_kg ?? 0).toFixed(1)} kg</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Diverted</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)' }}>{Number(diversion.diverted_kg ?? 0).toFixed(1)} kg</div>
                </div>
              </div>
            </div>
          )}
          {logs.length === 0 ? (
            <EmptyState message="No waste logged for this period. Click '+ Log Waste' to add an entry." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th><th>Category</th>
                    <th style={{ textAlign: 'right' }}>Quantity</th><th>Unit</th>
                    <th>Disposal Method</th><th>Carrier</th><th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td style={{ fontSize: 12 }}>{fmtDate(l.date)}</td>
                      <td style={{ fontSize: 12 }}>{CATEGORY_LABEL[l.category] ?? l.category}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{Number(l.quantity).toFixed(3)}</td>
                      <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{l.unit}</td>
                      <td style={{ fontSize: 12 }}>{DISPOSAL_LABEL[l.disposal_method] ?? l.disposal_method}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{l.waste_carrier || '—'}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.disposal_note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {showDrawer && (
        <WasteLogDrawer
          onSave={() => { setShowDrawer(false); load(); }}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </div>
  );
}

// ── Tab: ESG Reports ───────────────────────────────────────────────────────

function EsgReportsTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [form, setForm] = useState({
    period_from: `${currentYear()}-01`,
    period_to: currentPeriod(),
    framework: 'gri',
  });
  const [err, setErr] = useState('');

  const loadHistory = useCallback(() => {
    setLoading(true);
    api.get('/sustainability/esg-reports/')
      .then(r => setHistory(r.data.results ?? r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Poll for pending report
  useEffect(() => {
    if (!pendingId) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/sustainability/esg-reports/${pendingId}/status/`);
        if (data.status === 'ready' || data.status === 'failed') {
          setPendingId(null);
          setGenerating(false);
          loadHistory();
        }
      } catch {
        setPendingId(null);
        setGenerating(false);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pendingId, loadHistory]);

  async function generate(e) {
    e.preventDefault();
    setGenerating(true);
    setErr('');
    try {
      const { data } = await api.post('/sustainability/esg-reports/generate/', form);
      setPendingId(data.archive_id);
      loadHistory();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Generation failed.');
      setGenerating(false);
    }
  }

  const STATUS_BADGE = {
    ready: { bg: 'rgba(26,180,120,0.12)', color: 'var(--teal)', label: 'Ready' },
    pending: { bg: 'rgba(255,165,0,0.12)', color: '#b36b00', label: 'Pending' },
    failed: { bg: 'rgba(192,57,43,0.1)', color: '#c0392b', label: 'Failed' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Generator */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Generate ESG Report</div>
        </div>
        <div className="card-body">
          <form onSubmit={generate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className="form-label">Period From</label>
                <input type="month" className="form-control" value={form.period_from}
                  onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Period To</label>
                <input type="month" className="form-control" value={form.period_to}
                  onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Framework</label>
                <div style={{ display: 'flex', gap: 16, paddingTop: 6 }}>
                  {[['gri', 'GRI Standards'], ['narrative', 'Narrative Only']].map(([v, l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" name="framework" value={v} checked={form.framework === v}
                        onChange={() => setForm(f => ({ ...f, framework: v }))} />
                      {l}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 4 }}>TCFD not available in v1</div>
              </div>
            </div>
            {err && <div style={{ fontSize: 12, color: '#c0392b', background: 'rgba(192,57,43,0.08)', padding: '8px 12px', borderRadius: 6 }}>{err}</div>}
            {generating && (
              <div style={{ fontSize: 13, color: '#b36b00', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #b36b00', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Generating PDF report… this may take a minute.
              </div>
            )}
            <div>
              <button type="submit" className="btn btn-primary" disabled={generating}>
                {generating ? 'Generating…' : 'Generate Report'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* History */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Report History</div>
        </div>
        {loading ? <Spinner /> : history.length === 0 ? (
          <EmptyState message="No reports generated yet." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Generated</th><th>Period</th><th>Framework</th>
                  <th>Status</th><th>Download</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.failed;
                  return (
                    <tr key={r.id}>
                      <td style={{ fontSize: 12 }}>{fmtDate(r.generated_at ?? r.created_at)}</td>
                      <td style={{ fontSize: 12 }}>{r.period_from} → {r.period_to}</td>
                      <td style={{ fontSize: 12, textTransform: 'uppercase' }}>{r.framework}</td>
                      <td>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 99,
                          background: badge.bg, color: badge.color, fontWeight: 600,
                        }}>
                          {badge.label}
                        </span>
                        {r.error_detail && (
                          <div style={{ fontSize: 11, color: '#c0392b', marginTop: 2 }}>{r.error_detail}</div>
                        )}
                      </td>
                      <td>
                        {r.status === 'ready' ? (
                          <a
                            href={`${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/sustainability/esg-reports/${r.id}/download/`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11 }}
                          >
                            Download PDF
                          </a>
                        ) : (
                          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'scope1', label: 'Scope 1' },
  { id: 'scope2', label: 'Scope 2' },
  { id: 'scope3', label: 'Scope 3' },
  { id: 'waste', label: 'Waste' },
  { id: 'esg_reports', label: 'ESG Reports' },
];

export default function Sustainability() {
  const { marina } = useMarina();
  const [activeTab, setActiveTab] = useState('dashboard');

  // Feature-flag gate
  if (marina && !marina.features?.esg_enabled) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <div className="card-body" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🌿</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
            Sustainability & ESG
          </div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', lineHeight: 1.6, maxWidth: 360, margin: '0 auto' }}>
            The Sustainability & ESG module is not enabled for your marina.
            Contact DocksBase support to activate it.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <PageHeader
        title="Sustainability & ESG"
        subtitle="Carbon footprint tracking and ESG reporting across Scopes 1–3."
        infoBody={SCREEN_INFO.sustainability}
      />

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '2px solid rgba(0,0,0,0.08)',
        marginBottom: 24, overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 18px', fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
              color: activeTab === t.id ? 'var(--navy)' : 'rgba(0,0,0,0.45)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === t.id ? '2px solid var(--navy)' : '2px solid transparent',
              marginBottom: -2, whiteSpace: 'nowrap', transition: 'color 0.1s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'scope1' && <Scope1Tab />}
      {activeTab === 'scope2' && <Scope2Tab />}
      {activeTab === 'scope3' && <Scope3Tab />}
      {activeTab === 'waste' && <WasteTab />}
      {activeTab === 'esg_reports' && <EsgReportsTab />}
    </div>
  );
}
