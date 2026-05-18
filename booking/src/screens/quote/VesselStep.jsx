import InsuranceUpload from '../../components/InsuranceUpload';

const COUNTRIES = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO',
  'CH','GB','US','CA','AU','NZ','TR','MC','ME','RS',
];

function boatComplete(boat, marina) {
  if (!boat.vesselName || !boat.loa || !boat.vesselRegistration || !boat.vesselFlag) return false;
  if (!boat.crewCount || Number(boat.crewCount) < 1) return false;
  if (marina?.requires_air_draft && !boat.airDraft) return false;
  if (marina?.requires_insurance_at_booking) {
    if (!boat.insurance && !boat.shareInsuranceFromBoat0) return false;
  }
  return true;
}

export default function VesselStep({ state, updateBoat, addBoat, removeBoat, marina, onNext, onBack }) {
  const canContinue = state.boats.every(b => boatComplete(b, marina));

  return (
    <form
      className="q-step"
      onSubmit={e => { e.preventDefault(); if (canContinue) onNext(); }}
    >
      {state.boats.map((boat, idx) => (
        <div key={idx} className="q-boat-card">
          <div className="q-boat-header">
            <h3>{state.boats.length > 1 ? `Boat ${idx + 1}` : 'Vessel'}</h3>
            {state.boats.length > 1 && (
              <button type="button" className="q-link-danger" onClick={() => removeBoat(idx)}>Remove</button>
            )}
          </div>

          <div className="p-field">
            <label className="p-label">Vessel name *</label>
            <input className="p-input" required value={boat.vesselName || ''}
              onChange={e => updateBoat(idx, 'vesselName', e.target.value)} />
          </div>

          <div className="p-grid-3">
            <div className="p-field">
              <label className="p-label">LOA (m) *</label>
              <input className="p-input" type="number" step="0.1" min="1" required
                value={boat.loa} onChange={e => updateBoat(idx, 'loa', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Beam (m)</label>
              <input className="p-input" type="number" step="0.1" min="0"
                value={boat.beam || ''} onChange={e => updateBoat(idx, 'beam', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Draft (m)</label>
              <input className="p-input" type="number" step="0.1" min="0"
                value={boat.draft || ''} onChange={e => updateBoat(idx, 'draft', e.target.value)} />
            </div>
          </div>

          <div className="p-grid-3">
            <div className="p-field">
              <label className="p-label">
                Air draft (m){marina?.requires_air_draft ? ' *' : ''}
              </label>
              <input className="p-input" type="number" step="0.1" min="0"
                required={!!marina?.requires_air_draft}
                value={boat.airDraft || ''} onChange={e => updateBoat(idx, 'airDraft', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Registration # *</label>
              <input className="p-input" required value={boat.vesselRegistration || ''}
                onChange={e => updateBoat(idx, 'vesselRegistration', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Flag *</label>
              <select className="p-input" required value={boat.vesselFlag || ''}
                onChange={e => updateBoat(idx, 'vesselFlag', e.target.value)}>
                <option value="">—</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="p-field" style={{ maxWidth: 200 }}>
            <label className="p-label">Crew aboard *</label>
            <input className="p-input" type="number" min="1" required
              value={boat.crewCount || ''} onChange={e => updateBoat(idx, 'crewCount', e.target.value)} />
          </div>

          {idx === 0 ? (
            <InsuranceUpload
              marinaSlug={marina?.slug}
              value={boat.insurance}
              onChange={v => updateBoat(idx, 'insurance', v)}
            />
          ) : (
            <div className="p-field">
              <label className="p-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={!!boat.shareInsuranceFromBoat0}
                  onChange={e => updateBoat(idx, 'shareInsuranceFromBoat0', e.target.checked)}
                />
                Use insurance from Boat 1
              </label>
              {!boat.shareInsuranceFromBoat0 && (
                <InsuranceUpload
                  marinaSlug={marina?.slug}
                  value={boat.insurance}
                  onChange={v => updateBoat(idx, 'insurance', v)}
                />
              )}
            </div>
          )}
        </div>
      ))}

      <button type="button" className="q-link-add" onClick={addBoat}>+ Add another boat</button>

      <div className="q-step-footer">
        <button type="button" className="p-btn-outline" onClick={onBack}>← Back</button>
        <button type="submit" className="p-btn-gold" disabled={!canContinue}>Continue →</button>
      </div>
    </form>
  );
}
