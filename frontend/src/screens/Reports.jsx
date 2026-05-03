import Ic from '../components/ui/Icon.jsx';
import { useState } from 'react';
import useBerths from '../hooks/useBerths.js';
import usePiers from '../hooks/usePiers.js';
import useInvoices from '../hooks/useInvoices.js';
import useMembers from '../hooks/useMembers.js';
import useAssets from '../hooks/useAssets.js';
import useDefects from '../hooks/useDefects.js';

const MONTHLY_REV = [
  { month: 'Oct', berths: 4200,  fuel: 1800, utils: 620,  other: 340  },
  { month: 'Nov', berths: 2800,  fuel: 1200, utils: 410,  other: 200  },
  { month: 'Dec', berths: 1800,  fuel: 900,  utils: 280,  other: 120  },
  { month: 'Jan', berths: 1400,  fuel: 700,  utils: 210,  other: 90   },
  { month: 'Feb', berths: 2200,  fuel: 950,  utils: 320,  other: 140  },
  { month: 'Mar', berths: 3600,  fuel: 1600, utils: 510,  other: 260  },
  { month: 'Apr', berths: 5800,  fuel: 2100, utils: 780,  other: 420  },
];

const BERTH_UTIL = [
  { berth: 'A1', vessel: 'Ocean Star',  days: 28, util: 93, rev: '€2,240' },
  { berth: 'A2', vessel: 'Seabird III', days: 24, util: 80, rev: '€1,920' },
  { berth: 'A5', vessel: 'Lady K',      days: 18, util: 60, rev: '€1,440' },
  { berth: 'A8', vessel: 'Windseeker',  days: 14, util: 47, rev: '€1,120' },
  { berth: 'B1', vessel: 'Blue Horizon',days: 26, util: 87, rev: '€3,120' },
  { berth: 'B2', vessel: 'Saltwater',   days: 12, util: 40, rev: '€960'   },
  { berth: 'B5', vessel: 'Nautilus V',  days: 30, util: 100,rev: '€8,200' },
  { berth: 'B8', vessel: 'Avalon',      days: 30, util: 100,rev: '€5,500' },
];

