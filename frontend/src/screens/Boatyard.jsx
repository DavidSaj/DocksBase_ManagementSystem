import { useState, useEffect } from 'react';
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
import api from '../api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

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

// ── Generic data hook ────────────────────────────────────────────────────────

function useApiList(endpoint) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(endpoint);
      setItems(Array.isArray(data) ? data : (data.results ?? []));
    } catch { /* silent */ } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [endpoint]);

  async function createItem(payload) {
    const { data } = await api.post(endpoint, payload);
    setItems(prev => [data, ...prev]);
    return data;
  }

  async function updateItem(id, payload) {
    const { data } = await api.patch(`${endpoint}${id}/`, payload);
    setItems(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }

  async function deleteItem(id) {
    await api.delete(`${endpoint}${id}/`);
    setItems(prev => prev.filter(i => i.id !== id));
  }

  return { items, loading, reload: load, createItem, updateItem, deleteItem };
}

// ── Service Bay Modal ─────────────────────────────────────────────────────────

function ServiceBayModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [bayType, setBayType] = useState('general');
  const [capacity, setCapacity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ name, bay_type: bayType, capacity: capacity || null, notes });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Add Service Bay" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Bay Name"><input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bay 1 — Engine" /></FieldGroup>
          <FieldGroup label="Type">
            <select value={bayType} onChange={e => setBayType(e.target.value)}>
              <option value="general">General</option>
              <option value="electrical">Electrical</option>
              <option value="mechanical">Mechanical</option>
              <option value="paint">Paint / Spray</option>
              <option value="welding">Welding</option>
              <option value="rigging">Rigging</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Capacity (LOA m)"><input type="number" step="0.1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Max vessel length" /></FieldGroup>
          <FieldGroup label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'vertical' }} /></FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Add Bay" />
      </form>
    </Modal>
  );
}

// ── Lift Operation Modal ──────────────────────────────────────────────────────

function LiftOperationModal({ vessels, onClose, onCreate }) {
  const [vesselId, setVesselId] = useState('');
  const [liftType, setLiftType] = useState('haul_out');
  const [scheduledAt, setScheduledAt] = useState('');
  const [equipment, setEquipment] = useState('');
  const [operator, setOperator] = useState('');
  const [boatWeight, setBoatWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ vessel: vesselId || null, lift_type: liftType, scheduled_at: scheduledAt, equipment, operator, boat_weight_t: boatWeight || null, notes });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="New Lift Operation" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Vessel">
            <select value={vesselId} onChange={e => setVesselId(e.target.value)}>
              <option value="">— none —</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Lift Type">
            <select value={liftType} onChange={e => setLiftType(e.target.value)}>
              <option value="haul_out">Haul-out</option>
              <option value="splash">Splash / Launch</option>
              <option value="travel_lift">Travel Lift Transfer</option>
              <option value="crane">Crane Lift</option>
            </select>
          </FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldGroup label="Scheduled Date/Time"><input type="datetime-local" required value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></FieldGroup>
            <FieldGroup label="Boat Weight (t)"><input type="number" step="0.1" value={boatWeight} onChange={e => setBoatWeight(e.target.value)} /></FieldGroup>
            <FieldGroup label="Equipment"><input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="e.g. 70T Travelift" /></FieldGroup>
            <FieldGroup label="Operator"><input value={operator} onChange={e => setOperator(e.target.value)} /></FieldGroup>
          </div>
          <FieldGroup label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'vertical' }} /></FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Schedule" />
      </form>
    </Modal>
  );
}

// ── Paint Record Modal ────────────────────────────────────────────────────────

