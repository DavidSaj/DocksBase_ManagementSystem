import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(val, prefix = '€') {
  if (val == null || val === '') return '—';
  return `${prefix}${Number(val).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return d.slice(0, 10);
}

function StatusBadge({ value }) {
  const map = {
    true:     ['Active',   'badge-green'],
    false:    ['Inactive', 'badge-outline'],
    pending:  ['Pending',  'badge-orange'],
    accepted: ['Accepted', 'badge-green'],
    declined: ['Declined', 'badge-red'],
    expired:  ['Expired',  'badge-outline'],
    sent:     ['Sent',     'badge-navy'],
    redeemed: ['Redeemed', 'badge-green'],
    manual:   ['Manual',   'badge-outline'],
    scraper:  ['Scraped',  'badge-navy'],
  };
  const [label, cls] = map[String(value)] ?? [String(value), 'badge-outline'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 10,
        width: wide ? 680 : 480, maxWidth: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'rgba(0,0,0,0.4)', padding: '0 4px' }}
          >×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, ...rest }) {
  return (
    <input
      className="form-control"
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ fontSize: 13 }}
      {...rest}
    />
  );
}

function Select({ value, onChange, children, ...rest }) {
  return (
    <select
      className="form-control"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: 13 }}
      {...rest}
    >
      {children}
    </select>
  );
}

function ModalActions({ onClose, onSave, saving, saveLabel = 'Save' }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
      <button className="btn btn-primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      {message}
    </div>
  );
}

function LoadingState() {
  return <div style={{ padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>Loading…</div>;
}

function SecHdr({ children }) {
  return (
    <div className="sec-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      {children}
    </div>
  );
}

// ─── Tab 1: Booking Tiers ────────────────────────────────────────────────────

const TIER_DEFAULTS = { name: '', display_order: 0, rate_premium_pct: '0.00', description: '', is_active: true };

function TierModal({ tier, onClose, onSaved }) {
  const [form, setForm] = useState(tier ? { ...tier } : { ...TIER_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (tier) {
        const { data } = await api.patch(`/revenue/booking-tiers/${tier.id}/`, form);
        onSaved(data, 'update');
      } else {
        const { data } = await api.post('/revenue/booking-tiers/', form);
        onSaved(data, 'create');
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={tier ? 'Edit Booking Tier' : 'New Booking Tier'} onClose={onClose}>
      {error && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <Field label="Name">
        <Input value={form.name} onChange={v => set('name', v)} placeholder="e.g. Premium" />
      </Field>
      <Field label="Display Order">
        <Input type="number" value={form.display_order} onChange={v => set('display_order', Number(v))} />
      </Field>
      <Field label="Rate Premium %">
        <Input type="number" value={form.rate_premium_pct} onChange={v => set('rate_premium_pct', v)} placeholder="e.g. 25.00" />
      </Field>
      <Field label="Description">
        <textarea
          className="form-control"
          rows={3}
          value={form.description}
          onChange={e => set('description', e.target.value)}
          style={{ fontSize: 13, resize: 'vertical' }}
        />
      </Field>
      <Field label="Status">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="tier-active" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} />
          <label htmlFor="tier-active" style={{ fontSize: 13 }}>Active</label>
        </div>
      </Field>
      <ModalActions onClose={onClose} onSave={save} saving={saving} saveLabel={tier ? 'Update Tier' : 'Create Tier'} />
    </Modal>
  );
}

function BookingTiersTab() {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | {tier}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/revenue/booking-tiers/');
      setTiers(data.results ?? data);
    } catch {
      setTiers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(saved, mode) {
    if (mode === 'create') setTiers(prev => [...prev, saved]);
    else setTiers(prev => prev.map(t => t.id === saved.id ? saved : t));
    setModal(null);
  }

  async function deactivate(tier) {
    try {
      const { data } = await api.patch(`/revenue/booking-tiers/${tier.id}/`, { is_active: false });
      setTiers(prev => prev.map(t => t.id === data.id ? data : t));
    } catch {
      // silent
    }
  }

  return (
    <div>
      <SecHdr>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Booking Tiers</div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ tier: null })}>+ New Tier</button>
      </SecHdr>
      <div className="card">
        {loading ? <LoadingState /> : tiers.length === 0 ? (
          <EmptyState message="No booking tiers configured. Create one to group berths by commercial grade." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Premium %</th>
                  <th>Order</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tiers.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td>+{t.rate_premium_pct}%</td>
                    <td>{t.display_order}</td>
                    <td style={{ color: 'rgba(0,0,0,0.5)', fontSize: 12, maxWidth: 240 }}>{t.description || '—'}</td>
                    <td><StatusBadge value={t.is_active} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ tier: t })}>Edit</button>
                      {t.is_active && (
                        <button className="btn btn-ghost btn-sm" style={{ color: '#c0392b', marginLeft: 4 }} onClick={() => deactivate(t)}>Deactivate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal !== null && (
        <TierModal tier={modal.tier} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

// ─── Tab 2: Yield Rules ──────────────────────────────────────────────────────

const TRIGGER_LABELS = {
  occupancy_threshold: 'Occupancy Threshold',
  days_to_arrival:     'Days to Arrival',
  days_in_advance:     'Days in Advance',
  gap_fill:            'Gap-Fill',
};

const ACTION_LABELS = {
  percent_uplift:   '% Uplift',
  percent_discount: '% Discount',
  fixed_uplift:     'Fixed Uplift',
  fixed_discount:   'Fixed Discount',
};

const RULE_DEFAULTS = {
  name: '', priority: 100,
  trigger_type: 'occupancy_threshold',
  occupancy_threshold_pct: '', occupancy_scope: 'tier',
  days_to_arrival_lte: '', days_in_advance_gte: '', gap_max_nights: '',
  booking_tier: '', applies_to_booking_type: 'transient',
  action_type: 'percent_uplift', action_value: '',
  floor_price: '', ceiling_price: '',
  pricing_model_scope: 'all',
  valid_from: '', valid_until: '',
  is_active: true,
};

function YieldRuleModal({ rule, tiers, onClose, onSaved }) {
  const [form, setForm] = useState(rule ? { ...rule, booking_tier: rule.booking_tier ?? '' } : { ...RULE_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.action_value) { setError('Action value is required.'); return; }
    setSaving(true);
    setError('');
    const payload = { ...form };
    // coerce nullable fields
    ['occupancy_threshold_pct', 'days_to_arrival_lte', 'days_in_advance_gte', 'gap_max_nights', 'floor_price', 'ceiling_price', 'valid_from', 'valid_until'].forEach(k => {
      if (payload[k] === '') payload[k] = null;
    });
    if (payload.booking_tier === '') payload.booking_tier = null;
    try {
      if (rule) {
        const { data } = await api.patch(`/revenue/yield-rules/${rule.id}/`, payload);
        onSaved(data, 'update');
      } else {
        const { data } = await api.post('/revenue/yield-rules/', payload);
        onSaved(data, 'create');
      }
    } catch (e) {
      setError(e.response?.data?.detail || JSON.stringify(e.response?.data) || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const tt = form.trigger_type;

  return (
    <Modal title={rule ? 'Edit Yield Rule' : 'New Yield Rule'} onClose={onClose} wide>
      {error && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Rule Name">
            <Input value={form.name} onChange={v => set('name', v)} placeholder="e.g. High-Season Uplift 80%" />
          </Field>
        </div>
        <Field label="Priority (lower = evaluated first)">
          <Input type="number" value={form.priority} onChange={v => set('priority', Number(v))} />
        </Field>
        <Field label="Trigger Type">
          <Select value={form.trigger_type} onChange={v => set('trigger_type', v)}>
            <option value="occupancy_threshold">Occupancy % Threshold</option>
            <option value="days_to_arrival">Days to Arrival (last-minute)</option>
            <option value="days_in_advance">Days in Advance (early-bird)</option>
            <option value="gap_fill">Gap-Fill Window</option>
          </Select>
        </Field>

        {tt === 'occupancy_threshold' && <>
          <Field label="Occupancy Threshold %">
            <Input type="number" value={form.occupancy_threshold_pct} onChange={v => set('occupancy_threshold_pct', v)} placeholder="e.g. 80" />
          </Field>
          <Field label="Occupancy Scope">
            <Select value={form.occupancy_scope} onChange={v => set('occupancy_scope', v)}>
              <option value="tier">Booking Tier</option>
              <option value="marina">Marina-Wide</option>
            </Select>
          </Field>
        </>}

        {tt === 'days_to_arrival' && (
          <Field label="Fire when arrival is within N days">
            <Input type="number" value={form.days_to_arrival_lte} onChange={v => set('days_to_arrival_lte', v)} placeholder="e.g. 3" />
          </Field>
        )}

        {tt === 'days_in_advance' && (
          <Field label="Fire when booked N+ days in advance">
            <Input type="number" value={form.days_in_advance_gte} onChange={v => set('days_in_advance_gte', v)} placeholder="e.g. 30" />
          </Field>
        )}

        {tt === 'gap_fill' && (
          <Field label="Max gap nights to trigger">
            <Input type="number" value={form.gap_max_nights} onChange={v => set('gap_max_nights', v)} placeholder="e.g. 3" />
          </Field>
        )}

        <Field label="Applies to Booking Tier (leave blank = all)">
          <Select value={form.booking_tier} onChange={v => set('booking_tier', v)}>
            <option value="">All Tiers</option>
            {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Booking Type">
          <Select value={form.applies_to_booking_type} onChange={v => set('applies_to_booking_type', v)}>
            <option value="transient">Transient</option>
            <option value="">All</option>
          </Select>
        </Field>

        <Field label="Action Type">
          <Select value={form.action_type} onChange={v => set('action_type', v)}>
            <option value="percent_uplift">Percentage Uplift</option>
            <option value="percent_discount">Percentage Discount</option>
            <option value="fixed_uplift">Fixed Amount Uplift</option>
            <option value="fixed_discount">Fixed Amount Discount</option>
          </Select>
        </Field>
        <Field label="Action Value">
          <Input type="number" value={form.action_value} onChange={v => set('action_value', v)} placeholder="e.g. 15" />
        </Field>

        <Field label="Floor Price (€)">
          <Input type="number" value={form.floor_price} onChange={v => set('floor_price', v)} placeholder="Never go below" />
        </Field>
        <Field label="Ceiling Price (€)">
          <Input type="number" value={form.ceiling_price} onChange={v => set('ceiling_price', v)} placeholder="Never go above" />
        </Field>

        <Field label="Pricing Model Scope">
          <Select value={form.pricing_model_scope} onChange={v => set('pricing_model_scope', v)}>
            <option value="all">All Pricing Models</option>
            <option value="per_night">Per Night Only</option>
            <option value="per_hour">Per Hour Only</option>
          </Select>
        </Field>
        <div />

        <Field label="Valid From">
          <Input type="date" value={form.valid_from} onChange={v => set('valid_from', v)} />
        </Field>
        <Field label="Valid Until">
          <Input type="date" value={form.valid_until} onChange={v => set('valid_until', v)} />
        </Field>

        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="rule-active" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} />
            <label htmlFor="rule-active" style={{ fontSize: 13 }}>Active</label>
          </div>
        </div>
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} saveLabel={rule ? 'Update Rule' : 'Create Rule'} />
    </Modal>
  );
}

function YieldRulesTab() {
  const [rules, setRules] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([
        api.get('/revenue/yield-rules/'),
        api.get('/revenue/booking-tiers/'),
      ]);
      setRules(r.data.results ?? r.data);
      setTiers(t.data.results ?? t.data);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(saved, mode) {
    if (mode === 'create') setRules(prev => [...prev, saved]);
    else setRules(prev => prev.map(r => r.id === saved.id ? saved : r));
    setModal(null);
  }

  const tierName = (id) => tiers.find(t => t.id === id)?.name ?? 'All tiers';

  return (
    <div>
      <SecHdr>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Yield Rules</div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ rule: null })}>+ New Rule</button>
      </SecHdr>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
        Rules are evaluated in priority order (lowest number first). First matching rule wins — no stacking. Rules only fire for transient bookings.
      </div>
      <div className="card">
        {loading ? <LoadingState /> : rules.length === 0 ? (
          <EmptyState message="No yield rules configured. Create one to enable dynamic pricing." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>Action</th>
                  <th>Scope</th>
                  <th>Valid Period</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.priority}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ fontSize: 12 }}>{TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type}</td>
                    <td style={{ fontSize: 12 }}>
                      {ACTION_LABELS[r.action_type] ?? r.action_type} {r.action_value}
                      {r.action_type?.includes('percent') ? '%' : '€'}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.booking_tier ? tierName(r.booking_tier) : 'All tiers'}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.valid_from ? `${fmtDate(r.valid_from)} → ${r.valid_until ? fmtDate(r.valid_until) : '∞'}` : '—'}
                    </td>
                    <td><StatusBadge value={r.is_active} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ rule: r })}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal !== null && (
        <YieldRuleModal rule={modal.rule} tiers={tiers} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

// ─── Tab 3: Hourly Config ────────────────────────────────────────────────────

const HOURLY_DEFAULTS = {
  berth: '', min_duration_minutes: 60, max_duration_minutes: 480,
  increment_minutes: '60', pricing_item: '', eligible_booking_types: 'transient', is_active: true,
};

function HourlyConfigModal({ config, onClose, onSaved }) {
  const [form, setForm] = useState(config ? { ...config } : { ...HOURLY_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.berth) { setError('Berth ID is required.'); return; }
    if (!form.pricing_item) { setError('Pricing item is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (config) {
        const { data } = await api.patch(`/revenue/hourly-configs/${config.id}/`, form);
        onSaved(data, 'update');
      } else {
        const { data } = await api.post('/revenue/hourly-configs/', form);
        onSaved(data, 'create');
      }
    } catch (e) {
      setError(e.response?.data?.detail || JSON.stringify(e.response?.data) || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={config ? 'Edit Hourly Config' : 'New Hourly Config'} onClose={onClose}>
      {error && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {!config && (
        <Field label="Berth ID">
          <Input type="number" value={form.berth} onChange={v => set('berth', v)} placeholder="Berth primary key" />
        </Field>
      )}
      {config && (
        <Field label="Berth">
          <div style={{ fontSize: 13, padding: '7px 0', fontWeight: 600 }}>{config.berth_name || `Berth #${config.berth}`}</div>
        </Field>
      )}
      <Field label="Min Duration (minutes)">
        <Input type="number" value={form.min_duration_minutes} onChange={v => set('min_duration_minutes', Number(v))} />
      </Field>
      <Field label="Max Duration (minutes)">
        <Input type="number" value={form.max_duration_minutes} onChange={v => set('max_duration_minutes', Number(v))} />
      </Field>
      <Field label="Increment">
        <Select value={form.increment_minutes} onChange={v => set('increment_minutes', v)}>
          <option value="15">15 Minutes</option>
          <option value="30">30 Minutes</option>
          <option value="60">1 Hour</option>
          <option value="240">4 Hours (Half Day)</option>
        </Select>
      </Field>
      <Field label="Pricing Item ID (per_hour ChargeableItem)">
        <Input type="number" value={form.pricing_item} onChange={v => set('pricing_item', v)} placeholder="ChargeableItem PK" />
      </Field>
      <Field label="Eligible Booking Types">
        <Input value={form.eligible_booking_types} onChange={v => set('eligible_booking_types', v)} placeholder="transient,seasonal" />
      </Field>
      <Field label="Status">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="hc-active" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} />
          <label htmlFor="hc-active" style={{ fontSize: 13 }}>Active</label>
        </div>
      </Field>
      <ModalActions onClose={onClose} onSave={save} saving={saving} saveLabel={config ? 'Update Config' : 'Create Config'} />
    </Modal>
  );
}