function Bar({ val, max, color = 'var(--navy)' }) {
  const pct = Math.min(100, Math.round((val / max) * 100));
  return (
    <div className="chart-track">
      <div className="chart-fill" style={{ width: pct + '%', background: color }} />
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('occupancy');

  const { berths, counts, loading: bLoading } = useBerths();
  const { piers } = usePiers();
  const { invoices: rawInv, loading: invLoading } = useInvoices();
  const { members, loading: mLoading } = useMembers();
  const { assets } = useAssets();
  const { defects } = useDefects();

  const invoices = rawInv.map(inv => ({
    ...inv,
    status: inv.status ?? 'unpaid',
  }));

  const totalRevApr = MONTHLY_REV[6].berths + MONTHLY_REV[6].fuel + MONTHLY_REV[6].utils + MONTHLY_REV[6].other;
  const maxMonthRev = Math.max(...MONTHLY_REV.map(m => m.berths + m.fuel + m.utils + m.other));

  const docCompliant  = members.filter(m => (m.docs_status ?? m.docs) === 'complete' && (m.insurance_status ?? m.insurance) !== 'EXPIRED' && (m.insurance_status ?? m.insurance) !== 'expired').length;
  const insExpired    = members.filter(m => (m.insurance_status ?? m.insurance) === 'EXPIRED' || (m.insurance_status ?? m.insurance) === 'expired').length;
  const assetsOverdue = assets.filter(a => a.status === 'due_service' || a.status === 'under_repair' || (a.next_service && new Date(a.next_service) < new Date())).length;
  const openDefects   = defects.filter(d => d.status !== 'resolved').length;

  const occPct = counts.total > 0 ? Math.round((counts.occupied / counts.total) * 100) : 0;

  return (
    <div>
      <div className="tabs">
        {[['occupancy','Occupancy'],['revenue','Revenue'],['berths','Berth Utilisation'],['compliance','Compliance']].map(([v,l]) => (
          <div key={v} className={`tab${tab===v?' active':''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'occupancy' && (
        <div>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {[
              { label: 'Total Berths',      val: bLoading ? '…' : counts.total,     sub: 'Across all piers' },
              { label: 'Occupied',          val: bLoading ? '…' : counts.occupied,   sub: `${occPct}% occupancy` },
              { label: 'Available',         val: bLoading ? '…' : counts.available,  sub: 'Ready to assign' },
              { label: 'Avg Stay (nights)', val: '3.8',                              sub: 'Transient berths Apr' },
            ].map(k => (
              <div key={k.label} className="kpi-card">
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-val">{k.val}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Occupancy by Pier — April 2026</div>
              {bLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Loading…</div>
              ) : (
                <div className="chart-wrap">
                  {piers.map(p => {
                    const pierBerths = berths.filter(b => b.pier === p.id);
                    const occ = pierBerths.filter(b => b.status === 'occupied').length;
                    const tot = p.berth_count ?? pierBerths.length;
                    const pct = tot > 0 ? Math.round((occ / tot) * 100) : 0;
                    return (
                      <div key={p.id} className="chart-row">
                        <div className="chart-lbl">{p.label ?? p.code ?? `Pier ${p.id}`}</div>
                        <Bar val={occ} max={tot || 1} color="var(--navy)" />
                        <div className="chart-val">{pct}%</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 16, fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Overall occupancy: <b>{occPct}%</b> ({counts.occupied}/{counts.total} berths)</div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Arrivals & Departures Today</div>
              {[
                { time: '08:30', event: 'Arrival', vessel: 'Ocean Star', berth: 'A1', status: 'checked-in', color: 'var(--green)' },
                { time: '10:00', event: 'Arrival', vessel: 'Nordic Blue', berth: 'A6', status: 'expected', color: 'var(--blue)' },
                { time: '11:30', event: 'Departure', vessel: 'Windseeker', berth: 'A8', status: 'expected', color: 'var(--orange)' },
                { time: '14:00', event: 'Arrival', vessel: 'Puffin', berth: 'B4', status: 'expected', color: 'var(--blue)' },
                { time: '16:00', event: 'Departure', vessel: 'Lady K', berth: 'A5', status: 'expected', color: 'var(--orange)' },
              ].map((e, i) => (
                <div key={i} className="act-item">
                  <div className="act-dot" style={{ background: e.color }} />
                  <div style={{ flex: 1 }}>
                    <div className="act-text">{e.event} — <b>{e.vessel}</b> ({e.berth})</div>
                    <div className="act-time">{e.time} · {e.status}</div>
                  </div>
                  {e.status === 'expected' && <button className="btn btn-ghost btn-sm">Check In</button>}
                  {e.status === 'checked-in' && <span className="badge badge-green">Done</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'revenue' && (
        <div>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {[
              { label: 'Revenue — April', val: `€${totalRevApr.toLocaleString()}`, sub: '+22% vs Mar 2026' },
              { label: 'Berth Fees',      val: `€${MONTHLY_REV[6].berths.toLocaleString()}`, sub: `${Math.round(MONTHLY_REV[6].berths/totalRevApr*100)}% of total` },
              { label: 'Fuel Sales',      val: `€${MONTHLY_REV[6].fuel.toLocaleString()}`,   sub: `${Math.round(MONTHLY_REV[6].fuel/totalRevApr*100)}% of total` },
              { label: 'Outstanding',     val: invLoading ? '…' : `€${rawInv.filter(i=>i.status!=='paid').reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString('de-DE',{minimumFractionDigits:2})}`, sub: `${invoices.filter(i=>i.status!=='paid').length} invoices unpaid` },
            ].map(k => (
              <div key={k.label} className="kpi-card">
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-val">{k.val}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Monthly Revenue — Oct 2025 to Apr 2026</div>
              <div className="chart-wrap">
                {MONTHLY_REV.map(m => {
                  const total = m.berths + m.fuel + m.utils + m.other;
                  return (
                    <div key={m.month} className="chart-row">
                      <div className="chart-lbl">{m.month}</div>
                      <Bar val={total} max={maxMonthRev} color={m.month === 'Apr' ? 'var(--teal)' : 'var(--navy)'} />
                      <div className="chart-val">€{(total/1000).toFixed(1)}k</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Revenue by Department — April</div>
              <div className="chart-wrap">
                {[
                  { label: 'Berth Fees', val: MONTHLY_REV[6].berths, color: 'var(--navy)' },
                  { label: 'Fuel Dock',  val: MONTHLY_REV[6].fuel,   color: 'var(--teal)' },
                  { label: 'Utilities',  val: MONTHLY_REV[6].utils,  color: '#0075de' },
                  { label: 'Other',      val: MONTHLY_REV[6].other,  color: 'var(--gold)' },
                ].map(d => (
                  <div key={d.label} className="chart-row">
                    <div className="chart-lbl">{d.label}</div>
                    <Bar val={d.val} max={MONTHLY_REV[6].berths} color={d.color} />
                    <div className="chart-val">€{d.val.toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Invoice Status</div>
                {invLoading ? (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '6px 0' }}>Loading…</div>
                ) : [
                  ['Paid',    invoices.filter(i=>i.status==='paid').length,   'badge-green'],
                  ['Unpaid',  invoices.filter(i=>i.status==='unpaid').length,  'badge-orange'],
                  ['Overdue', invoices.filter(i=>i.status==='overdue').length, 'badge-red'],
                ].map(([l,n,b]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                    <span style={{ color: 'rgba(0,0,0,0.55)' }}>{l}</span>
                    <span className={`badge ${b}`}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'berths' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Berth Utilisation — April 2026</div>
            <button className="btn btn-ghost btn-sm"><Ic n="file" s={11}/>Export CSV</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Berth</th><th>Current Vessel</th><th>Days Occupied</th><th>Utilisation</th><th>Revenue Apr</th></tr></thead>
              <tbody>
                {BERTH_UTIL.map(b => (
                  <tr key={b.berth}>
                    <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{b.berth}</td>
                    <td className="tbl-name">{b.vessel}</td>
                    <td style={{ fontSize: 12 }}>{b.days} / 30 days</td>
                    <td style={{ width: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 99, height: 6 }}>
                          <div style={{ width: b.util + '%', background: b.util >= 80 ? 'var(--green)' : b.util >= 50 ? 'var(--teal)' : 'var(--orange)', borderRadius: 99, height: 6 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, width: 36 }}>{b.util}%</span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{b.rev}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'compliance' && (
        <div>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {mLoading ? (
              Array(4).fill(null).map((_, i) => (
                <div key={i} className="kpi-card"><div className="kpi-val" style={{ color: 'rgba(0,0,0,0.3)' }}>…</div></div>
              ))
            ) : [
              { label: 'Members Fully Compliant', val: `${docCompliant}/${members.length}`, sub: `${members.length > 0 ? Math.round(docCompliant/members.length*100) : 0}% compliance rate` },
              { label: 'Insurance Expired',        val: insExpired,    sub: 'Require immediate action' },
              { label: 'Assets Overdue Service',   val: assetsOverdue, sub: 'Scheduled maintenance' },
              { label: 'Open Defects',             val: openDefects,   sub: 'Across all assets' },
            ].map(k => (
              <div key={k.label} className="kpi-card">
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-val" style={{ color: (k.val === insExpired || k.val === assetsOverdue || k.val === openDefects) && k.val > 0 ? 'var(--orange)' : undefined }}>{k.val}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Document Compliance — Members</div>
              {mLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Loading…</div>
              ) : (
                <>
                  <div className="chart-wrap" style={{ marginBottom: 16 }}>
                    <div className="chart-row">
                      <div className="chart-lbl">Docs OK</div>
                      <Bar val={members.filter(m=>(m.docs_status??m.docs)==='complete').length} max={members.length||1} color="var(--green)" />
                      <div className="chart-val">{members.filter(m=>(m.docs_status??m.docs)==='complete').length}/{members.length}</div>
                    </div>
                    <div className="chart-row">
                      <div className="chart-lbl">Insurance</div>
                      <Bar val={members.filter(m=>(m.insurance_status??m.insurance)!=='EXPIRED'&&(m.insurance_status??m.insurance)!=='expired').length} max={members.length||1} color="var(--teal)" />
                      <div className="chart-val">{members.filter(m=>(m.insurance_status??m.insurance)!=='EXPIRED'&&(m.insurance_status??m.insurance)!=='expired').length}/{members.length}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Members Requiring Action</div>
                  {members.filter(m => (m.docs_status??m.docs) !== 'complete' || (m.insurance_status??m.insurance) === 'EXPIRED' || (m.insurance_status??m.insurance) === 'expired').map(m => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>{m.vessels?.[0]?.name ?? m.vessel ?? '—'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {((m.insurance_status??m.insurance)==='EXPIRED'||(m.insurance_status??m.insurance)==='expired') && <span className="badge badge-red">Insurance Expired</span>}
                        {(m.docs_status??m.docs)==='missing' && <span className="badge badge-orange">Docs Missing</span>}
                        {(m.docs_status??m.docs)==='pending' && <span className="badge badge-gold">Docs Pending</span>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Maintenance Overdue Report</div>
              {assets.filter(a => a.status === 'under_repair' || a.status === 'due_service' || (a.next_service && new Date(a.next_service) < new Date())).map(a => (
                <div key={a.id} style={{ padding: '10px 0', borderBottom: 'var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</div>
                    <span className={`badge ${a.status==='under_repair'?'badge-red':'badge-orange'}`}>{a.status === 'under_repair' ? 'Under Repair' : 'Due Service'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{a.location} · Next due: <span style={{ fontWeight: 600, color: a.next_service && new Date(a.next_service) < new Date() ? 'var(--red)' : 'var(--orange)' }}>{a.next_service ?? '—'}</span></div>
                </div>
              ))}
              {assets.filter(a => a.status === 'under_repair' || a.status === 'due_service' || (a.next_service && new Date(a.next_service) < new Date())).length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No overdue assets.</div>
              )}
              <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Open Defects</div>
              {defects.filter(d => d.status !== 'resolved').map(d => (
                <div key={d.id} style={{ padding: '8px 0', borderBottom: 'var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{d.asset_name || `DEF-${d.id}`}</div>
                    <span className={`badge ${d.severity==='high'?'badge-red':d.severity==='medium'?'badge-orange':'badge-gray'}`}>{d.severity}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{d.location} · {d.reported_at?.slice(0, 10) ?? '—'}</div>
                </div>
              ))}
              {defects.filter(d => d.status !== 'resolved').length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No open defects.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
