import Ic from '../components/ui/Icon.jsx';
import { useState } from 'react';
import useBerths from '../hooks/useBerths.js';
import usePiers from '../hooks/usePiers.js';
import useInvoices from '../hooks/useInvoices.js';
import useMembers from '../hooks/useMembers.js';
import useAssets from '../hooks/useAssets.js';
import useDefects from '../hooks/useDefects.js';
import useReports from '../hooks/useReports.js';

function Bar({ val, max, color = 'var(--navy)' }) {
  const pct = Math.min(100, Math.round((val / (max || 1)) * 100));
  return (
    <div className="chart-track">
      <div className="chart-fill" style={{ width: pct + '%', background: color }} />
    </div>
  );
}

function currentMonthLabel() {
  return new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
}

export default function Reports() {
  const [tab, setTab] = useState('occupancy');

  const { berths, counts, loading: bLoading } = useBerths();
  const { piers } = usePiers();
  const { invoices: rawInv, loading: invLoading } = useInvoices();
  const { members, loading: mLoading } = useMembers();
  const { assets } = useAssets();
  const { defects } = useDefects();
  const { revenue: revReport, occupancy: occReport, utilisation: utilReport, loading: rLoading, error: repError } = useReports();

  const invoices = rawInv.map(inv => ({ ...inv, status: inv.status ?? 'unpaid' }));

  const monthlyData = revReport?.monthly_breakdown ?? [];
  const maxMonthRev = Math.max(...monthlyData.map(m => (m.berth||0)+(m.utility||0)+(m.service||0)+(m.retail||0)), 1);

  const docCompliant  = members.filter(m => (m.docs_status ?? m.docs) === 'complete' && (m.insurance_status ?? m.insurance) !== 'EXPIRED' && (m.insurance_status ?? m.insurance) !== 'expired').length;
  const insExpired    = members.filter(m => (m.insurance_status ?? m.insurance) === 'EXPIRED' || (m.insurance_status ?? m.insurance) === 'expired').length;
  const assetsOverdue = assets.filter(a => a.status === 'due_service' || a.status === 'under_repair' || (a.next_service && new Date(a.next_service) < new Date())).length;
  const openDefects   = defects.filter(d => d.status !== 'resolved').length;

  const occPct = counts.total > 0 ? Math.round((counts.occupied / counts.total) * 100) : 0;

  const arrivalsList   = occReport?.arrivals_today   ?? [];
  const departuresList = (occReport?.departures_today ?? []).map(e => ({ ...e, event: 'Departure' }));
  const utilBerths     = utilReport?.berths ?? [];

  return (
    <div>
      {repError && (
        <div style={{ padding: '10px 16px', marginBottom: 12, background: 'var(--red-light, #fff0f0)', border: '1px solid var(--red)', borderRadius: 6, fontSize: 12, color: 'var(--red)' }}>
          Failed to load reports: {repError}
        </div>
      )}
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
              { label: 'Avg Stay (nights)', val: rLoading ? '…' : (occReport?.avg_stay_nights ?? '—'), sub: `${new Date().toLocaleString('default', { month: 'long' })} bookings` },
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
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Occupancy by Pier</div>
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
              {rLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Loading…</div>
              ) : arrivalsList.length === 0 && departuresList.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>No arrivals or departures today.</div>
              ) : (
                <>
                  {arrivalsList.map((e, i) => (
                    <div key={`arr-${i}`} className="act-item">
                      <div className="act-dot" style={{ background: 'var(--green)' }} />
                      <div style={{ flex: 1 }}>
                        <div className="act-text">Arrival — <b>{e.vessel}</b> ({e.berth})</div>
                        <div className="act-time">{e.status}</div>
                      </div>
                      {e.status === 'confirmed' && <button className="btn btn-ghost btn-sm">Check In</button>}
                      {e.status === 'checked_in' && <span className="badge badge-green">Checked In</span>}
                    </div>
                  ))}
                  {departuresList.map((e, i) => (
                    <div key={`dep-${i}`} className="act-item">
                      <div className="act-dot" style={{ background: 'var(--orange)' }} />
                      <div style={{ flex: 1 }}>
                        <div className="act-text">Departure — <b>{e.vessel}</b> ({e.berth})</div>
                        <div className="act-time">{e.status}</div>
                      </div>
                      {e.event === 'Departure' && (e.status === 'confirmed' || e.status === 'checked_in' || e.status === 'overstay') && (
                        <span className="badge badge-orange">Due Out</span>
                      )}
                      {e.event === 'Departure' && e.status === 'checked_out' && (
                        <span className="badge badge-gray">Departed</span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'revenue' && (
        <div>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {rLoading ? (
              Array(4).fill(null).map((_, i) => (
                <div key={i} className="kpi-card"><div className="kpi-val" style={{ color: 'rgba(0,0,0,0.3)' }}>…</div></div>
              ))
            ) : [
              { label: `Revenue — ${new Date().toLocaleString('default', { month: 'long' })}`,
                val: revReport ? `€${Number(revReport.revenue_this_month).toLocaleString('de-DE', {minimumFractionDigits:2})}` : '…',
                sub: 'Current month total' },
              { label: 'Berth Fees',
                val: revReport ? `€${Number(revReport.current_month_by_category?.berth ?? 0).toLocaleString()}` : '…',
                sub: revReport ? `${Math.round((revReport.current_month_by_category?.berth ?? 0) / (revReport.revenue_this_month || 1) * 100)}% of total` : '' },
              { label: 'Utilities & Services',
                val: revReport ? `€${Number((revReport.current_month_by_category?.utility ?? 0) + (revReport.current_month_by_category?.service ?? 0)).toLocaleString()}` : '…',
                sub: 'Utility + service lines' },
              { label: 'Outstanding',
                val: revReport ? `€${Number(revReport.outstanding).toLocaleString('de-DE', {minimumFractionDigits:2})}` : '…',
                sub: revReport ? `${revReport.invoices_unpaid} unpaid, ${revReport.invoices_overdue} overdue` : '' },
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
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Monthly Revenue — Last 7 Months</div>
              {rLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Loading…</div>
              ) : monthlyData.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic', padding: '12px 0' }}>No revenue data yet.</div>
              ) : (
                <div className="chart-wrap">
                  {monthlyData.map((m, i) => {
                    const total = (m.berth||0)+(m.utility||0)+(m.service||0)+(m.retail||0);
                    const isCurrentMonth = i === monthlyData.length - 1;
                    const label = new Date(m.month + '-01').toLocaleString('default', { month: 'short' });
                    return (
                      <div key={m.month} className="chart-row">
                        <div className="chart-lbl">{label}</div>
                        <Bar val={total} max={maxMonthRev} color={isCurrentMonth ? 'var(--teal)' : 'var(--navy)'} />
                        <div className="chart-val">€{(total/1000).toFixed(1)}k</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                Revenue by Department — {new Date().toLocaleString('default', { month: 'long' })}
              </div>
              {rLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '6px 0' }}>Loading…</div>
              ) : (() => {
                const cats = revReport?.current_month_by_category ?? {};
                const deptMax = Math.max(cats.berth||0, cats.utility||0, cats.service||0, cats.retail||0, 1);
                return (
                  <div className="chart-wrap">
                    {[
                      { label: 'Berth Fees', val: cats.berth   || 0, color: 'var(--navy)' },
                      { label: 'Utilities',  val: cats.utility  || 0, color: '#0075de' },
                      { label: 'Services',   val: cats.service  || 0, color: 'var(--teal)' },
                      { label: 'Retail',     val: cats.retail   || 0, color: 'var(--gold)' },
                    ].map(d => (
                      <div key={d.label} className="chart-row">
                        <div className="chart-lbl">{d.label}</div>
                        <Bar val={d.val} max={deptMax} color={d.color} />
                        <div className="chart-val">€{Number(d.val).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Invoice Status</div>
                {invLoading ? (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '6px 0' }}>Loading…</div>
                ) : [
                  ['Paid',    invoices.filter(i=>i.status==='paid').length,  'badge-green'],
                  ['Unpaid',  invoices.filter(i=>i.status==='open').length,  'badge-orange'],
                  ['Overdue', revReport?.invoices_overdue ?? 0,              'badge-red'],
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
            <div className="sec-hdr-title">Berth Utilisation — {currentMonthLabel()}</div>
            <button className="btn btn-ghost btn-sm"><Ic n="file" s={11}/>Export CSV</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Berth</th><th>Pier</th><th>Current Vessel</th><th>Days Occupied</th><th>Utilisation</th></tr></thead>
              <tbody>
                {rLoading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : utilBerths.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No berths found.</td></tr>
                ) : utilBerths.map(b => (
                  <tr key={b.berth}>
                    <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{b.berth}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{b.pier}</td>
                    <td className="tbl-name">{b.vessel ?? <span style={{ color: 'rgba(0,0,0,0.3)', fontStyle: 'italic' }}>Vacant</span>}</td>
                    <td style={{ fontSize: 12 }}>{b.days_occupied} days</td>
                    <td style={{ width: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 99, height: 6 }}>
                          <div style={{ width: b.util_pct + '%', background: b.util_pct >= 80 ? 'var(--green)' : b.util_pct >= 50 ? 'var(--teal)' : 'var(--orange)', borderRadius: 99, height: 6 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, width: 36 }}>{b.util_pct}%</span>
                      </div>
                    </td>
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
