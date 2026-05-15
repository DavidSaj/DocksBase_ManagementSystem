import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import ScreenInfo from '../components/ui/ScreenInfo.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ width: wide ? 680 : 480, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Drawer({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 480, height: '100%', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.08)', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '20px 24px', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
    </div>
  );
}

function FormActions({ onClose, saving, saveLabel = 'Save' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : saveLabel}</button>
    </div>
  );
}

function EmptyState({ message, action, onAction }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'rgba(0,0,0,0.35)' }}>
      <div style={{ fontSize: 13, marginBottom: action ? 14 : 0 }}>{message}</div>
      {action && (
        <button className="btn btn-primary btn-sm" onClick={onAction}>{action}</button>
      )}
    </div>
  );
}

function LoadingRow({ cols }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: 'center', padding: '32px 16px', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
        Loading…
      </td>
    </tr>
  );
}

function statusBadge(status) {
  const map = {
    enquiry: { label: 'Enquiry', color: '#6c757d' },
    confirmed: { label: 'Confirmed', color: '#0d6efd' },
    active: { label: 'Active', color: '#198754' },
    completed: { label: 'Completed', color: '#6f42c1' },
    cancelled: { label: 'Cancelled', color: '#dc3545' },
    pending: { label: 'Pending', color: '#fd7e14' },
    approved: { label: 'Approved', color: '#0d6efd' },
    paid: { label: 'Paid', color: '#198754' },
    expected: { label: 'Expected', color: '#6c757d' },
    arrived: { label: 'Arrived', color: '#198754' },
    departed: { label: 'Departed', color: '#6f42c1' },
  };
  const s = map[status] || { label: status, color: '#6c757d' };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: s.color + '18', color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function channelBadge(channel) {
  if (!channel || channel === 'direct') return null;
  const map = { zizoo: { label: 'Zizoo', color: '#0d6efd' }, click_and_boat: { label: 'C&B', color: '#fd7e14' } };
  const c = map[channel] || { label: channel, color: '#6c757d' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: c.color + '18', color: c.color, marginLeft: 6 }}>
      {c.label}
    </span>
  );
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(val) {
  if (val == null) return '—';
  return '€' + Number(val).toFixed(2);
}

// ── Tab navigation ─────────────────────────────────────────────────────────────

const TABS = [
  { id: 'fleet', label: 'Charter Fleet' },
  { id: 'bookings', label: 'Charter Bookings' },
  { id: 'harbour', label: 'Harbour Dues' },
  { id: 'agents', label: 'Shipping Agents' },
  { id: 'vessels', label: 'Vessel Calls' },
];

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 20 }}>
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '9px 16px', fontSize: 13, fontWeight: 500, border: 'none', background: 'none',
            cursor: 'pointer', borderBottom: active === t.id ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
            color: active === t.id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.5)',
            marginBottom: -1, transition: 'color 0.12s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Charter Fleet tab ──────────────────────────────────────────────────────────

function CharterVesselDrawer({ vessel, onClose, onBook }) {
  if (!vessel) return null;
  const v = vessel.vessel || {};
  const agreements = vessel.management_agreements || [];

  return (
    <Drawer title={v.name || 'Charter Vessel'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Vessel Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>LOA</div><div style={{ fontSize: 13, fontWeight: 500 }}>{v.loa ? `${v.loa}m` : '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Flag</div><div style={{ fontSize: 13, fontWeight: 500 }}>{v.flag || '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Skipper Required</div><div style={{ fontSize: 13, fontWeight: 500 }}>{vessel.skipper_required ? 'Yes' : 'No'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Fuel Inclusive</div><div style={{ fontSize: 13, fontWeight: 500 }}>{vessel.fuel_inclusive ? 'Yes' : 'No'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Security Deposit</div><div style={{ fontSize: 13, fontWeight: 500 }}>{fmtMoney(vessel.security_deposit)}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Status</div><div style={{ fontSize: 13 }}>{vessel.is_available ? statusBadge('active') : statusBadge('cancelled')}</div></div>
          </div>
          {vessel.min_charterer_qual && (
            <div style={{ marginTop: 10 }}><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Min. Qualification</div><div style={{ fontSize: 13 }}>{vessel.min_charterer_qual}</div></div>
          )}
        </div>

        {agreements.length > 0 && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Management Agreements</div>
            {agreements.map((ag, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < agreements.length - 1 ? '1px solid rgba(0,0,0,0.07)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{ag.owner_label || 'Marina'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>Commission {ag.commission_rate}% · Valid {fmtDate(ag.valid_from)}{ag.valid_to ? ` – ${fmtDate(ag.valid_to)}` : ' (current)'}</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy, #1a2d4a)' }}>{ag.split_percentage}%</span>
              </div>
            ))}
          </div>
        )}

        {vessel.notes && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>{vessel.notes}</div>
          </div>
        )}

        <button className="btn btn-primary" onClick={() => onBook(vessel)}>
          + Book Now
        </button>
      </div>
    </Drawer>
  );
}