function PaintRecordModal({ vessels, onClose, onCreate }) {
  const [vesselId, setVesselId] = useState('');
  const [paintType, setPaintType] = useState('antifoul');
  const [productName, setProductName] = useState('');
  const [colour, setColour] = useState('');
  const [appliedDate, setAppliedDate] = useState('');
  const [appliedBy, setAppliedBy] = useState('');
  const [coats, setCoats] = useState(2);
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ vessel: vesselId || null, paint_type: paintType, product_name: productName, colour, applied_date: appliedDate, applied_by: appliedBy, coats, area_sqm: area || null, notes });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Add Paint Record" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Vessel">
            <select value={vesselId} onChange={e => setVesselId(e.target.value)}>
              <option value="">— none —</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldGroup label="Paint Type">
              <select value={paintType} onChange={e => setPaintType(e.target.value)}>
                <option value="antifoul">Antifoul</option>
                <option value="topside">Topside</option>
                <option value="primer">Primer</option>
                <option value="gelcoat">Gelcoat</option>
                <option value="varnish">Varnish</option>
                <option value="other">Other</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Product Name"><input value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. International Micron" /></FieldGroup>
            <FieldGroup label="Colour"><input value={colour} onChange={e => setColour(e.target.value)} /></FieldGroup>
            <FieldGroup label="Applied Date"><input type="date" required value={appliedDate} onChange={e => setAppliedDate(e.target.value)} /></FieldGroup>
            <FieldGroup label="Applied By"><input value={appliedBy} onChange={e => setAppliedBy(e.target.value)} /></FieldGroup>
            <FieldGroup label="No. of Coats"><input type="number" min={1} value={coats} onChange={e => setCoats(parseInt(e.target.value))} /></FieldGroup>
            <FieldGroup label="Area (m²)"><input type="number" step="0.1" value={area} onChange={e => setArea(e.target.value)} /></FieldGroup>
          </div>
          <FieldGroup label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'vertical' }} /></FieldGroup>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Save Record" />
      </form>
    </Modal>
  );
}

// ── Warranty Claim Modal ──────────────────────────────────────────────────────

