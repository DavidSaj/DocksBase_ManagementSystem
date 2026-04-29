import { useState } from 'react';
import useMarina from '../hooks/useMarina.js';
import useHaulOuts from '../hooks/useHaulOuts.js';
import useStorageSlots from '../hooks/useStorageSlots.js';
import useLaunchRequests from '../hooks/useLaunchRequests.js';
import useWorkOrders from '../hooks/useWorkOrders.js';
import useParts from '../hooks/useParts.js';
import useTools from '../hooks/useTools.js';
import useContractors from '../hooks/useContractors.js';
import useAssets from '../hooks/useAssets.js';
import useVessels from '../hooks/useVessels.js';
import Ic from '../components/ui/Icon.jsx';

// ── Modals ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 480, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>{title}</div>
        {children}
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

function ScheduleLiftModal({ vessels, onClose, onCreate }) {
  const [vesselId, setVesselId] = useState('');
  const [haulType, setHaulType] = useState('haul_out');
  const [scheduledAt, setScheduledAt] = useState('');
  const [equipment, setEquipment] = useState('');
  const [crew, setCrew] = useState(2);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ vessel: vesselId, haul_type: haulType, scheduled_at: scheduledAt, equipment, crew });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Schedule Lift" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Vessel">
            <select required value={vesselId} onChange={e => setVesselId(e.target.value)}>
              <option value="">Select vessel…</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Type">
            <select value={haulType} onChange={e => setHaulType(e.target.value)}>
              <option value="haul_out">Haul-out</option>
              <option value="splash">Splash</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Date & Time">
            <input type="datetime-local" required value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </FieldGroup>
          <FieldGroup label="Equipment">
            <input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="e.g. 50T Travelift" />
          </FieldGroup>
          <FieldGroup label="Crew Count">
            <input type="number" min={1} value={crew} onChange={e => setCrew(parseInt(e.target.value))} />
          </FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Schedule" />
      </form>
    </Modal>
  );
}

function NewWorkOrderModal({ vessels, onClose, onCreate }) {
  const [vesselId, setVesselId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ vessel: vesselId || null, title, category, description, priority, due: due || null });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="New Work Order" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Title">
            <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Engine service" />
          </FieldGroup>
          <FieldGroup label="Vessel (optional)">
            <select value={vesselId} onChange={e => setVesselId(e.target.value)}>
              <option value="">— none —</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Category">
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Mechanical" />
          </FieldGroup>
          <FieldGroup label="Priority">
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Description">
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
          </FieldGroup>
          <FieldGroup label="Due Date">
            <input type="date" value={due} onChange={e => setDue(e.target.value)} />
          </FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Create" />
      </form>
    </Modal>
  );
}

function AddPartModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [partNo, setPartNo] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState(0);
  const [par, setPar] = useState(0);
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ name, part_no: partNo, category, supplier, unit_cost: unitCost || null, sell_price: sellPrice || null, stock, par, location });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Add Part" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Name"><input required value={name} onChange={e => setName(e.target.value)} /></FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldGroup label="Part No."><input value={partNo} onChange={e => setPartNo(e.target.value)} /></FieldGroup>
            <FieldGroup label="Category"><input value={category} onChange={e => setCategory(e.target.value)} /></FieldGroup>
            <FieldGroup label="Unit Cost"><input type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} /></FieldGroup>
            <FieldGroup label="Sell Price"><input type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} /></FieldGroup>
            <FieldGroup label="Stock"><input type="number" value={stock} onChange={e => setStock(parseInt(e.target.value))} /></FieldGroup>
            <FieldGroup label="PAR Level"><input type="number" value={par} onChange={e => setPar(parseInt(e.target.value))} /></FieldGroup>
          </div>
          <FieldGroup label="Supplier"><input value={supplier} onChange={e => setSupplier(e.target.value)} /></FieldGroup>
          <FieldGroup label="Location"><input value={location} onChange={e => setLocation(e.target.value)} /></FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Add Part" />
      </form>
    </Modal>
  );
}

function AddToolModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [serial, setSerial] = useState('');
  const [location, setLocation] = useState('');
  const [calibrationDue, setCalibrationDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ name, category, serial, location, calibration_due: calibrationDue || null });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Add Tool" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Name"><input required value={name} onChange={e => setName(e.target.value)} /></FieldGroup>
          <FieldGroup label="Category"><input value={category} onChange={e => setCategory(e.target.value)} /></FieldGroup>
          <FieldGroup label="Serial No."><input value={serial} onChange={e => setSerial(e.target.value)} /></FieldGroup>
          <FieldGroup label="Location"><input value={location} onChange={e => setLocation(e.target.value)} /></FieldGroup>
          <FieldGroup label="Calibration Due"><input type="date" value={calibrationDue} onChange={e => setCalibrationDue(e.target.value)} /></FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Add Tool" />
      </form>
    </Modal>
  );
}

function AddContractorModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [workingOn, setWorkingOn] = useState('');
  const [accessStart, setAccessStart] = useState('');
  const [accessEnd, setAccessEnd] = useState('');
  const [vesselOwner, setVesselOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ name, trade, working_on: workingOn, access_start: accessStart, access_end: accessEnd || null, vessel_owner: vesselOwner });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Add Contractor" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Company / Name"><input required value={name} onChange={e => setName(e.target.value)} /></FieldGroup>
          <FieldGroup label="Trade"><input value={trade} onChange={e => setTrade(e.target.value)} placeholder="e.g. Electrical" /></FieldGroup>
          <FieldGroup label="Working On (vessel)"><input value={workingOn} onChange={e => setWorkingOn(e.target.value)} /></FieldGroup>
          <FieldGroup label="Vessel Owner"><input value={vesselOwner} onChange={e => setVesselOwner(e.target.value)} /></FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldGroup label="Access From"><input type="date" required value={accessStart} onChange={e => setAccessStart(e.target.value)} /></FieldGroup>
            <FieldGroup label="Access Until"><input type="date" value={accessEnd} onChange={e => setAccessEnd(e.target.value)} /></FieldGroup>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Add" />
      </form>
    </Modal>
  );
}

function AssignVesselModal({ slot, vessels, onClose, onAssign }) {
  const [vesselId, setVesselId] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onAssign(slot.id, { vessel: vesselId || null });
    onClose();
  }

  return (
    <Modal title={`Assign Vessel — ${slot.lane} ${slot.col} T${slot.tier}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Vessel">
            <select value={vesselId} onChange={e => setVesselId(e.target.value)}>
              <option value="">— clear slot —</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </FieldGroup>
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Assign" />
      </form>
    </Modal>
  );
}

// ── Status badge helpers ───────────────────────────────────────────────────────

const HAUL_STATUS = { scheduled: 'badge-blue', in_progress: 'badge-teal', completed: 'badge-green', cancelled: 'badge-red' };
const WO_STATUS   = { pending_auth: 'badge-gold', authorised: 'badge-blue', in_progress: 'badge-teal', completed: 'badge-green' };
const LQ_STATUS   = { pending: 'badge-gray', scheduled: 'badge-blue', launching: 'badge-teal', retrieved: 'badge-green' };
const ASSET_ST    = { ok: 'badge-green', due_service: 'badge-orange', under_repair: 'badge-red' };
const TOOL_ST     = { available: 'badge-green', checked_out: 'badge-blue', service_due: 'badge-orange' };

// ── Main component ─────────────────────────────────────────────────────────────

export default function Boatyard() {
  const { marina, updateMarina } = useMarina();
  const { haulOuts, loading: haulLoading, createHaulOut, updateHaulOut } = useHaulOuts();
  const { slots, loading: slotsLoading, createSlot, updateSlot } = useStorageSlots();
  const { requests, loading: reqLoading, createRequest, updateRequest } = useLaunchRequests();
  const { workOrders, loading: woLoading, createWorkOrder, updateWorkOrder } = useWorkOrders();
  const { parts, loading: partsLoading, createPart } = useParts();
  const { tools, loading: toolsLoading, createTool, updateTool } = useTools();
  const { contractors, loading: contractorsLoading, createContractor, deleteContractor } = useContractors();
  const { assets, loading: assetsLoading } = useAssets();
  const { vessels } = useVessels();

  const [tab, setTab] = useState('schedule');
  const weatherHold = marina?.operations_paused ?? false;

  const [showScheduleLift, setShowScheduleLift] = useState(false);
  const [showNewWO, setShowNewWO] = useState(false);
  const [showAddPart, setShowAddPart] = useState(false);
  const [showAddTool, setShowAddTool] = useState(false);
  const [showAddContractor, setShowAddContractor] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  function isBlocked(slot) {
    if (slot.tier <= 1) return false;
    const below = slots.find(s => s.lane === slot.lane && s.col === slot.col && s.tier === slot.tier - 1);
    return below ? !!below.vessel : false;
  }

  const laneGroups = slots.reduce((acc, s) => {
    if (!acc[s.lane]) acc[s.lane] = [];
    acc[s.lane].push(s);
    return acc;
  }, {});

  const priMap = { low: 'badge-gray', normal: 'badge-gray', high: 'badge-orange', urgent: 'badge-red' };

  return (
    <div>
      {showScheduleLift && <ScheduleLiftModal vessels={vessels} onClose={() => setShowScheduleLift(false)} onCreate={createHaulOut} />}
      {showNewWO && <NewWorkOrderModal vessels={vessels} onClose={() => setShowNewWO(false)} onCreate={createWorkOrder} />}
      {showAddPart && <AddPartModal onClose={() => setShowAddPart(false)} onCreate={createPart} />}
      {showAddTool && <AddToolModal onClose={() => setShowAddTool(false)} onCreate={createTool} />}
      {showAddContractor && <AddContractorModal onClose={() => setShowAddContractor(false)} onCreate={createContractor} />}
      {selectedSlot && <AssignVesselModal slot={selectedSlot} vessels={vessels} onClose={() => setSelectedSlot(null)} onAssign={updateSlot} />}

      <div className="tabs">
        {[
          ['schedule','Haul-out Schedule'],['launch','Launch Queue'],['storage','Dry Storage Map'],
          ['workorders','Work Orders'],['parts','Parts & Inventory'],['tools','Tools'],
          ['contractors','Contractors'],['facility','Facility Log'],
        ].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'schedule' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Upcoming Haul-outs &amp; Splashes</div>
            <button className="btn btn-primary" onClick={() => setShowScheduleLift(true)}><Ic n="plus" s={12} />Schedule Lift</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Vessel</th><th>Type</th><th>Date / Time</th><th>Equipment</th><th>Crew</th><th>Status</th></tr></thead>
              <tbody>
                {haulLoading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : haulOuts.map(h => (
                  <tr key={h.id}>
                    <td className="tbl-name">{h.vessel_name}</td>
                    <td><span className={`badge ${h.haul_type === 'haul_out' ? 'badge-blue' : 'badge-green'}`}>{h.haul_type === 'haul_out' ? 'Haul-out' : 'Splash'}</span></td>
                    <td><div style={{ fontSize: 12, fontWeight: 500 }}>{h.scheduled_at ? new Date(h.scheduled_at).toLocaleDateString() : '—'}</div><div className="tbl-sub">{h.scheduled_at ? new Date(h.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div></td>
                    <td style={{ fontSize: 12 }}>{h.equipment || '—'}</td>
                    <td style={{ fontSize: 12 }}>{h.crew}</td>
                    <td><span className={`badge ${HAUL_STATUS[h.status] || 'badge-gray'}`}>{h.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'launch' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Dry Stack Launch Queue — Today</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                [requests.length, 'Queued', 'badge-gray'],
                [requests.filter(r => r.status === 'launching').length, 'Launching', 'badge-teal'],
                [requests.filter(r => r.status === 'retrieved').length, 'Retrieved', 'badge-green'],
              ].map(([c, l, b]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--white)', border: 'var(--border)', borderRadius: 7, padding: '6px 12px' }}>
                  <span className={`badge ${b}`}>{c}</span>
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{l}</span>
                </div>
              ))}
              <button
                className={`btn ${weatherHold ? 'btn-gold' : 'btn-ghost'} btn-sm`}
                onClick={() => updateMarina({ operations_paused: !weatherHold })}
              >
                <Ic n="bolt" s={11} />{weatherHold ? 'Hold Active' : 'Weather Hold'}
              </button>
            </div>
          </div>
          {weatherHold && (
            <div className="weather-hold-banner">
              <Ic n="bolt" s={13} />Weather Hold Active — all pending launches paused
            </div>
          )}
          {reqLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {requests.map((r, idx) => (
                <div key={r.id} className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                      <div className="lq-num">{idx + 1}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{r.vessel_name}</div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 6 }}>
                          <span>Slot: <b style={{ color: 'rgba(0,0,0,0.7)' }}>{r.slot_label || '—'}</b></span>
                          <span>Equipment: <b style={{ color: 'rgba(0,0,0,0.7)' }}>{r.equipment || '—'}</b></span>
                          <span>Assigned: <b style={{ color: r.assigned_to ? 'rgba(0,0,0,0.7)' : 'var(--orange)' }}>{r.assigned_to || 'Unassigned'}</b></span>
                        </div>
                      </div>
                    </div>
                    <span className={`badge ${LQ_STATUS[r.status] || 'badge-gray'}`}>{r.status}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    {r.status === 'pending'   && <button className="btn btn-primary btn-sm" disabled={weatherHold} onClick={() => updateRequest(r.id, { status: 'scheduled' })}>Assign &amp; Schedule</button>}
                    {r.status === 'scheduled' && <button className="btn btn-primary btn-sm" onClick={() => updateRequest(r.id, { status: 'launching' })}>Mark Launching</button>}
                    {r.status === 'launching' && <button className="btn btn-primary btn-sm" onClick={() => updateRequest(r.id, { status: 'retrieved' })}>Mark Retrieved</button>}
                  </div>
                </div>
              ))}
              {requests.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No launch requests today.</div>}
            </div>
          )}
        </div>
      )}

      {tab === 'storage' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Dry Storage — Land Yard</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {[['Occupied','#dbeeff'],['Available','#f0f0ee'],['Blocked','#fff5e0']].map(([l,c]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid rgba(0,0,0,0.1)' }} />{l}
                </div>
              ))}
            </div>
          </div>
          {slotsLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div className="card" style={{ padding: 20 }}>
              <div className="storage-grid">
                {Object.entries(laneGroups).map(([lane, laneSlots]) => (
                  <div key={lane} className="storage-row">
                    <div className="storage-lane">{lane}</div>
                    {laneSlots.map(slot => {
                      const blocked = isBlocked(slot);
                      const occupied = !!slot.vessel;
                      const st = occupied ? 'occupied' : blocked ? 'blocked' : 'available';
                      return (
                        <div
                          key={slot.id}
                          className={`storage-slot ${st}`}
                          style={{ width: 80, height: 52, padding: '4px', cursor: blocked ? 'not-allowed' : 'pointer' }}
                          onClick={() => !blocked && setSelectedSlot(slot)}
                        >
                          <div className="slot-id">{slot.col}{slot.tier}</div>
                          {occupied && <div className="slot-boat">{slot.vessel_name}</div>}
                          {blocked && <div className="slot-boat" style={{ color: 'rgba(0,0,0,0.3)' }}>blocked</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {slots.length === 0 && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No storage slots configured. Add slots via the admin panel or API.</div>}
            </div>
          )}
        </div>
      )}

      {tab === 'workorders' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Work Orders</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-orange">{workOrders.filter(w => w.status === 'pending_auth').length} Pending Auth</span>
              <span className="badge badge-blue">{workOrders.filter(w => w.status === 'in_progress').length} In Progress</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNewWO(true)}><Ic n="plus" s={11} />New Work Order</button>
            </div>
          </div>
          {woLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {workOrders.map(wo => (
                <div key={wo.id} className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)' }}>WO-{wo.id}</span>
                        <span className={`badge ${priMap[wo.priority] || 'badge-gray'}`}>{wo.priority}</span>
                        <span className={`badge ${WO_STATUS[wo.status] || 'badge-gray'}`}>{wo.status.replace('_', ' ')}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{wo.title}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{wo.vessel_name || '—'} · {wo.category || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', fontWeight: 600, textTransform: 'uppercase' }}>Est / Actual</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{wo.estimate ?? '—'} / {wo.actual ?? '—'}</div>
                    </div>
                  </div>
                  {wo.description && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', lineHeight: 1.65, background: 'var(--bg)', borderRadius: 6, padding: '9px 12px', marginBottom: 12 }}>{wo.description}</div>}
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 12 }}>
                    <span>Assigned: <b style={{ color: 'rgba(0,0,0,0.7)' }}>{wo.assigned_to || '—'}</b></span>
                    <span>Due: <b style={{ color: 'rgba(0,0,0,0.7)' }}>{wo.due || '—'}</b></span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {wo.status === 'pending_auth' && <button className="btn btn-primary btn-sm" onClick={() => updateWorkOrder(wo.id, { status: 'authorised' })}>Authorise</button>}
                    {wo.status === 'authorised'   && <button className="btn btn-primary btn-sm" onClick={() => updateWorkOrder(wo.id, { status: 'in_progress' })}>Start Work</button>}
                    {wo.status === 'in_progress'  && <button className="btn btn-primary btn-sm" onClick={() => updateWorkOrder(wo.id, { status: 'completed' })}>Mark Complete</button>}
                  </div>
                </div>
              ))}
              {workOrders.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No work orders.</div>}
            </div>
          )}
        </div>
      )}

      {tab === 'parts' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Parts &amp; Inventory</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-red">{parts.filter(p => p.stock < p.par).length} Below PAR</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddPart(true)}><Ic n="plus" s={11} />Add Part</button>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Part</th><th>Part No.</th><th>Category</th><th>Supplier</th><th>Unit Cost</th><th>Sell</th><th>Stock</th><th>PAR</th><th>Location</th></tr></thead>
              <tbody>
                {partsLoading ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : parts.map(p => {
                  const low = p.stock < p.par;
                  return (
                    <tr key={p.id}>
                      <td className="tbl-name">{p.name}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontFamily: 'monospace' }}>{p.part_no || '—'}</td>
                      <td><span className="badge badge-navy">{p.category || '—'}</span></td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{p.supplier || '—'}</td>
                      <td style={{ fontSize: 12 }}>{p.unit_cost ?? '—'}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{p.sell_price ?? '—'}</td>
                      <td style={{ fontWeight: 700, color: low ? 'var(--red)' : 'var(--green)', fontSize: 13 }}>{p.stock}</td>
                      <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{p.par}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{p.location || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tools' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Tool Register</div>
              {[
                [tools.filter(t => t.status === 'available').length,   'Available',   'badge-green'],
                [tools.filter(t => t.status === 'checked_out').length, 'Checked Out', 'badge-blue'],
                [tools.filter(t => t.status === 'service_due').length, 'Service Due', 'badge-orange'],
              ].map(([c, l, b]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--white)', border: 'var(--border)', borderRadius: 7, padding: '5px 11px' }}>
                  <span className={`badge ${b}`}>{c}</span>
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{l}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddTool(true)}><Ic n="plus" s={11} />Add Tool</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Tool</th><th>Category</th><th>Serial</th><th>Location</th><th>Status</th><th>Checked Out To</th><th>Calib. Due</th><th></th></tr></thead>
              <tbody>
                {toolsLoading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : tools.map(t => (
                  <tr key={t.id}>
                    <td className="tbl-name">{t.name}</td>
                    <td><span className="badge badge-navy">{t.category || '—'}</span></td>
                    <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(0,0,0,0.45)' }}>{t.serial || '—'}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{t.location || '—'}</td>
                    <td><span className={`badge ${TOOL_ST[t.status] || 'badge-gray'}`}>{t.status.replace('_', ' ')}</span></td>
                    <td style={{ fontSize: 12 }}>{t.checked_out_to || '—'}</td>
                    <td style={{ fontSize: 12, color: t.calibration_due ? 'var(--orange)' : 'rgba(0,0,0,0.3)' }}>{t.calibration_due || '—'}</td>
                    <td>
                      {t.status === 'available' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          const who = prompt('Check out to:');
                          if (who) updateTool(t.id, { status: 'checked_out', checked_out_to: who });
                        }}>Check Out</button>
                      )}
                      {t.status === 'checked_out' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => updateTool(t.id, { status: 'available', checked_out_to: '' })}>Return</button>
                      )}
                      {t.status === 'service_due' && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--orange)' }} onClick={() => {
                          const d = prompt('Next calibration date (YYYY-MM-DD):');
                          if (d) updateTool(t.id, { status: 'available', calibration_due: d });
                        }}>Log Service</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'contractors' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <div className="card-header-title">Contractors On-Site</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddContractor(true)}><Ic n="plus" s={11} />Add</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Contractor</th><th>Trade</th><th>Working On</th><th>Access Period</th><th>Vessel Owner</th><th></th></tr></thead>
            <tbody>
              {contractorsLoading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
              ) : contractors.map(c => (
                <tr key={c.id}>
                  <td className="tbl-name">{c.name}</td>
                  <td><span className="badge badge-teal">{c.trade || '—'}</span></td>
                  <td style={{ fontWeight: 500 }}>{c.working_on || '—'}</td>
                  <td style={{ fontSize: 12 }}>{c.access_start}{c.access_end ? ` – ${c.access_end}` : ''}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{c.vessel_owner || '—'}</td>
                  <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteContractor(c.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'facility' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <div className="card-header-title">Facility Maintenance Log</div>
          </div>
          <table className="tbl">
            <thead><tr><th>Item</th><th>Category</th><th>Location</th><th>Last Service</th><th>Next Due</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {assetsLoading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
              ) : assets.map(a => (
                <tr key={a.id}>
                  <td><div className="tbl-name">{a.name}</div><div className="tbl-sub">{a.serial}</div></td>
                  <td><span className="badge badge-navy">{a.category || '—'}</span></td>
                  <td style={{ fontSize: 12 }}>{a.location || '—'}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{a.last_service || '—'}</td>
                  <td style={{ fontSize: 12, fontWeight: 600, color: a.status === 'under_repair' ? 'var(--red)' : a.status === 'due_service' ? 'var(--orange)' : 'rgba(0,0,0,0.6)' }}>{a.next_service || '—'}</td>
                  <td><span className={`badge ${ASSET_ST[a.status] || 'badge-gray'}`}>{a.status?.replace('_', ' ') || '—'}</span></td>
                  <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{a.notes || '—'}</td>
                </tr>
              ))}
              {assets.length === 0 && !assetsLoading && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No assets — add them in the Maintenance module.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
