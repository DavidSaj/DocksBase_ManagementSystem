import { useState, useEffect } from 'react';
import api from '../api.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function Badge({ color, children }) {
  const colors = {
    green:  { background: 'rgba(47,179,135,0.12)', color: '#1b8c62' },
    yellow: { background: 'rgba(255,193,7,0.15)',  color: '#8a6600' },
    red:    { background: 'rgba(220,53,69,0.12)',  color: '#b02a37' },
    grey:   { background: 'rgba(0,0,0,0.07)',      color: 'rgba(0,0,0,0.45)' },
    navy:   { background: 'rgba(26,45,74,0.1)',    color: '#1a2d4a' },
    teal:   { background: 'rgba(26,167,153,0.12)', color: '#19786f' },
  };
  const s = colors[color] || colors.grey;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      display: 'inline-block', whiteSpace: 'nowrap', ...s,
    }}>
      {children}
    </span>
  );
}

function statusBadge(status) {
  const map = {
    active:     { color: 'green',  label: 'Active' },
    notice:     { color: 'yellow', label: 'Notice' },
    expired:    { color: 'grey',   label: 'Expired' },
    terminated: { color: 'red',    label: 'Terminated' },
    scheduled:  { color: 'navy',   label: 'Scheduled' },
    invoiced:   { color: 'teal',   label: 'Invoiced' },
    cancelled:  { color: 'grey',   label: 'Cancelled' },
    draft:      { color: 'grey',   label: 'Draft' },
    published:  { color: 'green',  label: 'Published' },
    under_offer:{ color: 'yellow', label: 'Under Offer' },
    sold:       { color: 'teal',   label: 'Sold' },
    withdrawn:  { color: 'red',    label: 'Withdrawn' },
    new:        { color: 'navy',   label: 'New' },
    contacted:  { color: 'teal',   label: 'Contacted' },
    closed:     { color: 'grey',   label: 'Closed' },
    available:  { color: 'green',  label: 'Available' },
    matched:    { color: 'teal',   label: 'Matched' },
  };
  const { color, label } = map[status] || { color: 'grey', label: status };
  return <Badge color={color}>{label}</Badge>;
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(0,0,0,0.35)' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12 }}>{subtitle}</div>}
    </div>
  );
}

function LoadingRows({ cols = 4 }) {
  return Array.from({ length: 4 }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j}>
          <div style={{ height: 14, borderRadius: 4, background: 'rgba(0,0,0,0.06)', width: j === 0 ? 80 : '70%' }} />
        </td>
      ))}
    </tr>
  ));
}

