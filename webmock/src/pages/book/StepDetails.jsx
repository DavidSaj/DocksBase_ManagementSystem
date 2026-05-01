import { useState } from 'react';

export default function StepDetails({ slip, search, onSubmit, onBack }) {
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;

  const [form, setForm] = useState({
    vesselName: '', flag: '', vesselType: 'Sailing Yacht',
    loa: search?.length || '', beam: '', draft: search?.draft || '',
    skipperName: '', phone: '', email: '', eta: '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div>
      <h2 className="step-title">Your details.</h2>
      <p className="step-sub">Slip {slip?.id} · Pier {slip?.pier} · {nights} night{nights !== 1 ? 's' : ''} · €{(slip?.pricePerNight || 0) * nights} total</p>

      <form className="details-form" onSubmit={handleSubmit}>
        {/* Vessel */}
        <div>
          <div className="form-section-title">Vessel information</div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Vessel name</label>
              <input className="form-input" required value={form.vesselName} onChange={e => set('vesselName', e.target.value)} placeholder="e.g. Ocean Star" />
            </div>
            <div className="form-group">
              <label>Flag (country)</label>
              <input className="form-input" required value={form.flag} onChange={e => set('flag', e.target.value)} placeholder="e.g. GBR" maxLength={3} />
            </div>
          </div>
          <div className="form-grid-3" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Vessel type</label>
              <select className="form-input" value={form.vesselType} onChange={e => set('vesselType', e.target.value)}>
                <option>Sailing Yacht</option>
                <option>Motor Yacht</option>
                <option>Catamaran</option>
                <option>Superyacht</option>
                <option>RIB / Powerboat</option>
                <option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>LOA (m)</label>
              <input type="number" step="0.1" className="form-input" required value={form.loa} onChange={e => set('loa', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Beam (m)</label>
              <input type="number" step="0.1" className="form-input" required value={form.beam} onChange={e => set('beam', e.target.value)} placeholder="e.g. 3.8" />
            </div>
          </div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Draft (m)</label>
              <input type="number" step="0.1" className="form-input" required value={form.draft} onChange={e => set('draft', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Skipper */}
        <div>
          <div className="form-section-title">Skipper information</div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Full name</label>
              <input className="form-input" required value={form.skipperName} onChange={e => set('skipperName', e.target.value)} placeholder="e.g. J. Hammond" />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input type="tel" className="form-input" required value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+44 7700 000000" />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-input" required value={form.email} onChange={e => set('email', e.target.value)} placeholder="skipper@email.com" />
            </div>
            <div className="form-group">
              <label>Estimated arrival time</label>
              <input type="time" className="form-input" required value={form.eta} onChange={e => set('eta', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" onClick={onBack} className="btn-outline">← Back</button>
          <button type="submit" className="btn-gold">Confirm booking →</button>
        </div>
      </form>
    </div>
  );
}