function HourlyConfigTab() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/revenue/hourly-configs/');
      setConfigs(data.results ?? data);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(saved, mode) {
    if (mode === 'create') setConfigs(prev => [...prev, saved]);
    else setConfigs(prev => prev.map(c => c.id === saved.id ? saved : c));
    setModal(null);
  }

  return (
    <div>
      <SecHdr>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Hourly Berth Configs</div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ config: null })}>+ New Config</button>
      </SecHdr>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
        Enable sub-day hourly bookings for specific berths. Berths without a config only accept overnight bookings.
      </div>
      <div className="card">
        {loading ? <LoadingState /> : configs.length === 0 ? (
          <EmptyState message="No hourly configs set up. Add one to enable part-day bookings on a berth." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Berth</th>
                  <th>Min (min)</th>
                  <th>Max (min)</th>
                  <th>Increment</th>
                  <th>Pricing Item</th>
                  <th>Types</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {configs.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.berth_name || `#${c.berth}`}</td>
                    <td>{c.min_duration_minutes}</td>
                    <td>{c.max_duration_minutes}</td>
                    <td>{c.increment_minutes} min</td>
                    <td style={{ fontSize: 12 }}>{c.pricing_item_name || `#${c.pricing_item}`}</td>
                    <td style={{ fontSize: 12 }}>{c.eligible_booking_types}</td>
                    <td><StatusBadge value={c.is_active} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ config: c })}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal !== null && (
        <HourlyConfigModal config={modal.config} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

// ─── Tab 4: Campaigns ────────────────────────────────────────────────────────

function CampaignsTab() {
  const [subTab, setSubTab] = useState('upgrade');
  const [upgrades, setUpgrades] = useState([]);
  const [upsells, setUpsells] = useState([]);
  const [loadingU, setLoadingU] = useState(true);
  const [loadingS, setLoadingS] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const loadUpgrades = useCallback(async () => {
    setLoadingU(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const { data } = await api.get(`/revenue/upgrade-campaigns/${params}`);
      setUpgrades(data.results ?? data);
    } catch {
      setUpgrades([]);
    } finally {
      setLoadingU(false);
    }
  }, [statusFilter]);

  const loadUpsells = useCallback(async () => {
    setLoadingS(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const { data } = await api.get(`/revenue/upsell-offers/${params}`);
      setUpsells(data.results ?? data);
    } catch {
      setUpsells([]);
    } finally {
      setLoadingS(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadUpgrades(); }, [loadUpgrades]);
  useEffect(() => { loadUpsells(); }, [loadUpsells]);

  async function handleUpgradeAction(id, status) {
    try {
      const { data } = await api.patch(`/revenue/upgrade-campaigns/${id}/`, { status });
      setUpgrades(prev => prev.map(u => u.id === id ? { ...u, ...data } : u));
    } catch {
      // silent
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {[['upgrade', 'Upgrade Campaigns'], ['upsell', 'In-Stay Upsell']].map(([v, l]) => (
          <button
            key={v}
            className={`btn btn-sm ${subTab === v ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setSubTab(v)}
          >{l}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Status:</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, border: 'var(--border)' }}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {subTab === 'upgrade' && (
        <div className="card">
          {loadingU ? <LoadingState /> : upgrades.length === 0 ? (
            <EmptyState message="No upgrade campaigns found. Campaigns are generated nightly by the background task." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>From Tier</th>
                    <th>To Tier</th>
                    <th>Berth Offered</th>
                    <th>Differential</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {upgrades.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.guest_name || `Booking #${u.booking}`}</td>
                      <td style={{ fontSize: 12 }}>{u.from_tier?.name ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{u.to_tier?.name ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{u.offered_berth_name || `#${u.offered_berth}`}</td>
                      <td>{fmt(u.differential_amount)}</td>
                      <td><StatusBadge value={u.status} /></td>
                      <td style={{ fontSize: 12 }}>{fmtDate(u.sent_at)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(u.expires_at)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {u.status === 'pending' && <>
                          <button className="btn btn-ghost btn-sm" style={{ color: '#27ae60' }} onClick={() => handleUpgradeAction(u.id, 'accepted')}>Accept</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: '#c0392b', marginLeft: 4 }} onClick={() => handleUpgradeAction(u.id, 'declined')}>Decline</button>
                        </>}
                        {u.checkout_link && (
                          <a href={u.checkout_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }}>Link</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'upsell' && (
        <div className="card">
          {loadingS ? <LoadingState /> : upsells.length === 0 ? (
            <EmptyState message="No upsell offers found." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Item</th>
                    <th>Discount %</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {upsells.map(o => (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 600 }}>#{o.booking}</td>
                      <td>{o.chargeable_item_name || `Item #${o.chargeable_item}`}</td>
                      <td>{o.discount_pct ? `${o.discount_pct}%` : '—'}</td>
                      <td style={{ fontSize: 12 }}>{o.trigger_event}</td>
                      <td><StatusBadge value={o.status} /></td>
                      <td style={{ fontSize: 12 }}>{fmtDate(o.sent_at)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(o.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: Competitors ──────────────────────────────────────────────────────

const COMPETITOR_DEFAULTS = {
  competitor_name: '', competitor_url: '', vessel_length_m: '10.00',
  rate_per_night: '', valid_from: '', valid_until: '', source: 'manual',
};

function CompetitorModal({ rate, onClose, onSaved }) {
  const [form, setForm] = useState(rate ? { ...rate } : { ...COMPETITOR_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.competitor_name.trim()) { setError('Competitor name is required.'); return; }
    if (!form.rate_per_night) { setError('Rate per night is required.'); return; }
    if (!form.valid_from) { setError('Valid from date is required.'); return; }
    setSaving(true);
    setError('');
    const payload = { ...form };
    if (payload.valid_until === '') payload.valid_until = null;
    try {
      if (rate) {
        const { data } = await api.patch(`/revenue/competitor-rates/${rate.id}/`, payload);
        onSaved(data, 'update');
      } else {
        const { data } = await api.post('/revenue/competitor-rates/', payload);
        onSaved(data, 'create');
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={rate ? 'Edit Competitor Rate' : 'New Competitor Rate'} onClose={onClose}>
      {error && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <Field label="Competitor Name">
        <Input value={form.competitor_name} onChange={v => set('competitor_name', v)} placeholder="e.g. Porto Lago Marina" />
      </Field>
      <Field label="Booking URL (for weekly scraper)">
        <Input type="url" value={form.competitor_url} onChange={v => set('competitor_url', v)} placeholder="https://marina.com/berths" />
      </Field>
      <Field label="Reference Vessel Length (m)">
        <Input type="number" value={form.vessel_length_m} onChange={v => set('vessel_length_m', v)} placeholder="10.00" />
      </Field>
      <Field label="Rate Per Night (€)">
        <Input type="number" value={form.rate_per_night} onChange={v => set('rate_per_night', v)} placeholder="e.g. 62.00" />
      </Field>
      <Field label="Valid From">
        <Input type="date" value={form.valid_from} onChange={v => set('valid_from', v)} />
      </Field>
      <Field label="Valid Until">
        <Input type="date" value={form.valid_until} onChange={v => set('valid_until', v)} />
      </Field>
      <Field label="Source">
        <Select value={form.source} onChange={v => set('source', v)}>
          <option value="manual">Manual Entry</option>
          <option value="scraper">Auto-Scraped</option>
        </Select>
      </Field>
      <ModalActions onClose={onClose} onSave={save} saving={saving} saveLabel={rate ? 'Update Rate' : 'Add Competitor'} />
    </Modal>
  );
}

function CompetitorsTab() {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/revenue/competitor-rates/');
      setRates(data.results ?? data);
    } catch {
      setRates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(saved, mode) {
    if (mode === 'create') setRates(prev => [saved, ...prev]);
    else setRates(prev => prev.map(r => r.id === saved.id ? saved : r));
    setModal(null);
  }

  async function deleteRate(id) {
    setDeleting(id);
    try {
      await api.delete(`/revenue/competitor-rates/${id}/`);
      setRates(prev => prev.filter(r => r.id !== id));
    } catch {
      // silent
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <SecHdr>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Competitor Rates</div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ rate: null })}>+ Add Competitor</button>
      </SecHdr>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
        Competitor rates are surfaced as reference overlay lines on the ADR analytics chart. The weekly scraper auto-populates records that have a booking URL configured.
      </div>
      <div className="card">
        {loading ? <LoadingState /> : rates.length === 0 ? (
          <EmptyState message="No competitor rates added yet. Add a competitor to enable benchmarking on the ADR chart." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Vessel (m)</th>
                  <th>Rate / Night</th>
                  <th>Valid From</th>
                  <th>Valid Until</th>
                  <th>Source</th>
                  <th>Scraped At</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rates.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.competitor_name}</div>
                      {r.competitor_url && (
                        <a href={r.competitor_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--teal)' }}>
                          {r.competitor_url.replace(/^https?:\/\//, '').slice(0, 40)}
                        </a>
                      )}
                    </td>
                    <td>{r.vessel_length_m}m</td>
                    <td style={{ fontWeight: 600 }}>{fmt(r.rate_per_night)}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(r.valid_from)}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(r.valid_until)}</td>
                    <td><StatusBadge value={r.source} /></td>
                    <td style={{ fontSize: 12 }}>{r.scraped_at ? fmtDate(r.scraped_at) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ rate: r })}>Edit</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: '#c0392b', marginLeft: 4 }}
                        disabled={deleting === r.id}
                        onClick={() => deleteRate(r.id)}
                      >{deleting === r.id ? '…' : 'Delete'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal !== null && (
        <CompetitorModal rate={modal.rate} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

const TABS = [
  ['booking-tiers', 'Booking Tiers'],
  ['yield-rules',   'Yield Rules'],
  ['hourly-config', 'Hourly Config'],
  ['campaigns',     'Campaigns'],
  ['competitors',   'Competitors'],
];

export default function RevenueIntelligence() {
  const [tab, setTab] = useState('booking-tiers');

  return (
    <div>
      <PageHeader
        title="Revenue Intelligence"
        subtitle="Dynamic pricing — tiers, yield rules, promotions, and competitor rates."
        infoBody={SCREEN_INFO.revenueIntelligence}
      />
      <div className="tabs">
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      <div style={{ paddingTop: 4 }}>
        {tab === 'booking-tiers' && <BookingTiersTab />}
        {tab === 'yield-rules'   && <YieldRulesTab />}
        {tab === 'hourly-config' && <HourlyConfigTab />}
        {tab === 'campaigns'     && <CampaignsTab />}
        {tab === 'competitors'   && <CompetitorsTab />}
      </div>
    </div>
  );
}
