import { useState } from 'react';
import useVessels from '../hooks/useVessels.js';
import useMembers from '../hooks/useMembers.js';
import Ic from '../components/ui/Icon.jsx';

function NewVesselModal({ onClose, onCreate }) {
  const { members } = useMembers();
  const [name, setName] = useState('');
  const [vesselType, setVesselType] = useState('motor');
  const [loa, setLoa] = useState('');
  const [flag, setFlag] = useState('');
  const [reg, setReg] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await onCreate({ name, vessel_type: vesselType, loa: loa ? Number(loa) : null, flag, reg, owner: owner || null });
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 480, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Add Vessel</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="Vessel name" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</label>
              <select value={vesselType} onChange={e => setVesselType(e.target.value)}>
                <option value="motor">Motor</option>
                <option value="sail">Sail</option>
                <option value="catamaran">Catamaran</option>
                <option value="superyacht">Superyacht</option>
                <option value="commercial">Commercial</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>LOA (m)</label>
              <input type="number" step="0.1" min="0" value={loa} onChange={e => setLoa(e.target.value)} placeholder="e.g. 12.5" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Flag</label>
              <input value={flag} onChange={e => setFlag(e.target.value)} placeholder="e.g. IRL" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Registration</label>
              <input value={reg} onChange={e => setReg(e.target.value)} placeholder="Registration number" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Owner</label>
              <select value={owner} onChange={e => setOwner(e.target.value)}>
                <option value="">— No owner —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Vessel'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function insColor(status) {
  if (status === 'expired') return 'var(--red)';
  if (status === 'due-soon') return 'var(--orange)';
  return 'var(--green)';
}

function safetyStatus(dateStr) {
  if (!dateStr || dateStr === '—') return 'unknown';
  const d = new Date(dateStr);
  if (isNaN(d)) return 'unknown';
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'expired';
  if (diff < 60) return 'due-soon';
  return 'valid';
}

function fmt(v) {
  const ins = v.insurance ?? {};
  const saf = v.safety ?? {};
  return {
    ...v,
    type:       v.vessel_type   ?? v.type        ?? '—',
    airDraft:   v.air_draft     ?? v.airDraft     ?? '—',
    yearBuilt:  v.year_built    ?? v.yearBuilt    ?? '—',
    tankCap:    v.tank_cap      ?? v.tankCap      ?? '—',
    fwTank:     v.fw_tank       ?? v.fwTank       ?? '—',
    shorePower: v.shore_power   ?? v.shorePower   ?? '—',
    mooringPref:v.mooring_pref  ?? v.mooringPref  ?? '—',
    aisActive:  v.ais_active    ?? v.aisActive    ?? false,
    callsign:   v.call_sign     ?? v.callsign     ?? '—',
    berth:      v.berth_code    ?? v.berth        ?? '—',
    owner:      v.owner_name    ?? v.owner        ?? '—',
    insurance: {
      insurer: ins.insurer  ?? '—',
      policy:  ins.policy_no ?? ins.policy ?? '—',
      expiry:  ins.expires   ?? ins.expiry  ?? '—',
      // DB stores 'due_soon'; frontend helpers expect 'due-soon'
      status:  ins.status === 'due_soon' ? 'due-soon' : (ins.status ?? 'valid'),
    },
    safety: {
      flares:       saf.flares_exp        ?? saf.flares        ?? '—',
      lifeRaft:     saf.life_raft_exp     ?? saf.lifeRaft      ?? '—',
      epirb:        saf.epirb_exp         ?? saf.epirb         ?? '—',
      extinguisher: saf.extinguisher_exp  ?? saf.extinguisher  ?? '—',
    },
  };
}