function fmt(val) {
  if (val == null) return '—';
  return val;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtCurrency(n) {
  if (n == null) return '—';
  return `£${parseFloat(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Drawer shell ──────────────────────────────────────────────────────────

function Drawer({ open, onClose, title, width = 540, children }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.22)',
          zIndex: 999, transition: 'opacity 0.15s',
        }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width,
        background: '#fff', zIndex: 1000, boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.35)', padding: '0 4px' }}
          >
            &times;
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {children}
        </div>
      </div>
    </>
  );
}

function DrawerTabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.1)',
      marginBottom: 20, marginTop: -4,
    }}>
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            padding: '8px 14px', fontSize: 12.5, fontWeight: active === t ? 700 : 400,
            color: active === t ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
            borderBottom: active === t ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
            marginBottom: -1, transition: 'all 0.12s',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Field({ label, value, full }) {
  return (
    <div style={{ marginBottom: 12, ...(full ? {} : {}) }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: value ? 'inherit' : 'rgba(0,0,0,0.3)' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function FieldGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
      {children}
    </div>
  );
}

// ── Tab 1: Commercial Units ──────────────────────────────────────────────

function CommercialUnitsTab() {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    unit_ref: '', unit_type: 'chandlery', description: '',
    area_m2: '', has_power: false, has_water: false, has_broadband: false, notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const UNIT_TYPES = [
    { value: 'chandlery',     label: 'Chandlery / Marine Shop' },
    { value: 'workshop',      label: 'Workshop' },
    { value: 'office',        label: 'Office Suite' },
    { value: 'storage',       label: 'Dry Storage Unit' },
    { value: 'retail',        label: 'Retail Unit' },
    { value: 'food_kiosk',    label: 'Food & Beverage Kiosk Plot' },
    { value: 'parking_bay',   label: 'Car Parking Bay' },
    { value: 'trailer_store', label: 'Boat Trailer Storage' },
  ];

  useEffect(() => {
    setLoading(true);
    api.get('/commercial-units/')
      .then(r => setUnits(r.data.results ?? r.data))
      .catch(() => setUnits([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!form.unit_ref.trim()) { setError('Unit reference is required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, area_m2: form.area_m2 || null };
      const { data } = await api.post('/commercial-units/', payload);
      setUnits(prev => [data, ...prev]);
      setShowAdd(false);
      setForm({ unit_ref: '', unit_type: 'chandlery', description: '', area_m2: '', has_power: false, has_water: false, has_broadband: false, notes: '' });
    } catch {
      setError('Failed to save unit.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Unit</button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Unit Ref</th>
                <th>Type</th>
                <th>Area (m²)</th>
                <th>Facilities</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && units.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 0, border: 'none' }}>
                  <EmptyState icon="🏢" title="No commercial units yet" subtitle="Add a unit to start managing lettings" />
                </td></tr>
              )}
              {!loading && units.map(u => (
                <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(u)}>
                  <td style={{ fontWeight: 600 }}>{u.unit_ref}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                    {UNIT_TYPES.find(t => t.value === u.unit_type)?.label || u.unit_type}
                  </td>
                  <td style={{ fontSize: 12 }}>{u.area_m2 ? `${u.area_m2} m²` : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {u.has_power && <Badge color="navy">Power</Badge>}
                      {u.has_water && <Badge color="teal">Water</Badge>}
                      {u.has_broadband && <Badge color="grey">Broadband</Badge>}
                    </div>
                  </td>
                  <td>
                    <Badge color={u.is_active ? 'green' : 'grey'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unit detail drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Unit ${selected.unit_ref}` : ''}>
        {selected && (
          <>
            <FieldGrid>
              <Field label="Unit Reference" value={selected.unit_ref} />
              <Field label="Type" value={UNIT_TYPES.find(t => t.value === selected.unit_type)?.label} />
              <Field label="Area" value={selected.area_m2 ? `${selected.area_m2} m²` : null} />
              <Field label="Status" value={selected.is_active ? 'Active' : 'Inactive'} />
            </FieldGrid>
            <Field label="Description" value={selected.description} />
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Facilities
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge color={selected.has_power ? 'navy' : 'grey'}>
                  {selected.has_power ? 'Power included' : 'No power'}
                </Badge>
                <Badge color={selected.has_water ? 'teal' : 'grey'}>
                  {selected.has_water ? 'Water included' : 'No water'}
                </Badge>
                <Badge color={selected.has_broadband ? 'green' : 'grey'}>
                  {selected.has_broadband ? 'Broadband' : 'No broadband'}
                </Badge>
              </div>
            </div>
            {selected.notes && <Field label="Notes" value={selected.notes} />}
          </>
        )}
      </Drawer>

      {/* Add unit drawer */}
      <Drawer open={showAdd} onClose={() => { setShowAdd(false); setError(''); }} title="Add Commercial Unit" width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit Reference *</label>
            <input
              className="form-control"
              placeholder="e.g. Unit 3B"
              value={form.unit_ref}
              onChange={e => setForm(f => ({ ...f, unit_ref: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit Type</label>
            <select className="form-control" value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
              {UNIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Area (m²)</label>
            <input
              className="form-control"
              type="number"
              placeholder="Optional"
              value={form.area_m2}
              onChange={e => setForm(f => ({ ...f, area_m2: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Facilities</label>
            <div style={{ display: 'flex', gap: 16 }}>
              {[['has_power', 'Power'], ['has_water', 'Water'], ['has_broadband', 'Broadband']].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="Optional description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea
              className="form-control"
              rows={2}
              placeholder="Internal notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: '#b02a37', background: 'rgba(220,53,69,0.06)', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="btn btn-ghost" onClick={() => { setShowAdd(false); setError(''); }}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Unit'}
            </button>
          </div>
        </div>
      </Drawer>
    </>
  );
}

// ── Tab 2: Tenancies ─────────────────────────────────────────────────────

function TenanciesTab() {
  const [tenancies, setTenancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');
  const [selected, setSelected] = useState(null);
  const [drawerTab, setDrawerTab] = useState('Overview');

  useEffect(() => {
    setLoading(true);
    api.get('/tenancies/')
      .then(r => setTenancies(r.data.results ?? r.data))
      .catch(() => setTenancies([]))
      .finally(() => setLoading(false));
  }, []);

  const STATUS_TABS = ['active', 'notice', 'expired', 'terminated', 'all'];
  const filtered = filter === 'all' ? tenancies : tenancies.filter(t => t.status === filter);

  return (
    <>
      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 16 }}>
        {STATUS_TABS.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              padding: '8px 14px', fontSize: 12.5,
              fontWeight: filter === s ? 700 : 400,
              color: filter === s ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
              borderBottom: filter === s ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize',
            }}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Tenant</th>
                <th>Rent</th>
                <th>Lease End</th>
                <th>Next Review</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={6} />}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 0, border: 'none' }}>
                  <EmptyState icon="📋" title="No tenancies" subtitle={filter === 'all' ? 'No tenancy records found' : `No ${filter} tenancies`} />
                </td></tr>
              )}
              {!loading && filtered.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => { setSelected(t); setDrawerTab('Overview'); }}>
                  <td style={{ fontWeight: 600 }}>{t.unit_ref || t.unit || '—'}</td>
                  <td style={{ fontSize: 12 }}>{t.tenant_name || t.tenant || '—'}</td>
                  <td style={{ fontSize: 12 }}>
                    {t.rent_amount ? `${fmtCurrency(t.rent_amount)} / ${t.rent_frequency || 'mo'}` : '—'}
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtDate(t.lease_end)}</td>
                  <td style={{ fontSize: 12 }}>{fmtDate(t.next_review_date)}</td>
                  <td>{statusBadge(t.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Tenancy — ${selected.unit_ref || selected.unit || ''}` : ''}
        width={580}
      >
        {selected && (
          <>
            <DrawerTabs
              tabs={['Overview', 'Schedule', 'Tasks']}
              active={drawerTab}
              onChange={setDrawerTab}
            />
            {drawerTab === 'Overview' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  {statusBadge(selected.status)}
                </div>
                <FieldGrid>
                  <Field label="Unit" value={selected.unit_ref || selected.unit} />
                  <Field label="Tenant" value={selected.tenant_name || selected.tenant} />
                  <Field label="Lease Start" value={fmtDate(selected.lease_start)} />
                  <Field label="Lease End" value={fmtDate(selected.lease_end) || 'Rolling'} />
                  <Field label="Rent Amount" value={fmtCurrency(selected.rent_amount)} />
                  <Field label="Rent Frequency" value={selected.rent_frequency} />
                  <Field label="Service Charge" value={fmtCurrency(selected.service_charge)} />
                  <Field label="Deposit" value={fmtCurrency(selected.deposit_amount)} />
                  <Field label="Next Review" value={fmtDate(selected.next_review_date)} />
                  <Field label="Notice Period" value={selected.notice_period_days ? `${selected.notice_period_days} days` : null} />
                  <Field label="Break Clause" value={fmtDate(selected.break_clause_date)} />
                  <Field label="Deposit Held" value={selected.deposit_held ? 'Yes' : 'No'} />
                </FieldGrid>
                {selected.permitted_use && <Field label="Permitted Use" value={selected.permitted_use} />}
                {selected.review_notes && <Field label="Review Notes" value={selected.review_notes} />}
              </>
            )}
            {drawerTab === 'Schedule' && (
              <TenancySchedulePanel tenancyId={selected.id} />
            )}
            {drawerTab === 'Tasks' && (
              <TenancyTasksPanel tenancyId={selected.id} />
            )}
          </>
        )}
      </Drawer>
    </>
  );
}

function TenancySchedulePanel({ tenancyId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/tenancies/${tenancyId}/schedule/`)
      .then(r => setEntries(r.data.results ?? r.data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [tenancyId]);

  if (loading) return <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', padding: 16 }}>Loading schedule…</div>;

  if (entries.length === 0) return (
    <EmptyState icon="📆" title="No schedule entries" subtitle="Schedule entries are generated automatically by the rent scheduler" />
  );

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Period</th>
              <th>Due Date</th>
              <th>Amount</th>
              <th>Pro-rata</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td style={{ fontWeight: 600, fontSize: 12 }}>{e.period_ref}</td>
                <td style={{ fontSize: 12 }}>{fmtDate(e.due_date)}</td>
                <td style={{ fontSize: 12 }}>{fmtCurrency(e.amount)}</td>
                <td style={{ fontSize: 12 }}>
                  {e.is_pro_rata ? (
                    <Badge color="yellow">{e.pro_rata_days}/{e.pro_rata_total_days} days</Badge>
                  ) : '—'}
                </td>
                <td>{statusBadge(e.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TenancyTasksPanel({ tenancyId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/tenancy-tasks/', { params: { tenancy: tenancyId } })
      .then(r => setTasks(r.data.results ?? r.data))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [tenancyId]);

  if (loading) return <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', padding: 16 }}>Loading tasks…</div>;

  if (tasks.length === 0) return (
    <EmptyState icon="✅" title="No tasks" subtitle="No tasks linked to this tenancy" />
  );

  const TASK_TYPE_LABELS = {
    rent_review: 'Rent Review', lease_renewal: 'Lease Renewal',
    compliance: 'Compliance Check', general: 'General',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tasks.map(t => (
        <div key={t.id} style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'var(--bg, #f8f9fa)', border: '1px solid rgba(0,0,0,0.07)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</span>
            {statusBadge(t.status)}
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
            <span>{TASK_TYPE_LABELS[t.task_type] || t.task_type}</span>
            {t.due_date && <span>Due {fmtDate(t.due_date)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab 3: Rent Schedule ─────────────────────────────────────────────────

function RentScheduleTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('scheduled');

  useEffect(() => {
    setLoading(true);
    api.get('/rent-schedule/')
      .then(r => setEntries(r.data.results ?? r.data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter === 'all'
    ? entries
    : entries.filter(e => e.status === statusFilter);

  return (
    <>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 16 }}>
        {['scheduled', 'invoiced', 'cancelled', 'all'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              padding: '8px 14px', fontSize: 12.5,
              fontWeight: statusFilter === s ? 700 : 400,
              color: statusFilter === s ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
              borderBottom: statusFilter === s ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize',
            }}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Period</th>
                <th>Tenancy</th>
                <th>Due Date</th>
                <th>Amount</th>
                <th>Pro-rata</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={6} />}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 0, border: 'none' }}>
                  <EmptyState icon="📅" title="No schedule entries" subtitle="Rent schedule entries appear here once tenancies are configured" />
                </td></tr>
              )}
              {!loading && filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{e.period_ref}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>{e.tenancy_display || `Tenancy #${e.tenancy}`}</td>
                  <td style={{ fontSize: 12 }}>{fmtDate(e.due_date)}</td>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>{fmtCurrency(e.amount)}</td>
                  <td style={{ fontSize: 12 }}>
                    {e.is_pro_rata ? (
                      <Badge color="yellow">{e.pro_rata_days}/{e.pro_rata_total_days} days</Badge>
                    ) : '—'}
                  </td>
                  <td>{statusBadge(e.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Tab 4: Marketplace Listings ───────────────────────────────────────────

function MarketplaceListingsTab() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('published');
  const [selected, setSelected] = useState(null);
  const [drawerTab, setDrawerTab] = useState('Listing');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    headline: '', description: '', asking_price: '',
    show_asking_price: false, listing_party: 'member',
    has_power: false, has_water: false,
    publish_to_portal: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const STATUS_TABS = ['published', 'draft', 'under_offer', 'sold', 'withdrawn', 'all'];

  useEffect(() => {
    setLoading(true);
    api.get('/berth-listings/')
      .then(r => setListings(r.data.results ?? r.data))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? listings : listings.filter(l => l.status === filter);

  async function handlePublish(id) {
    try {
      const { data } = await api.post(`/berth-listings/${id}/publish/`);
      setListings(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
      if (selected?.id === id) setSelected(prev => ({ ...prev, ...data }));
    } catch {
      /* noop */
    }
  }

  async function handleSaveNew() {
    if (!form.asking_price) { setError('Asking price is required.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/berth-listings/', {
        ...form,
        asking_price: parseFloat(form.asking_price),
      });
      setListings(prev => [data, ...prev]);
      setShowAdd(false);
      setForm({ headline: '', description: '', asking_price: '', show_asking_price: false, listing_party: 'member', has_power: false, has_water: false, publish_to_portal: true });
    } catch {
      setError('Failed to create listing.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.1)', flex: 1 }}>
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                border: 'none', background: 'none', cursor: 'pointer',
                padding: '8px 12px', fontSize: 12,
                fontWeight: filter === s ? 700 : 400,
                color: filter === s ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
                borderBottom: filter === s ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
                marginBottom: -1, whiteSpace: 'nowrap',
              }}
            >
              {s === 'all' ? 'All' : s === 'under_offer' ? 'Under Offer' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 12, flexShrink: 0 }} onClick={() => setShowAdd(true)}>
          + New Listing
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Berth</th>
                <th>Headline</th>
                <th>Asking Price</th>
                <th>Enquiries</th>
                <th>Status</th>
                <th>Published</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={7} />}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 0, border: 'none' }}>
                  <EmptyState icon="⚓" title="No listings" subtitle="Create a listing to put a berth on the market" />
                </td></tr>
              )}
              {!loading && filtered.map(l => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => { setSelected(l); setDrawerTab('Listing'); }}>
                  <td style={{ fontWeight: 600 }}>{l.berth_code || l.berth || '—'}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', maxWidth: 200 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.headline || '—'}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {l.show_asking_price ? fmtCurrency(l.asking_price) : 'P.O.A.'}
                  </td>
                  <td style={{ fontSize: 12 }}>{l.enquiry_count ?? '—'}</td>
                  <td>{statusBadge(l.status)}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{fmtDate(l.published_at)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {l.status === 'draft' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={() => handlePublish(l.id)}
                      >
                        Publish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Listing detail drawer */}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Listing — ${selected.berth_code || selected.berth || ''}` : ''}
        width={580}
      >
        {selected && (
          <>
            <DrawerTabs
              tabs={['Listing', 'Enquiries', 'Transaction']}
              active={drawerTab}
              onChange={setDrawerTab}
            />
            {drawerTab === 'Listing' && (
              <>
                <div style={{ marginBottom: 16 }}>{statusBadge(selected.status)}</div>
                <FieldGrid>
                  <Field label="Berth" value={selected.berth_code || selected.berth} />
                  <Field label="Listing Party" value={selected.listing_party === 'marina' ? 'Marina' : 'Berth Holder'} />
                  <Field label="Asking Price" value={selected.show_asking_price ? fmtCurrency(selected.asking_price) : 'P.O.A.'} />
                  <Field label="Show Price Publicly" value={selected.show_asking_price ? 'Yes' : 'No (P.O.A.)'} />
                  <Field label="Length" value={selected.length_m ? `${selected.length_m} m` : null} />
                  <Field label="Max Beam" value={selected.max_beam_m ? `${selected.max_beam_m} m` : null} />
                  <Field label="Max Draft" value={selected.max_draft_m ? `${selected.max_draft_m} m` : null} />
                  <Field label="Published" value={fmtDate(selected.published_at)} />
                </FieldGrid>
                <Field label="Headline" value={selected.headline} />
                <Field label="Description" value={selected.description} />
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                    Facilities
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge color={selected.has_power ? 'navy' : 'grey'}>{selected.has_power ? 'Power' : 'No power'}</Badge>
                    <Badge color={selected.has_water ? 'teal' : 'grey'}>{selected.has_water ? 'Water' : 'No water'}</Badge>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                    Portal Distribution
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge color={selected.publish_to_portal ? 'green' : 'grey'}>{selected.publish_to_portal ? 'Portal' : 'Not on portal'}</Badge>
                    <Badge color={selected.publish_to_third_party ? 'teal' : 'grey'}>{selected.publish_to_third_party ? '3rd party' : 'No 3rd party'}</Badge>
                  </div>
                </div>
                {selected.status === 'draft' && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handlePublish(selected.id)}
                  >
                    Publish Listing
                  </button>
                )}
              </>
            )}
            {drawerTab === 'Enquiries' && (
              <ListingEnquiriesPanel listingId={selected.id} />
            )}
            {drawerTab === 'Transaction' && (
              <>
                {selected.status === 'sold' ? (
                  <FieldGrid>
                    <Field label="Sale Price" value={fmtCurrency(selected.sale_price)} />
                    <Field label="Transfer Date" value={fmtDate(selected.transfer_date)} />
                    <Field label="Sold To" value={selected.sold_to_member_name || selected.sold_to_member} />
                  </FieldGrid>
                ) : (
                  <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', padding: '24px 0' }}>
                    Mark this listing as <strong>Under Offer</strong> or <strong>Sold</strong> once a buyer is agreed. Sale transaction recording will be available here.
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Drawer>

      {/* New listing drawer */}
      <Drawer open={showAdd} onClose={() => { setShowAdd(false); setError(''); }} title="New Berth Listing" width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Headline</label>
            <input
              className="form-control"
              placeholder="e.g. Pontoon A12 — 12m berth for sale"
              value={form.headline}
              onChange={e => setForm(f => ({ ...f, headline: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Asking Price (£) *</label>
            <input
              className="form-control"
              type="number"
              placeholder="0.00"
              value={form.asking_price}
              onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Listing Party</label>
            <select className="form-control" value={form.listing_party} onChange={e => setForm(f => ({ ...f, listing_party: e.target.value }))}>
              <option value="member">Berth Holder</option>
              <option value="marina">Marina</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
            <textarea
              className="form-control"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[['show_asking_price', 'Show price publicly'], ['has_power', 'Power'], ['has_water', 'Water'], ['publish_to_portal', 'Publish to portal']].map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          {error && <div style={{ fontSize: 12, color: '#b02a37', background: 'rgba(220,53,69,0.06)', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="btn btn-ghost" onClick={() => { setShowAdd(false); setError(''); }}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSaveNew}>
              {saving ? 'Saving…' : 'Create Listing'}
            </button>
          </div>
        </div>
      </Drawer>
    </>
  );
}

// ── Tab 5: Enquiries ──────────────────────────────────────────────────────

function ListingEnquiriesPanel({ listingId }) {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/berth-listings/${listingId}/enquiries/`)
      .then(r => setEnquiries(r.data.results ?? r.data))
      .catch(() => setEnquiries([]))
      .finally(() => setLoading(false));
  }, [listingId]);

  if (loading) return <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', padding: 16 }}>Loading enquiries…</div>;

  if (enquiries.length === 0) return (
    <EmptyState icon="📬" title="No enquiries yet" subtitle="Enquiries submitted through the portal will appear here" />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {enquiries.map(e => (
        <div key={e.id} style={{
          padding: '12px 14px', borderRadius: 8,
          background: 'var(--bg, #f8f9fa)', border: '1px solid rgba(0,0,0,0.07)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {e.enquirer_name || e.enquirer_member_name || 'Unknown'}
              </span>
              {e.enquirer_email && (
                <a href={`mailto:${e.enquirer_email}`} style={{ fontSize: 11, color: 'var(--teal, #1aa79a)', marginLeft: 8 }}>
                  {e.enquirer_email}
                </a>
              )}
            </div>
            {statusBadge(e.status)}
          </div>
          {e.enquirer_phone && (
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{e.enquirer_phone}</div>
          )}
          {e.message && (
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', marginTop: 4, lineHeight: 1.5 }}>{e.message}</div>
          )}
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 6 }}>{fmtDate(e.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

function EnquiriesTab() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('new');

  useEffect(() => {
    setLoading(true);
    api.get('/berth-enquiries/')
      .then(r => setEnquiries(r.data.results ?? r.data))
      .catch(() => setEnquiries([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? enquiries : enquiries.filter(e => e.status === filter);

  async function updateStatus(id, status) {
    try {
      const { data } = await api.patch(`/berth-enquiries/${id}/`, { status });
      setEnquiries(prev => prev.map(e => e.id === id ? { ...e, ...data } : e));
    } catch {
      /* noop */
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 16 }}>
        {['new', 'contacted', 'closed', 'all'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              padding: '8px 14px', fontSize: 12.5,
              fontWeight: filter === s ? 700 : 400,
              color: filter === s ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
              borderBottom: filter === s ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize',
            }}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Enquirer</th>
                <th>Contact</th>
                <th>Listing</th>
                <th>Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={6} />}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 0, border: 'none' }}>
                  <EmptyState icon="📬" title="No enquiries" subtitle={filter === 'all' ? 'No berth enquiries received yet' : `No ${filter} enquiries`} />
                </td></tr>
              )}
              {!loading && filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.enquirer_name || e.enquirer_member_name || '—'}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                    <div>{e.enquirer_email || '—'}</div>
                    <div style={{ fontSize: 11 }}>{e.enquirer_phone}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{e.listing_berth || e.listing || '—'}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{fmtDate(e.created_at)}</td>
                  <td>{statusBadge(e.status)}</td>
                  <td>
                    {e.status === 'new' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={() => updateStatus(e.id, 'contacted')}
                      >
                        Mark contacted
                      </button>
                    )}
                    {e.status === 'contacted' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={() => updateStatus(e.id, 'closed')}
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Tab 6: Exchange ───────────────────────────────────────────────────────

function ExchangeTab() {
  const [listings, setListings] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState('Listings');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/exchange-listings/').then(r => r.data.results ?? r.data).catch(() => []),
      api.get('/exchange-agreements/').then(r => r.data.results ?? r.data).catch(() => []),
    ]).then(([ls, ags]) => {
      setListings(ls);
      setAgreements(ags);
    }).finally(() => setLoading(false));
  }, []);

  const EXCHANGE_STATUS_COLORS = {
    available: 'green', matched: 'teal', expired: 'grey', withdrawn: 'red',
    pending: 'yellow', agreed: 'green', cancelled: 'red',
  };

  return (
    <>
      <DrawerTabs tabs={['Listings', 'Agreements']} active={subTab} onChange={setSubTab} />

      {subTab === 'Listings' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Berth</th>
                  <th>Available</th>
                  <th>Desired Location</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <LoadingRows cols={5} />}
                {!loading && listings.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 0, border: 'none' }}>
                    <EmptyState icon="🔄" title="No exchange listings" subtitle="Berth holders can register their berth for holiday exchange" />
                  </td></tr>
                )}
                {!loading && listings.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.member_name || l.member || '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.berth_code || l.berth || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {l.available_from && l.available_to
                        ? `${fmtDate(l.available_from)} – ${fmtDate(l.available_to)}`
                        : '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', maxWidth: 180 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.desired_location || '—'}
                      </div>
                    </td>
                    <td>
                      <Badge color={EXCHANGE_STATUS_COLORS[l.status] || 'grey'}>
                        {l.status?.charAt(0).toUpperCase() + l.status?.slice(1) || '—'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'Agreements' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Party A</th>
                  <th>Party B</th>
                  <th>A uses B's berth</th>
                  <th>B uses A's berth</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <LoadingRows cols={5} />}
                {!loading && agreements.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 0, border: 'none' }}>
                    <EmptyState icon="🤝" title="No exchange agreements" subtitle="Confirmed berth exchange agreements will appear here" />
                  </td></tr>
                )}
                {!loading && agreements.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{a.listing_a_member || `Listing #${a.listing_a}`}</td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{a.listing_b_member || `Listing #${a.listing_b}`}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)' }}>
                      {a.party_a_start_date && a.party_a_end_date
                        ? `${fmtDate(a.party_a_start_date)} – ${fmtDate(a.party_a_end_date)}`
                        : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)' }}>
                      {a.party_b_start_date && a.party_b_end_date
                        ? `${fmtDate(a.party_b_start_date)} – ${fmtDate(a.party_b_end_date)}`
                        : '—'}
                    </td>
                    <td>
                      <Badge color={EXCHANGE_STATUS_COLORS[a.status] || 'grey'}>
                        {a.status === 'pending' ? 'Pending Signature' : a.status?.charAt(0).toUpperCase() + a.status?.slice(1)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

const TABS = [
  { key: 'units',       label: 'Commercial Units' },
  { key: 'tenancies',   label: 'Tenancies' },
  { key: 'schedule',    label: 'Rent Schedule' },
  { key: 'listings',    label: 'Marketplace Listings' },
  { key: 'enquiries',   label: 'Enquiries' },
  { key: 'exchange',    label: 'Exchange' },
];

export default function Tenants() {
  const [activeTab, setActiveTab] = useState('units');

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy, #1a2d4a)', marginBottom: 2 }}>
          Tenants &amp; Marketplace
        </div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>
          Manage commercial lettings, rent schedules, and berth marketplace listings
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '2px solid rgba(0,0,0,0.08)',
        marginBottom: 20,
        overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              padding: '10px 18px', fontSize: 13,
              fontWeight: activeTab === t.key ? 700 : 400,
              color: activeTab === t.key ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)',
              borderBottom: activeTab === t.key ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              marginBottom: -2, whiteSpace: 'nowrap', transition: 'all 0.12s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'units'     && <CommercialUnitsTab />}
      {activeTab === 'tenancies' && <TenanciesTab />}
      {activeTab === 'schedule'  && <RentScheduleTab />}
      {activeTab === 'listings'  && <MarketplaceListingsTab />}
      {activeTab === 'enquiries' && <EnquiriesTab />}
      {activeTab === 'exchange'  && <ExchangeTab />}
    </div>
  );
}