function WarrantyClaimModal({ onClose, onCreate }) {
  const [agreements, setAgreements] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [agreementId, setAgreementId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [claimRef, setClaimRef] = useState('');
  const [notes, setNotes] = useState('');
  const [partsClaimed, setPartsClaimed] = useState('');
  const [labourClaimed, setLabourClaimed] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/warranty-agreements/').then(r => setAgreements(r.data.results ?? r.data)).catch(() => {});
    api.get('/work-orders/').then(r => setWorkOrders(r.data.results ?? r.data)).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({
        agreement: agreementId,
        work_order: workOrderId,
        claim_reference: claimRef,
        notes,
        parts_claimed: partsClaimed || 0,
        labour_claimed: labourClaimed || 0,
      });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="New Warranty Claim" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldGroup label="Warranty Agreement">
            <select required value={agreementId} onChange={e => setAgreementId(e.target.value)}>
              <option value="">Select agreement…</option>
              {agreements.map(a => <option key={a.id} value={a.id}>{a.manufacturer_name}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Work Order">
            <select required value={workOrderId} onChange={e => setWorkOrderId(e.target.value)}>
              <option value="">Select work order…</option>
              {workOrders.map(w => <option key={w.id} value={w.id}>{w.title || `WO-${w.id}`}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Claim Reference"><input value={claimRef} onChange={e => setClaimRef(e.target.value)} placeholder="Manufacturer ref #" /></FieldGroup>
          <FieldGroup label="Notes"><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'vertical' }} /></FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldGroup label="Parts Claimed (€)"><input type="number" step="0.01" value={partsClaimed} onChange={e => setPartsClaimed(e.target.value)} /></FieldGroup>
            <FieldGroup label="Labour Claimed (€)"><input type="number" step="0.01" value={labourClaimed} onChange={e => setLabourClaimed(e.target.value)} /></FieldGroup>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Create Claim" />
      </form>
    </Modal>
  );
}

// ── Subcontractor Modal ───────────────────────────────────────────────────────

function SubcontractorModal({ onClose, onCreate }) {
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [trade, setTrade] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await onCreate({ company, contact_name: contact, email, phone, trade, hourly_rate: hourlyRate || null, insurance_expiry: insuranceExpiry || null });
      onClose();
    } catch (ex) { setErr(ex?.response?.data?.detail ?? 'Save failed'); setSaving(false); }
  }

  return (
    <Modal title="Add Subcontractor" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldGroup label="Company Name"><input required value={company} onChange={e => setCompany(e.target.value)} /></FieldGroup>
            <FieldGroup label="Contact Name"><input value={contact} onChange={e => setContact(e.target.value)} /></FieldGroup>
            <FieldGroup label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></FieldGroup>
            <FieldGroup label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} /></FieldGroup>
            <FieldGroup label="Trade / Speciality"><input value={trade} onChange={e => setTrade(e.target.value)} placeholder="e.g. Marine Electrical" /></FieldGroup>
            <FieldGroup label="Hourly Rate (€)"><input type="number" step="0.01" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} /></FieldGroup>
            <FieldGroup label="Insurance Expiry"><input type="date" value={insuranceExpiry} onChange={e => setInsuranceExpiry(e.target.value)} /></FieldGroup>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
        <FormActions onClose={onClose} saving={saving} saveLabel="Add Subcontractor" />
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

  // ── New tab data hooks ──────────────────────────────────────────────────────
  const { items: serviceBays,      loading: baysLoading,      createItem: createBay,      deleteItem: deleteBay }      = useApiList('/service-bays/');
  const { items: liftOps,          loading: liftOpsLoading,   createItem: createLiftOp,   updateItem: updateLiftOp }   = useApiList('/lift-operations/');
  const { items: paintRecords,     loading: paintLoading,     createItem: createPaintRec, deleteItem: deletePaintRec } = useApiList('/paint-records/');
  const { items: warrantyClaims,   loading: warrantyLoading,  createItem: createClaim,    updateItem: updateClaim }    = useApiList('/warranty-claims/');
  const { items: subcontractors,   loading: subconLoading,    createItem: createSubcon,   deleteItem: deleteSubcon }   = useApiList('/subcontractors/');

  // ── New tab modal visibility ────────────────────────────────────────────────
  const [showAddBay, setShowAddBay]           = useState(false);
  const [showAddLiftOp, setShowAddLiftOp]     = useState(false);
  const [showAddPaintRec, setShowAddPaintRec] = useState(false);
  const [showAddClaim, setShowAddClaim]       = useState(false);
  const [showAddSubcon, setShowAddSubcon]     = useState(false);

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

      {showAddBay     && <ServiceBayModal onClose={() => setShowAddBay(false)} onCreate={createBay} />}
      {showAddLiftOp  && <LiftOperationModal vessels={vessels} onClose={() => setShowAddLiftOp(false)} onCreate={createLiftOp} />}
      {showAddPaintRec && <PaintRecordModal vessels={vessels} onClose={() => setShowAddPaintRec(false)} onCreate={createPaintRec} />}
      {showAddClaim   && <WarrantyClaimModal onClose={() => setShowAddClaim(false)} onCreate={createClaim} />}
      {showAddSubcon  && <SubcontractorModal onClose={() => setShowAddSubcon(false)} onCreate={createSubcon} />}

      <PageHeader
        title="Boatyard"
        subtitle="Haul-out scheduling, dry storage, work orders, parts, and lift operations."
        infoBody={SCREEN_INFO.boatyard}
      />
      <div className="tabs">
        {[
          ['schedule','Haul-out Schedule'],['launch','Launch Queue'],['storage','Dry Storage Map'],
          ['workorders','Work Orders'],['parts','Parts & Inventory'],['tools','Tools'],
          ['contractors','Contractors'],['facility','Facility Log'],
          ['servicebays','Service Bays'],['liftops','Lift Operations'],
          ['paint','Paint Records'],['warranty','Warranty Claims'],
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

      {tab === 'contractors' && (() => {
        const allContractors = [
          ...contractors.map(c => ({ ...c, _type: 'direct', _displayName: c.name })),
          ...subcontractors.map(s => ({ ...s, _type: 'sub', _displayName: s.company || s.name || '—' })),
        ].sort((a, b) => (a._displayName || '').localeCompare(b._displayName || ''));
        const combinedLoading = contractorsLoading || subconLoading;
        return (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <div className="card-header-title">Contractors On-Site</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddSubcon(true)}><Ic n="plus" s={11} />Add Subcontractor</button>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddContractor(true)}><Ic n="plus" s={11} />Add Direct</button>
              </div>
            </div>
            <table className="tbl">
              <thead><tr><th>Contractor</th><th>Type</th><th>Trade</th><th>Working On</th><th>Access Period</th><th>Vessel Owner</th><th></th></tr></thead>
              <tbody>
                {combinedLoading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : allContractors.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No contractors on-site.</td></tr>
                ) : allContractors.map(c => (
                  <tr key={`${c._type}-${c.id}`}>
                    <td className="tbl-name">{c._displayName}</td>
                    <td><span className={`badge ${c._type === 'direct' ? 'badge-blue' : 'badge-teal'}`}>{c._type === 'direct' ? 'Direct' : 'Sub'}</span></td>
                    <td><span className="badge badge-teal">{c.trade || '—'}</span></td>
                    <td style={{ fontWeight: 500 }}>{c.working_on || '—'}</td>
                    <td style={{ fontSize: 12 }}>{c.access_start}{c.access_end ? ` – ${c.access_end}` : ''}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{c.vessel_owner || '—'}</td>
                    <td>
                      {c._type === 'direct'
                        ? <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteContractor(c.id)}>Remove</button>
                        : <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm('Remove this subcontractor?')) deleteSubcon(c.id); }}>Remove</button>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

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

      {/* ── Service Bays ──────────────────────────────────────────────────────── */}
      {tab === 'servicebays' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Service Bays</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddBay(true)}><Ic n="plus" s={11} />Add Bay</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Bay Name</th><th>Type</th><th>Capacity (LOA)</th><th>Status</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {baysLoading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : serviceBays.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No service bays configured.</td></tr>
                ) : serviceBays.map(b => (
                  <tr key={b.id}>
                    <td className="tbl-name">{b.name}</td>
                    <td><span className="badge badge-navy">{b.bay_type?.replace('_', ' ') || '—'}</span></td>
                    <td style={{ fontSize: 12 }}>{b.capacity ? `${b.capacity} m` : '—'}</td>
                    <td><span className={`badge ${b.is_occupied ? 'badge-orange' : 'badge-green'}`}>{b.is_occupied ? 'Occupied' : 'Available'}</span></td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{b.notes || '—'}</td>
                    <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm('Remove this bay?')) deleteBay(b.id); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Lift Operations ───────────────────────────────────────────────────── */}
      {tab === 'liftops' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Lift Operations</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-blue">{liftOps.filter(l => l.status === 'scheduled').length} Scheduled</span>
              <span className="badge badge-teal">{liftOps.filter(l => l.status === 'in_progress').length} In Progress</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddLiftOp(true)}><Ic n="plus" s={11} />New Lift</button>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Vessel</th><th>Type</th><th>Scheduled</th><th>Equipment</th><th>Operator</th><th>Weight (t)</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {liftOpsLoading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : liftOps.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No lift operations recorded.</td></tr>
                ) : liftOps.map(l => (
                  <tr key={l.id}>
                    <td className="tbl-name">{l.vessel_name || '—'}</td>
                    <td><span className="badge badge-blue">{l.lift_type?.replace('_', ' ') || '—'}</span></td>
                    <td style={{ fontSize: 12 }}>{l.scheduled_at ? new Date(l.scheduled_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.equipment || '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.operator || '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.boat_weight_t ?? '—'}</td>
                    <td><span className={`badge ${l.status === 'completed' ? 'badge-green' : l.status === 'in_progress' ? 'badge-teal' : l.status === 'cancelled' ? 'badge-red' : 'badge-gray'}`}>{l.status?.replace('_', ' ') || 'scheduled'}</span></td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {(!l.status || l.status === 'scheduled') && <button className="btn btn-ghost btn-sm" onClick={() => updateLiftOp(l.id, { status: 'in_progress' })}>Start</button>}
                      {l.status === 'in_progress' && <button className="btn btn-ghost btn-sm" onClick={() => updateLiftOp(l.id, { status: 'completed' })}>Complete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Paint Records ─────────────────────────────────────────────────────── */}
      {tab === 'paint' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Paint Records</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddPaintRec(true)}><Ic n="plus" s={11} />Add Record</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Vessel</th><th>Paint Type</th><th>Product</th><th>Colour</th><th>Applied Date</th><th>Applied By</th><th>Coats</th><th>Area (m²)</th><th></th></tr></thead>
              <tbody>
                {paintLoading ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : paintRecords.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No paint records found.</td></tr>
                ) : paintRecords.map(p => (
                  <tr key={p.id}>
                    <td className="tbl-name">{p.vessel_name || '—'}</td>
                    <td><span className="badge badge-navy">{p.paint_type?.replace('_', ' ') || '—'}</span></td>
                    <td style={{ fontSize: 12 }}>{p.product_name || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.colour || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.applied_date || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.applied_by || '—'}</td>
                    <td style={{ fontSize: 12, textAlign: 'center' }}>{p.coats ?? '—'}</td>
                    <td style={{ fontSize: 12, textAlign: 'center' }}>{p.area_sqm ?? '—'}</td>
                    <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm('Delete this paint record?')) deletePaintRec(p.id); }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Warranty Claims ───────────────────────────────────────────────────── */}
      {tab === 'warranty' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Warranty Claims</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-gold">{warrantyClaims.filter(c => c.status === 'submitted' || c.status === 'acknowledged').length} Pending</span>
              <span className="badge badge-green">{warrantyClaims.filter(c => c.status === 'approved' || c.status === 'reimbursed').length} Approved</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddClaim(true)}><Ic n="plus" s={11} />New Claim</button>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Manufacturer</th><th>Parts (€)</th><th>Labour (€)</th><th>Total (€)</th><th>Reimbursed (€)</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {warrantyLoading ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : warrantyClaims.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No warranty claims.</td></tr>
                ) : warrantyClaims.map(c => {
                  const statusBadge = { draft: 'badge-gray', submitted: 'badge-blue', acknowledged: 'badge-teal', approved: 'badge-green', reimbursed: 'badge-green', rejected: 'badge-red', closed: 'badge-gray' };
                  return (
                    <tr key={c.id}>
                      <td style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{c.claim_reference || `CLM-${c.id}`}</td>
                      <td className="tbl-name">{c.manufacturer_name || c.manufacturer || '—'}</td>
                      <td style={{ fontSize: 12 }}>{c.parts_claimed != null ? `€${Number(c.parts_claimed).toFixed(2)}` : '—'}</td>
                      <td style={{ fontSize: 12 }}>{c.labour_claimed != null ? `€${Number(c.labour_claimed).toFixed(2)}` : '—'}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{c.total_claimed != null ? `€${Number(c.total_claimed).toFixed(2)}` : '—'}</td>
                      <td style={{ fontSize: 12, color: c.amount_reimbursed != null ? 'var(--green)' : 'rgba(0,0,0,0.35)' }}>{c.amount_reimbursed != null ? `€${Number(c.amount_reimbursed).toFixed(2)}` : '—'}</td>
                      <td style={{ fontSize: 12 }}>{c.submitted_at ? new Date(c.submitted_at).toLocaleDateString() : c.submitted_date || '—'}</td>
                      <td><span className={`badge ${statusBadge[c.status] || 'badge-gray'}`}>{c.status || 'draft'}</span></td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        {c.status === 'draft' && <button className="btn btn-ghost btn-sm" onClick={() => updateClaim(c.id, { status: 'submitted' })}>Submit</button>}
                        {c.status === 'submitted' && <button className="btn btn-ghost btn-sm" onClick={() => updateClaim(c.id, { status: 'acknowledged' })}>Acknowledge</button>}
                        {c.status === 'acknowledged' && <button className="btn btn-ghost btn-sm" onClick={() => updateClaim(c.id, { status: 'approved' })}>Approve</button>}
                        {c.status === 'approved' && <button className="btn btn-ghost btn-sm" onClick={() => { const amt = prompt('Reimbursement amount (€):'); if (amt) updateClaim(c.id, { status: 'reimbursed', amount_reimbursed: amt }); }}>Mark Reimbursed</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