export default function Vessels() {
  const [tab, setTab] = useState('registry');
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { vessels: raw, loading, createVessel } = useVessels();
  const vessels = raw.map(fmt);

  const filtered = vessels.filter(v =>
    v.name.toLowerCase().includes(q.toLowerCase()) ||
    v.owner.toLowerCase().includes(q.toLowerCase()) ||
    v.type.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <div className="tabs">
        {[['registry','Vessel Registry'],['insurance','Insurance Tracker'],['safety','Safety Equipment']].map(([v,l]) => (
          <div key={v} className={`tab${tab===v?' active':''}`} onClick={() => { setTab(v); setSel(null); }}>{l}</div>
        ))}
      </div>

      {tab === 'registry' && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className="search"><Ic n="search" s={13}/><input placeholder="Search vessel, owner, type…" value={q} onChange={e => setQ(e.target.value)} /></div>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Ic n="plus" s={12}/>Add Vessel</button>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Vessel</th><th>Type</th><th>LOA</th><th>Flag</th><th>Owner</th><th>Berth</th><th>AIS</th><th>Insurance</th></tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No vessels found.</td></tr>
                  ) : filtered.map(v => (
                    <tr key={v.id} style={{ cursor: 'pointer', background: sel?.id===v.id?'#f5f8ff':'' }} onClick={() => setSel(v)}>
                      <td><div className="tbl-name">{v.name}</div><div className="tbl-sub">{v.reg}</div></td>
                      <td><span className="badge badge-navy">{v.type}</span></td>
                      <td style={{ fontSize: 12 }}>{v.loa}</td>
                      <td style={{ fontSize: 12 }}>{v.flag}</td>
                      <td><div style={{ fontSize: 12, fontWeight: 500 }}>{v.owner}</div></td>
                      <td style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 12 }}>{v.berth}</td>
                      <td>{v.aisActive ? <span className="ais-live">AIS</span> : <span className="ais-off">Off</span>}</td>
                      <td><span style={{ fontSize: 11, fontWeight: 600, color: insColor(v.insurance.status) }}>{v.insurance.status === 'expired' ? '✗ Expired' : v.insurance.status === 'due-soon' ? '⚠ Soon' : '✓ Valid'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {sel && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <div className="detail-title">{sel.name}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12}/></button>
              </div>
              <div className="detail-sub">{sel.type} · {sel.flag} · {sel.reg}</div>
              {sel.aisActive ? <span className="ais-live">AIS Live</span> : <span className="ais-off">AIS Off</span>}

              <div style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Specifications</div>
              <div className="vessel-spec-grid">
                {[['LOA',sel.loa],['Beam',sel.beam],['Draft',sel.draft],['Air Draft',sel.airDraft],['Built',sel.yearBuilt],['Builder',sel.builder],['Model',sel.model],['Engine',sel.engine],['Fuel',sel.fuel],['Tank Cap',sel.tankCap],['Shore Power',sel.shorePower],['FW Tank',sel.fwTank]].map(([k,v]) => (
                  <div key={k} className="vessel-spec-row"><div className="vsk">{k}</div><div className="vsv">{v}</div></div>
                ))}
              </div>

              <div style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Insurance</div>
              {[['Insurer',sel.insurance.insurer],['Policy',sel.insurance.policy],['Expiry',sel.insurance.expiry]].map(([k,v]) => (
                <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val" style={{ color: k==='Expiry' ? insColor(sel.insurance.status) : undefined }}>{v}</div></div>
              ))}

              <div style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Contact</div>
              <div className="detail-row"><div className="detail-key">Owner</div><div className="detail-val">{sel.owner}</div></div>
              <div className="detail-row"><div className="detail-key">MMSI</div><div className="detail-val">{sel.mmsi || '—'}</div></div>
              <div className="detail-row"><div className="detail-key">Call Sign</div><div className="detail-val">{sel.callsign || '—'}</div></div>
              <div className="detail-row"><div className="detail-key">Mooring Pref.</div><div className="detail-val">{sel.mooringPref}</div></div>

              <div className="detail-actions">
                <button className="btn btn-primary" style={{ justifyContent: 'center' }}>View Booking History</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Edit Vessel Record</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Upload Document</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'insurance' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Insurance Status — All Vessels</div>
            <button className="btn btn-ghost btn-sm">Export</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Vessel</th><th>Owner</th><th>Insurer</th><th>Policy No.</th><th>Expiry</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : vessels.map(v => (
                  <tr key={v.id}>
                    <td><div className="tbl-name">{v.name}</div><div className="tbl-sub">{v.type}</div></td>
                    <td style={{ fontSize: 12 }}>{v.owner}</td>
                    <td style={{ fontSize: 12 }}>{v.insurance.insurer}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{v.insurance.policy}</td>
                    <td style={{ fontSize: 12, fontWeight: 600, color: insColor(v.insurance.status) }}>{v.insurance.expiry}</td>
                    <td>
                      <span className={`badge ${v.insurance.status==='expired'?'badge-red':v.insurance.status==='due-soon'?'badge-orange':'badge-green'}`}>
                        {v.insurance.status === 'expired' ? 'Expired' : v.insurance.status === 'due-soon' ? 'Due Soon' : 'Valid'}
                      </span>
                    </td>
                    <td>
                      {v.insurance.status !== 'valid'
                        ? <button className="btn btn-ghost btn-sm" style={{ color: 'var(--orange)' }}>Request Doc</button>
                        : <button className="btn btn-ghost btn-sm">View</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'safety' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Safety Equipment Expiry Register</div>
            <button className="btn btn-ghost btn-sm">Export</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Vessel</th><th>Owner</th><th>Flares</th><th>Life Raft Service</th><th>EPIRB Battery</th><th>Fire Extinguisher</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : vessels.map(v => {
                  const sf = v.safety;
                  const cell = (d) => {
                    const st = safetyStatus(d);
                    return <span className={st==='expired'?'cert-expired':st==='due-soon'?'cert-due-soon':'cert-valid'}>{st==='expired'?'✗ ':st==='due-soon'?'⚠ ':'✓ '}{d || '—'}</span>;
                  };
                  return (
                    <tr key={v.id}>
                      <td className="tbl-name">{v.name}</td>
                      <td style={{ fontSize: 12 }}>{v.owner}</td>
                      <td>{cell(sf.flares)}</td>
                      <td>{cell(sf.lifeRaft)}</td>
                      <td>{cell(sf.epirb)}</td>
                      <td>{cell(sf.extinguisher)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && (
        <NewVesselModal
          onClose={() => setShowAdd(false)}
          onCreate={async (payload) => { await createVessel(payload); setShowAdd(false); }}
        />
      )}
    </div>
  );
}