function CharterFleetTab() {
  const [vessels, setVessels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showBookWizard, setShowBookWizard] = useState(false);
  const [prefilledVessel, setPrefilledVessel] = useState(null);

  useEffect(() => {
    api.get('/charter/vessels/')
      .then(r => setVessels(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleBook(vessel) {
    setSelected(null);
    setPrefilledVessel(vessel);
    setShowBookWizard(true);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowBookWizard(true)}>+ New Booking</button>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>LOA</th>
                <th>Skipper Req.</th>
                <th>Fuel Incl.</th>
                <th>Deposit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={6} />
              ) : vessels.length === 0 ? (
                <tr><td colSpan={6}><EmptyState message="No charter vessels configured." /></td></tr>
              ) : (
                vessels.map(v => (
                  <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(v)}>
                    <td style={{ fontWeight: 600 }}>{v.vessel?.name || `Vessel #${v.id}`}</td>
                    <td>{v.vessel?.loa ? `${v.vessel.loa}m` : '—'}</td>
                    <td>{v.skipper_required ? 'Yes' : 'No'}</td>
                    <td>{v.fuel_inclusive ? 'Yes' : 'No'}</td>
                    <td>{fmtMoney(v.security_deposit)}</td>
                    <td>{v.is_available ? statusBadge('active') : <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>Unavailable</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <CharterVesselDrawer
          vessel={selected}
          onClose={() => setSelected(null)}
          onBook={handleBook}
        />
      )}

      {showBookWizard && (
        <CharterBookingWizard
          vessels={vessels}
          prefilledVessel={prefilledVessel}
          onClose={() => { setShowBookWizard(false); setPrefilledVessel(null); }}
          onCreated={() => { setShowBookWizard(false); setPrefilledVessel(null); }}
        />
      )}
    </div>
  );
}

// ── Charter Booking Wizard ────────────────────────────────────────────────────

function CharterBookingWizard({ vessels, prefilledVessel, onClose, onCreated }) {
  const [step, setStep] = useState(prefilledVessel ? 1 : 0);
  const [vesselId, setVesselId] = useState(prefilledVessel?.id ?? '');
  const [startDt, setStartDt] = useState('');
  const [endDt, setEndDt] = useState('');
  const [durationUnit, setDurationUnit] = useState('daily');
  const [chartererName, setChartererName] = useState('');
  const [chartererEmail, setChartererEmail] = useState('');
  const [chartererPhone, setChartererPhone] = useState('');
  const [channel, setChannel] = useState('direct');
  const [agentName, setAgentName] = useState('');
  const [agentCommissionRate, setAgentCommissionRate] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const totalSteps = 4;

  async function handleSubmit() {
    setSaving(true); setErr(null);
    try {
      await api.post('/charter/bookings/', {
        charter_vessel: vesselId,
        charterer_name: chartererName,
        charterer_email: chartererEmail,
        charterer_phone: chartererPhone,
        start_dt: startDt,
        end_dt: endDt,
        duration_unit: durationUnit,
        channel,
        agent_name: agentName,
        agent_commission_rate: Number(agentCommissionRate),
        internal_notes: notes,
      });
      onCreated();
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? JSON.stringify(ex?.response?.data) ?? 'Save failed');
      setSaving(false);
    }
  }

  const STEP_LABELS = ['Vessel', 'Dates', 'Charterer', 'Channel & Confirm'];

  return (
    <Modal title="New Charter Booking" onClose={onClose} wide>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 20 }}>
          {STEP_LABELS.map((lbl, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', padding: '6px 0', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', color: step === i ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.3)', borderBottom: step === i ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent', cursor: 'pointer' }} onClick={() => setStep(i)}>
              {i + 1}. {lbl}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldGroup label="Charter Vessel">
              <select className="form-control" required value={vesselId} onChange={e => setVesselId(e.target.value)}>
                <option value="">Select vessel…</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.vessel?.name || `#${v.id}`}</option>)}
              </select>
            </FieldGroup>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldGroup label="Duration Unit">
              <select className="form-control" value={durationUnit} onChange={e => setDurationUnit(e.target.value)}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Start Date & Time">
              <input className="form-control" type="datetime-local" required value={startDt} onChange={e => setStartDt(e.target.value)} />
            </FieldGroup>
            <FieldGroup label="End Date & Time">
              <input className="form-control" type="datetime-local" required value={endDt} onChange={e => setEndDt(e.target.value)} />
            </FieldGroup>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldGroup label="Charterer Name">
              <input className="form-control" type="text" placeholder="Full name" value={chartererName} onChange={e => setChartererName(e.target.value)} />
            </FieldGroup>
            <FieldGroup label="Charterer Email">
              <input className="form-control" type="email" placeholder="email@example.com" value={chartererEmail} onChange={e => setChartererEmail(e.target.value)} />
            </FieldGroup>
            <FieldGroup label="Charterer Phone">
              <input className="form-control" type="tel" placeholder="+1 000 000 0000" value={chartererPhone} onChange={e => setChartererPhone(e.target.value)} />
            </FieldGroup>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldGroup label="Booking Channel">
              <select className="form-control" value={channel} onChange={e => setChannel(e.target.value)}>
                <option value="direct">Direct</option>
                <option value="zizoo">Zizoo</option>
                <option value="click_and_boat">Click &amp; Boat</option>
                <option value="other">Other</option>
              </select>
            </FieldGroup>
            {channel !== 'direct' && (
              <>
                <FieldGroup label="Agent Name">
                  <input className="form-control" type="text" value={agentName} onChange={e => setAgentName(e.target.value)} />
                </FieldGroup>
                <FieldGroup label="Agent Commission %">
                  <input className="form-control" type="number" min={0} max={100} step={0.5} value={agentCommissionRate} onChange={e => setAgentCommissionRate(e.target.value)} />
                </FieldGroup>
              </>
            )}
            <FieldGroup label="Internal Notes">
              <textarea className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
            </FieldGroup>

            <div className="card" style={{ padding: 14, background: 'rgba(26,45,74,0.04)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Booking Summary</div>
              <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Vessel</span><span style={{ fontWeight: 500 }}>{vessels.find(v => String(v.id) === String(vesselId))?.vessel?.name || '—'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>From</span><span style={{ fontWeight: 500 }}>{startDt ? fmtDateTime(startDt) : '—'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>To</span><span style={{ fontWeight: 500 }}>{endDt ? fmtDateTime(endDt) : '—'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Charterer</span><span style={{ fontWeight: 500 }}>{chartererName || '—'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Channel</span><span style={{ fontWeight: 500 }}>{channel}</span></div>
              </div>
            </div>

            {err && <div style={{ color: '#dc3545', fontSize: 12, padding: '8px 12px', background: '#dc354511', borderRadius: 6 }}>{err}</div>}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <button className="btn btn-ghost" onClick={() => step > 0 ? setStep(s => s - 1) : onClose()}>
          {step === 0 ? 'Cancel' : '← Back'}
        </button>
        {step < totalSteps - 1 ? (
          <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={step === 0 && !vesselId}>
            Next →
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !vesselId || !startDt || !endDt}>
            {saving ? 'Confirming…' : 'Confirm Booking'}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Charter Bookings tab ───────────────────────────────────────────────────────

function CharterBookingDrawer({ booking, onClose, onStatusChange }) {
  const [updating, setUpdating] = useState(false);

  async function changeStatus(status) {
    setUpdating(true);
    try {
      await api.patch(`/charter/bookings/${booking.id}/`, { status });
      onStatusChange(booking.id, status);
    } finally {
      setUpdating(false);
    }
  }

  if (!booking) return null;

  return (
    <Drawer title={`Charter Booking #${booking.id}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Overview</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Vessel</div><div style={{ fontSize: 13, fontWeight: 500 }}>{booking.charter_vessel_name || `#${booking.charter_vessel}`}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Status</div><div style={{ marginTop: 2 }}>{statusBadge(booking.status)}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Start</div><div style={{ fontSize: 13 }}>{fmtDateTime(booking.start_dt)}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>End</div><div style={{ fontSize: 13 }}>{fmtDateTime(booking.end_dt)}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Duration</div><div style={{ fontSize: 13, fontWeight: 500 }}>{booking.duration_unit}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Channel</div><div style={{ fontSize: 13 }}>{booking.channel || 'direct'}{channelBadge(booking.channel)}</div></div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Charterer</div>
          <div style={{ fontSize: 13 }}>{booking.charterer_name || '(Member)'}</div>
          {booking.charterer_email && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>{booking.charterer_email}</div>}
          {booking.charterer_phone && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>{booking.charterer_phone}</div>}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Financials</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Subtotal</span><span>{fmtMoney(booking.subtotal)}</span></div>
            {booking.cleaning_fee > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Cleaning Fee</span><span>{fmtMoney(booking.cleaning_fee)}</span></div>}
            {booking.skipper_fee > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Skipper Fee</span><span>{fmtMoney(booking.skipper_fee)}</span></div>}
            {booking.channel_commission > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Channel Commission</span><span style={{ color: '#dc3545' }}>-{fmtMoney(booking.channel_commission)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 6, marginTop: 2 }}><span>Total</span><span>{fmtMoney(booking.total)}</span></div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Deposit</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{fmtMoney(booking.deposit_amount)}</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{booking.deposit_mechanism === 'auth_hold' ? 'Auth & Hold' : booking.deposit_mechanism === 'captured' ? 'Captured' : '—'}</div>
            </div>
            {statusBadge(booking.deposit_status || 'pending')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {booking.status === 'enquiry' && <button className="btn btn-primary btn-sm" disabled={updating} onClick={() => changeStatus('confirmed')}>Confirm</button>}
          {booking.status === 'confirmed' && <button className="btn btn-primary btn-sm" disabled={updating} onClick={() => changeStatus('active')}>Mark Active</button>}
          {booking.status === 'active' && <button className="btn btn-primary btn-sm" disabled={updating} onClick={() => changeStatus('completed')}>Mark Completed</button>}
          {['enquiry', 'confirmed'].includes(booking.status) && <button className="btn btn-ghost btn-sm" style={{ color: '#dc3545' }} disabled={updating} onClick={() => changeStatus('cancelled')}>Cancel</button>}
        </div>

        {booking.internal_notes && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>{booking.internal_notes}</div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function CharterBookingsTab() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchBookings = useCallback(() => {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    api.get(`/charter/bookings/${params}`)
      .then(r => setBookings(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  function handleStatusChange(id, status) {
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    if (selected?.id === id) setSelected(s => ({ ...s, status }));
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select className="form-control" style={{ width: 'auto' }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setLoading(true); }}>
          <option value="">All statuses</option>
          <option value="enquiry">Enquiry</option>
          <option value="confirmed">Confirmed</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Vessel</th>
                <th>Charterer</th>
                <th>Start</th>
                <th>End</th>
                <th>Channel</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={8} />
              ) : bookings.length === 0 ? (
                <tr><td colSpan={8}><EmptyState message="No charter bookings found." /></td></tr>
              ) : (
                bookings.map(b => (
                  <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                    <td style={{ fontWeight: 600, color: 'rgba(0,0,0,0.5)' }}>#{b.id}</td>
                    <td style={{ fontWeight: 500 }}>{b.charter_vessel_name || `#${b.charter_vessel}`}</td>
                    <td>{b.charterer_name || '(Member)'}</td>
                    <td>{fmtDate(b.start_dt)}</td>
                    <td>{fmtDate(b.end_dt)}</td>
                    <td>{b.channel || 'direct'}{channelBadge(b.channel)}</td>
                    <td>{fmtMoney(b.total)}</td>
                    <td>{statusBadge(b.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <CharterBookingDrawer
          booking={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}

// ── Harbour Dues tab ───────────────────────────────────────────────────────────

function NewHarbourDueModal({ agents, onClose, onCreated }) {
  const [vesselName, setVesselName] = useState('');
  const [dueType, setDueType] = useState('harbour_dues');
  const [amount, setAmount] = useState('');
  const [agentId, setAgentId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const { data } = await api.post('/harbour/dues/', {
        vessel_name: vesselName,
        due_type: dueType,
        amount,
        shipping_agent: agentId || null,
        notes,
      });
      onCreated(data);
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal title="Log Harbour Due" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Vessel Name">
            <input className="form-control" required type="text" value={vesselName} onChange={e => setVesselName(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Due Type">
            <select className="form-control" value={dueType} onChange={e => setDueType(e.target.value)}>
              <option value="harbour_dues">Harbour Dues / Port Dues</option>
              <option value="pilotage">Pilotage</option>
              <option value="tug">Tug</option>
              <option value="passenger_landing">Passenger Landing</option>
              <option value="cargo_handling">Cargo Handling</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Amount (€)">
            <input className="form-control" required type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Shipping Agent">
            <select className="form-control" value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">None / Unknown</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Notes">
            <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </FieldGroup>
          {err && <div style={{ color: '#dc3545', fontSize: 12 }}>{err}</div>}
          <FormActions onClose={onClose} saving={saving} saveLabel="Log Due" />
        </div>
      </form>
    </Modal>
  );
}

function HarbourDuesTab() {
  const [dues, setDues] = useState([]);
  const [summary, setSummary] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/harbour/dues/').then(r => r.data.results ?? r.data),
      api.get('/harbour/dues/summary/').then(r => r.data).catch(() => null),
      api.get('/harbour/agents/').then(r => r.data.results ?? r.data).catch(() => []),
    ]).then(([duesData, summaryData, agentsData]) => {
      setDues(duesData);
      setSummary(summaryData);
      setAgents(agentsData);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const DUE_TYPE_LABELS = {
    harbour_dues: 'Harbour Dues',
    pilotage: 'Pilotage',
    tug: 'Tug',
    passenger_landing: 'Passenger Landing',
    cargo_handling: 'Cargo Handling',
  };

  return (
    <div>
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Total Dues MTD', value: fmtMoney(summary.total_mtd) },
            { label: 'Outstanding', value: fmtMoney(summary.outstanding) },
            { label: 'Invoiced', value: fmtMoney(summary.invoiced) },
            { label: 'Vessel Calls', value: summary.vessel_calls ?? '—' },
          ].map((s, i) => (
            <div key={i} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Log Due</button>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Due Type</th>
                <th>Agent</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={6} />
              ) : dues.length === 0 ? (
                <tr><td colSpan={6}><EmptyState message="No harbour dues logged." /></td></tr>
              ) : (
                dues.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 500 }}>{d.vessel_name || '—'}</td>
                    <td>{DUE_TYPE_LABELS[d.due_type] || d.due_type}</td>
                    <td>{d.agent_name || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{fmtMoney(d.amount)}</td>
                    <td>{statusBadge(d.status || 'pending')}</td>
                    <td style={{ color: 'rgba(0,0,0,0.5)', fontSize: 12 }}>{fmtDate(d.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <NewHarbourDueModal
          agents={agents}
          onClose={() => setShowModal(false)}
          onCreated={d => { setDues(prev => [d, ...prev]); setShowModal(false); }}
        />
      )}
    </div>
  );
}

// ── Shipping Agents tab ────────────────────────────────────────────────────────

function ShippingAgentDrawer({ agent, onClose }) {
  if (!agent) return null;
  return (
    <Drawer title={agent.name} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Contact Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {agent.contact_name && <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Contact</div><div style={{ fontSize: 13 }}>{agent.contact_name}</div></div>}
            {agent.email && <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Email</div><a href={`mailto:${agent.email}`} style={{ fontSize: 13, color: 'var(--teal, #0d6efd)' }}>{agent.email}</a></div>}
            {agent.phone && <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Phone</div><div style={{ fontSize: 13 }}>{agent.phone}</div></div>}
            {agent.vat_number && <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>VAT Number</div><div style={{ fontSize: 13 }}>{agent.vat_number}</div></div>}
            {agent.address && <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Address</div><div style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{agent.address}</div></div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: agent.is_active ? '#198754' : '#dc3545' }} />
          <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)' }}>{agent.is_active ? 'Active' : 'Inactive'}</span>
        </div>
        {agent.notes && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>{agent.notes}</div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function NewShippingAgentModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const { data } = await api.post('/harbour/agents/', { name, contact_name: contactName, email, phone, address, vat_number: vatNumber, notes });
      onCreated(data);
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal title="New Shipping Agent" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Agency Name *">
            <input className="form-control" required type="text" placeholder="e.g. GAC Shipping" value={name} onChange={e => setName(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Contact Name">
            <input className="form-control" type="text" value={contactName} onChange={e => setContactName(e.target.value)} />
          </FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FieldGroup label="Email">
              <input className="form-control" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </FieldGroup>
            <FieldGroup label="Phone">
              <input className="form-control" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </FieldGroup>
          </div>
          <FieldGroup label="VAT Number">
            <input className="form-control" type="text" value={vatNumber} onChange={e => setVatNumber(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Address">
            <textarea className="form-control" rows={2} value={address} onChange={e => setAddress(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Notes">
            <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </FieldGroup>
          {err && <div style={{ color: '#dc3545', fontSize: 12 }}>{err}</div>}
          <FormActions onClose={onClose} saving={saving} saveLabel="Create Agent" />
        </div>
      </form>
    </Modal>
  );
}

function ShippingAgentsTab() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/harbour/agents/')
      .then(r => setAgents(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = agents.filter(a =>
    !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.contact_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="form-control" style={{ maxWidth: 260 }} type="text" placeholder="Search agents…" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ New Agent</button>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>VAT</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={6} />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6}><EmptyState message="No shipping agents found." action="+ New Agent" onAction={() => setShowModal(true)} /></td></tr>
              ) : (
                filtered.map(a => (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(a)}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td>{a.contact_name || '—'}</td>
                    <td style={{ color: 'var(--teal, #0d6efd)', fontSize: 12 }}>{a.email || '—'}</td>
                    <td style={{ fontSize: 12 }}>{a.phone || '—'}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{a.vat_number || '—'}</td>
                    <td>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.is_active ? '#198754' : '#dc3545' }} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <ShippingAgentDrawer agent={selected} onClose={() => setSelected(null)} />}

      {showModal && (
        <NewShippingAgentModal
          onClose={() => setShowModal(false)}
          onCreated={a => { setAgents(prev => [a, ...prev]); setShowModal(false); }}
        />
      )}
    </div>
  );
}

// ── Vessel Calls tab ───────────────────────────────────────────────────────────

function NewVesselCallModal({ agents, onClose, onCreated }) {
  const [vesselName, setVesselName] = useState('');
  const [imoNumber, setImoNumber] = useState('');
  const [vesselType, setVesselType] = useState('cargo');
  const [flag, setFlag] = useState('');
  const [grossTonnage, setGrossTonnage] = useState('');
  const [crewCount, setCrewCount] = useState(0);
  const [passengerCount, setPassengerCount] = useState(0);
  const [portOfOrigin, setPortOfOrigin] = useState('');
  const [nextPort, setNextPort] = useState('');
  const [agentId, setAgentId] = useState('');
  const [eta, setEta] = useState('');
  const [etd, setEtd] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const { data } = await api.post('/harbour/movements/', {
        vessel_name: vesselName,
        imo_number: imoNumber,
        vessel_type: vesselType,
        flag,
        gross_tonnage: grossTonnage || null,
        crew_count: crewCount,
        passenger_count: passengerCount,
        port_of_origin: portOfOrigin,
        next_port: nextPort,
        shipping_agent: agentId || null,
        eta: eta || null,
        etd: etd || null,
        notes,
      });
      onCreated(data);
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? JSON.stringify(ex?.response?.data) ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal title="Log Vessel Call" onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FieldGroup label="Vessel Name *">
            <input className="form-control" required type="text" value={vesselName} onChange={e => setVesselName(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="IMO Number">
            <input className="form-control" type="text" value={imoNumber} onChange={e => setImoNumber(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Vessel Type *">
            <select className="form-control" value={vesselType} onChange={e => setVesselType(e.target.value)}>
              <option value="ferry">Ferry</option>
              <option value="cargo">Cargo Vessel</option>
              <option value="fishing">Fishing Vessel (Commercial)</option>
              <option value="research">Research Vessel</option>
              <option value="pilot">Pilot Vessel</option>
              <option value="dredger">Dredger</option>
              <option value="supply">Supply Vessel</option>
              <option value="cruise_tender">Cruise Ship Tender</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Flag (ISO 3166-1 alpha-3)">
            <input className="form-control" type="text" maxLength={3} placeholder="e.g. GBR" value={flag} onChange={e => setFlag(e.target.value.toUpperCase())} />
          </FieldGroup>
          <FieldGroup label="Gross Tonnage (GT)">
            <input className="form-control" type="number" min={0} value={grossTonnage} onChange={e => setGrossTonnage(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Shipping Agent">
            <select className="form-control" value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">None / Unknown</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Crew Count">
            <input className="form-control" type="number" min={0} value={crewCount} onChange={e => setCrewCount(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Passenger Count">
            <input className="form-control" type="number" min={0} value={passengerCount} onChange={e => setPassengerCount(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Port of Origin">
            <input className="form-control" type="text" value={portOfOrigin} onChange={e => setPortOfOrigin(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Next Port">
            <input className="form-control" type="text" value={nextPort} onChange={e => setNextPort(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="ETA">
            <input className="form-control" type="datetime-local" value={eta} onChange={e => setEta(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="ETD">
            <input className="form-control" type="datetime-local" value={etd} onChange={e => setEtd(e.target.value)} />
          </FieldGroup>
        </div>
        <div style={{ marginTop: 12 }}>
          <FieldGroup label="Notes">
            <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </FieldGroup>
        </div>
        {err && <div style={{ color: '#dc3545', fontSize: 12, marginTop: 10 }}>{err}</div>}
        <FormActions onClose={onClose} saving={saving} saveLabel="Log Call" />
      </form>
    </Modal>
  );
}

function VesselCallDrawer({ call, onClose, onStatusChange }) {
  const [updating, setUpdating] = useState(false);

  async function markStatus(status) {
    setUpdating(true);
    try {
      await api.patch(`/harbour/movements/${call.id}/`, { status });
      onStatusChange(call.id, status);
    } finally {
      setUpdating(false);
    }
  }

  if (!call) return null;

  const VESSEL_TYPE_LABELS = {
    ferry: 'Ferry', cargo: 'Cargo', fishing: 'Fishing', research: 'Research',
    pilot: 'Pilot', dredger: 'Dredger', supply: 'Supply', cruise_tender: 'Cruise Tender',
  };

  return (
    <Drawer title={call.vessel_name} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Vessel</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>IMO</div><div style={{ fontSize: 13, fontWeight: 500 }}>{call.imo_number || '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Flag</div><div style={{ fontSize: 13, fontWeight: 500 }}>{call.flag || '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Type</div><div style={{ fontSize: 13, fontWeight: 500 }}>{VESSEL_TYPE_LABELS[call.vessel_type] || call.vessel_type}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>GT</div><div style={{ fontSize: 13, fontWeight: 500 }}>{call.gross_tonnage ?? '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Crew</div><div style={{ fontSize: 13 }}>{call.crew_count ?? 0}</div></div>
            <div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>Passengers</div><div style={{ fontSize: 13 }}>{call.passenger_count ?? 0}</div></div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Port Call</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>From</span><span>{call.port_of_origin || '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Next</span><span>{call.next_port || '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>ETA</span><span>{fmtDateTime(call.eta)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>ETD</span><span>{fmtDateTime(call.etd)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Agent</span><span>{call.shipping_agent_name || call.agent_name || '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Status</span>{statusBadge(call.status)}</div>
          </div>
        </div>

        {call.psc_flag && (
          <div style={{ padding: '10px 14px', background: '#dc354511', borderRadius: 8, fontSize: 12, color: '#dc3545', fontWeight: 600 }}>
            Port State Control inspection flagged
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {call.status === 'expected' && <button className="btn btn-primary btn-sm" disabled={updating} onClick={() => markStatus('arrived')}>Mark Arrived</button>}
          {call.status === 'arrived' && <button className="btn btn-primary btn-sm" disabled={updating} onClick={() => markStatus('departed')}>Mark Departed</button>}
          {call.status !== 'departed' && call.status !== 'cancelled' && <button className="btn btn-ghost btn-sm" style={{ color: '#dc3545' }} disabled={updating} onClick={() => markStatus('cancelled')}>Cancel</button>}
        </div>

        {call.notes && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>{call.notes}</div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function VesselCallsTab() {
  const [calls, setCalls] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchCalls = useCallback(() => {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    Promise.all([
      api.get(`/harbour/movements/${params}`).then(r => r.data.results ?? r.data),
      api.get('/harbour/agents/').then(r => r.data.results ?? r.data).catch(() => []),
    ]).then(([callsData, agentsData]) => {
      setCalls(callsData);
      setAgents(agentsData);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  function handleStatusChange(id, status) {
    setCalls(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    if (selected?.id === id) setSelected(s => ({ ...s, status }));
  }

  const VESSEL_TYPE_LABELS = {
    ferry: 'Ferry', cargo: 'Cargo', fishing: 'Fishing', research: 'Research',
    pilot: 'Pilot', dredger: 'Dredger', supply: 'Supply', cruise_tender: 'Cruise Tender',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select className="form-control" style={{ width: 'auto' }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setLoading(true); }}>
          <option value="">All statuses</option>
          <option value="expected">Expected</option>
          <option value="arrived">Arrived</option>
          <option value="departed">Departed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Log Vessel Call</button>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>IMO</th>
                <th>Type</th>
                <th>Flag</th>
                <th>GT</th>
                <th>ETA</th>
                <th>ETD</th>
                <th>Agent</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={9} />
              ) : calls.length === 0 ? (
                <tr><td colSpan={9}><EmptyState message="No vessel calls logged." action="+ Log Vessel Call" onAction={() => setShowModal(true)} /></td></tr>
              ) : (
                calls.map(c => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                    <td style={{ fontWeight: 600 }}>
                      {c.vessel_name}
                      {c.psc_flag && <span style={{ marginLeft: 6, fontSize: 10, color: '#dc3545', fontWeight: 700 }}>PSC</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{c.imo_number || '—'}</td>
                    <td style={{ fontSize: 12 }}>{VESSEL_TYPE_LABELS[c.vessel_type] || c.vessel_type}</td>
                    <td style={{ fontSize: 12 }}>{c.flag || '—'}</td>
                    <td style={{ fontSize: 12 }}>{c.gross_tonnage ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmtDateTime(c.eta)}</td>
                    <td style={{ fontSize: 12 }}>{fmtDateTime(c.etd)}</td>
                    <td style={{ fontSize: 12 }}>{c.shipping_agent_name || c.agent_name || '—'}</td>
                    <td>{statusBadge(c.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <VesselCallDrawer
          call={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
        />
      )}

      {showModal && (
        <NewVesselCallModal
          agents={agents}
          onClose={() => setShowModal(false)}
          onCreated={c => { setCalls(prev => [c, ...prev]); setShowModal(false); }}
        />
      )}
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function Charter() {
  const [tab, setTab] = useState('fleet');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy, #1a2d4a)', letterSpacing: '-0.5px' }}>Charter &amp; Harbour</div>
          <ScreenInfo title="Charter & Harbour" body={SCREEN_INFO.charter} />
        </div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>Manage charter fleet bookings, harbour dues, shipping agents, and commercial vessel calls.</div>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'fleet' && <CharterFleetTab />}
      {tab === 'bookings' && <CharterBookingsTab />}
      {tab === 'harbour' && <HarbourDuesTab />}
      {tab === 'agents' && <ShippingAgentsTab />}
      {tab === 'vessels' && <VesselCallsTab />}
    </div>
  );
}
