import { useState } from 'react';
import { UTILITY_METERS, DEBTORS } from '../data/mock.js';
import useInvoices from '../hooks/useInvoices.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';

const FUEL_SALES = [
  { vessel: 'Ocean Star',  item: 'Diesel',   qty: '120L', amount: '€170.40', time: '09:15 today' },
  { vessel: 'Blue Horizon',item: 'Petrol',   qty: '80L',  amount: '€124.00', time: '08:50 today' },
  { vessel: 'Nautilus V',  item: 'Diesel',   qty: '340L', amount: '€482.80', time: 'Yesterday 17:20' },
  { vessel: 'Lady K',      item: 'Pump-out', qty: '1×',   amount: '€12.00',  time: 'Yesterday 14:00' },
];

function fmtInv(inv) {
  const amount = inv.amount != null
    ? (String(inv.amount).startsWith('€') ? inv.amount : `€${Number(inv.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`)
    : '—';
  return {
    ...inv,
    vessel: inv.vessel_name  ?? inv.vessel  ?? '—',
    owner:  inv.member_name  ?? inv.owner   ?? '—',
    type:   inv.invoice_type ?? inv.type    ?? '—',
    amount,
  };
}

export default function Billing() {
  const [tab, setTab] = useState('invoices');

  const { invoices: raw, loading } = useInvoices();
  const invoices = raw.map(fmtInv);

  const count = (s) => invoices.filter(i => i.status === s).length;

  return (
    <div>
      <div className="tabs">
        {[['invoices','Invoices'],['utilities','Utility Meters'],['pos','Fuel Dock POS'],['debtors','Aged Debtors'],['accounts','Accounts']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'invoices' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', gap: 8 }}>
              {loading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '6px 12px' }}>Loading…</div>
              ) : [['Paid',count('paid'),'badge-green'],['Unpaid',count('unpaid'),'badge-orange'],['Overdue',count('overdue'),'badge-red']].map(([l,c,b]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--white)', border: 'var(--border)', borderRadius: 7, padding: '6px 12px' }}>
                  <span className={`badge ${b}`}>{c}</span>
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{l}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary"><Ic n="plus" s={12} />New Invoice</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Vessel / Owner</th><th>Type</th><th>Amount</th><th>Issued</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No invoices found.</td></tr>
                ) : invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="tbl-name">{inv.id}</td>
                    <td><div className="tbl-name">{inv.vessel}</div><div className="tbl-sub">{inv.owner}</div></td>
                    <td><span className="badge badge-navy">{inv.type}</span></td>
                    <td style={{ fontWeight: 600 }}>{inv.amount}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{inv.issued}</td>
                    <td style={{ fontSize: 12, fontWeight: inv.status==='overdue'?600:400, color: inv.status==='overdue'?'var(--red)':'rgba(0,0,0,0.45)' }}>{inv.due}</td>
                    <td><StatusBadge s={inv.status} /></td>
                    <td><button className="btn btn-ghost btn-sm">{inv.status==='paid'?'View':'Chase'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'utilities' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Utility Meters by Berth</div>
            <button className="btn btn-primary btn-sm">Enter Readings</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Berth</th><th>Vessel</th><th>Electricity (kWh)</th><th>Usage</th><th>Water (L)</th><th>Usage</th><th>Est. Charge</th></tr></thead>
              <tbody>
                {UTILITY_METERS.map(m => {
                  const elec   = m.elec_cur - m.elec_start;
                  const water  = m.water_cur - m.water_start;
                  const charge = `€${((elec * 0.28) + (water * 0.004)).toFixed(2)}`;
                  return (
                    <tr key={m.berth}>
                      <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{m.berth}</td>
                      <td className="tbl-name">{m.vessel}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{m.elec_start} → {m.elec_cur}</div>
                        <div className="meter-bar-wrap"><div className="meter-bar" style={{ width: `${Math.min(100,(elec/200)*100)}%`, background: '#0075de' }} /></div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{elec} kWh</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{m.water_start} → {m.water_cur}</div>
                        <div className="meter-bar-wrap"><div className="meter-bar" style={{ width: `${Math.min(100,(water/100)*100)}%`, background: 'var(--teal2)' }} /></div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{water} L</td>
                      <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{charge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'pos' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="card-header"><div className="card-header-title">Fuel Dock — Quick Sale</div></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[['Diesel','€1.42/L','#0075de'],['Petrol','€1.55/L','#dd5b00'],['Pump-out','€12 flat','#2a9d99'],['Ice (5kg)','€4.50','#615d59'],['Shore Power Token','€3.00','#213183'],['Merchandise','Price varies','#b8965a']].map(([item,price,c]) => (
                  <div key={item} style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px', cursor: 'pointer', border: 'var(--border)', transition: 'box-shadow 0.1s' }}
                    onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow2)'}
                    onMouseOut={e  => e.currentTarget.style.boxShadow = ''}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.8)' }}>{item}</div>
                    <div style={{ fontSize: 12, color: c, fontWeight: 600, marginTop: 4 }}>{price}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-gold" style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: '10px' }}>Process Sale</button>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><div className="card-header-title">Recent Fuel Sales</div></div>
            <div className="card-body" style={{ padding: 0 }}>
              {FUEL_SALES.map((s,i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: 'var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{s.vessel}</div>
                    <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>{s.item} · {s.qty} · {s.time}</div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{s.amount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'debtors' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Aged Debtor Report</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-red">{DEBTORS.filter(d=>d.daysOverdue>0).length} Overdue</span>
              <button className="btn btn-ghost btn-sm"><Ic n="file" s={11}/>Export</button>
              <button className="btn btn-primary btn-sm">Chase All Overdue</button>
            </div>
          </div>
          <div className="grid-2" style={{ alignItems: 'start', marginBottom: 16 }}>
            {[['0–7 Days',DEBTORS.filter(d=>d.bucket==='0–7').length,'badge-orange'],['8–30 Days',DEBTORS.filter(d=>d.bucket==='8–30').length,'badge-red'],['31–60 Days',DEBTORS.filter(d=>d.bucket==='31–60').length,'badge-red'],['Current / Upcoming',DEBTORS.filter(d=>d.bucket==='current').length,'badge-gray']].map(([l,c,b]) => (
              <div key={l} className="card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{l}</span>
                <span className={`badge ${b}`} style={{ fontSize: 14, fontWeight: 700 }}>{c}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Vessel / Owner</th><th>Amount</th><th>Due Date</th><th>Days Overdue</th><th>Bucket</th><th>Reminders</th><th></th></tr></thead>
              <tbody>
                {DEBTORS.map(d => (
                  <tr key={d.id}>
                    <td className="tbl-name">{d.id}</td>
                    <td><div style={{ fontSize: 12, fontWeight: 600 }}>{d.vessel}</div><div className="tbl-sub">{d.owner}</div></td>
                    <td style={{ fontWeight: 700, fontSize: 13 }}>{d.amount}</td>
                    <td style={{ fontSize: 12 }}>{d.due}</td>
                    <td style={{ fontWeight: 700, color: d.daysOverdue > 0 ? 'var(--red)' : 'rgba(0,0,0,0.4)' }}>{d.daysOverdue > 0 ? `${d.daysOverdue}d overdue` : '—'}</td>
                    <td><span className={`badge ${d.bucket==='current'?'badge-gray':'badge-orange'}`}>{d.bucket}</span></td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{d.reminders} sent</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm">View</button>
                      {d.daysOverdue > 0 && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--orange)' }}>Chase</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Batch Billing</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6 }}>Generate invoices for all berth holders for the selected billing period.</div>
                <select><option>Monthly Berth Fees — May 2026</option><option>Monthly Berth Fees — Apr 2026</option><option>Utility Charges — Apr 2026</option></select>
                <select><option>All berth holders ({invoices.length > 0 ? '...' : '—'})</option><option>Seasonal only</option><option>Transient only</option></select>
                <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Generate Batch Invoices</button>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Exports</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[['All Invoices (CSV)','file'],['Debtor Report (PDF)','file'],['Revenue Summary (XLSX)','file'],['Utility Charges (CSV)','file']].map(([l,i]) => (
                  <button key={l} className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }}><Ic n={i} s={12}/>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>End-of-Day Z-Report</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>Summarise all POS transactions for today including fuel sales, pump-outs, and marina store.</div>
              {[['Fuel Sales', '€777.20'],['Pump-outs','€36.00'],['Marina Store','€18.50'],['Shore Power Tokens','€9.00']].map(([l,v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'rgba(0,0,0,0.55)' }}>{l}</span>
                  <span style={{ fontWeight: 700 }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
                <span>Total</span><span>€840.70</span>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Print Z-Report</button>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Payment Reconciliation</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6, marginBottom: 14 }}>Match bank statement transactions against open invoices.</div>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}>Import Bank Statement</button>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Auto-Reconcile</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
