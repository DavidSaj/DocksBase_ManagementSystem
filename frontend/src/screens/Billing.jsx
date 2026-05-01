import { useState } from 'react';
import { UTILITY_METERS, DEBTORS } from '../data/mock.js';
import useInvoices from '../hooks/useInvoices.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api from '../api.js';

const FUEL_SALES = [
  { vessel: 'Ocean Star',  item: 'Diesel',   qty: '120L', amount: '€170.40', time: '09:15 today' },
  { vessel: 'Blue Horizon',item: 'Petrol',   qty: '80L',  amount: '€124.00', time: '08:50 today' },
  { vessel: 'Nautilus V',  item: 'Diesel',   qty: '340L', amount: '€482.80', time: 'Yesterday 17:20' },
  { vessel: 'Lady K',      item: 'Pump-out', qty: '1×',   amount: '€12.00',  time: 'Yesterday 14:00' },
];

function fmtInv(inv) {
  const rawAmt = inv.total ?? inv.amount;
  const amount = rawAmt != null
    ? `€${Number(rawAmt).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`
    : '—';
  return {
    ...inv,
    vessel: inv.vessel_name  ?? inv.vessel  ?? '—',
    owner:  inv.member_name  ?? inv.owner   ?? '—',
    type:   inv.invoice_type ?? inv.type    ?? '—',
    amount,
    issued: inv.created_at ? inv.created_at.slice(0, 10) : (inv.issued ?? '—'),
    due:    inv.due_date    ?? inv.due    ?? '—',
  };
}

export default function Billing() {
  const [tab, setTab] = useState('invoices');

  const [newInvoiceOpen, setNewInvoiceOpen]     = useState(false);
  const [invoiceStep, setInvoiceStep]           = useState(1);
  const [invoiceDraft, setInvoiceDraft]         = useState(null);
  const [catalogItems, setCatalogItems]         = useState([]);
  const [memberSearch, setMemberSearch]         = useState('');
  const [memberResults, setMemberResults]       = useState([]);
  const [selectedMember, setSelectedMember]     = useState(null);
  const [dueDate, setDueDate]                   = useState('');
  const [selectedItem, setSelectedItem]         = useState('');
  const [itemQty, setItemQty]                   = useState('1');
  const [invoiceLines, setInvoiceLines]         = useState([]);
  const [invoiceCreating, setInvoiceCreating]   = useState(false);

  const { invoices: raw, loading, refetch } = useInvoices();
  const invoices = raw.map(fmtInv);

  function openNewInvoice() {
    setNewInvoiceOpen(true);
    setInvoiceStep(1);
    setInvoiceDraft(null);
    setInvoiceLines([]);
    setSelectedMember(null);
    setMemberSearch('');
    setDueDate('');
    api.get('/billing/service-catalog/')
      .then(r => setCatalogItems((r.data.results ?? r.data).filter(i => i.is_active)))
      .catch(() => {});
  }

  function searchMembers(q) {
    setMemberSearch(q);
    if (q.length < 2) { setMemberResults([]); return; }
    api.get('/members/', { params: { search: q } })
      .then(r => setMemberResults((r.data.results ?? r.data).slice(0, 6)))
      .catch(() => {});
  }

  async function createDraftAndProceed() {
    setInvoiceCreating(true);
    try {
      const r = await api.post('/billing/invoices/create/', {
        member_id:   selectedMember?.id ?? null,
        due_date:    dueDate || null,
        source_type: 'manual',
      });
      setInvoiceDraft(r.data);
      setInvoiceStep(2);
    } catch {
      alert('Could not create invoice. Please try again.');
    } finally {
      setInvoiceCreating(false);
    }
  }

  async function addLineItem() {
    if (!invoiceDraft || !selectedItem) return;
    const item = catalogItems.find(i => String(i.id) === String(selectedItem));
    if (!item) return;
    try {
      const r = await api.post(`/billing/invoices/${invoiceDraft.id}/line-items/`, {
        chargeable_item_id: item.id,
        quantity: itemQty,
      });
      setInvoiceLines(prev => [...prev, r.data]);
      setSelectedItem('');
      setItemQty('1');
    } catch {
      alert('Could not add line item.');
    }
  }

  async function removeLineItem(lineId) {
    try {
      await api.delete(`/billing/line-items/${lineId}/`);
      setInvoiceLines(prev => prev.filter(l => l.id !== lineId));
    } catch {
      alert('Could not remove line item.');
    }
  }

  async function finalizeInvoice() {
    if (!invoiceDraft) return;
    try {
      const r = await api.post(`/billing/invoices/${invoiceDraft.id}/finalize/`);
      setNewInvoiceOpen(false);
      refetch();
      alert(`Invoice ${r.data.invoice_number} finalized — Total: €${r.data.total}`);
    } catch {
      alert('Could not finalize invoice.');
    }
  }

  const lineSubtotal = invoiceLines.reduce((s, l) => s + Number(l.line_subtotal ?? l.total_price ?? 0), 0);
  const lineTax      = invoiceLines.reduce((s, l) => s + Number(l.line_tax ?? 0), 0);
  const lineTotal    = lineSubtotal + lineTax;

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
            <button className="btn btn-primary" onClick={openNewInvoice}><Ic n="plus" s={12} />New Invoice</button>
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

      {newInvoiceOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setNewInvoiceOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>

            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>New Invoice</div>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>Step {invoiceStep} of 2</span>
            </div>

            {invoiceStep === 1 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>MEMBER / CUSTOMER</div>
                <div style={{ position: 'relative', marginBottom: 14 }}>
                  <input
                    style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)' }}
                    placeholder="Search by name or email… (optional)"
                    value={selectedMember ? selectedMember.name : memberSearch}
                    onChange={e => { setSelectedMember(null); searchMembers(e.target.value); }}
                  />
                  {memberResults.length > 0 && !selectedMember && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: 'var(--border)', borderRadius: 6, boxShadow: 'var(--shadow2)', zIndex: 10 }}>
                      {memberResults.map(m => (
                        <div key={m.id}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12 }}
                          onMouseDown={() => { setSelectedMember(m); setMemberResults([]); }}>
                          <div style={{ fontWeight: 500 }}>{m.name}</div>
                          <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>{m.email}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>DUE DATE (OPTIONAL)</div>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '7px 10px', fontSize: 13, marginBottom: 24 }} />

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setNewInvoiceOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={invoiceCreating} onClick={createDraftAndProceed}>
                    {invoiceCreating ? 'Creating…' : 'Next →'}
                  </button>
                </div>
              </div>
            )}

            {invoiceStep === 2 && (
              <div>
                {selectedMember && (
                  <div style={{ background: 'var(--bg)', borderRadius: 7, padding: '8px 12px', marginBottom: 16, fontSize: 12 }}>
                    <span style={{ color: 'rgba(0,0,0,0.45)' }}>Billing to: </span>
                    <span style={{ fontWeight: 600 }}>{selectedMember.name}</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                  <select value={selectedItem} onChange={e => setSelectedItem(e.target.value)}
                    style={{ flex: 1, border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}>
                    <option value="">Select service from catalog…</option>
                    {catalogItems.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name} — €{Number(i.unit_price).toFixed(2)} ({i.pricing_model_display})
                      </option>
                    ))}
                  </select>
                  <input type="number" step="0.01" min="0.01" value={itemQty} onChange={e => setItemQty(e.target.value)}
                    style={{ width: 72, border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}
                    placeholder="Qty" />
                  <button className="btn btn-primary btn-sm" onClick={addLineItem} disabled={!selectedItem}>Add</button>
                </div>

                {invoiceLines.length > 0 ? (
                  <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
                    <table className="tbl">
                      <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Tax</th><th>Total</th><th></th></tr></thead>
                      <tbody>
                        {invoiceLines.map(line => (
                          <tr key={line.id}>
                            <td style={{ fontSize: 12 }}>{line.description}</td>
                            <td style={{ fontSize: 12 }}>{Number(line.quantity).toFixed(2)}</td>
                            <td style={{ fontSize: 12 }}>€{Number(line.unit_price).toFixed(2)}</td>
                            <td style={{ fontSize: 12 }}>{line.tax_rate}%</td>
                            <td style={{ fontWeight: 600, fontSize: 12 }}>€{Number(line.line_total ?? line.total_price).toFixed(2)}</td>
                            <td>
                              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16, lineHeight: 1 }}
                                onClick={() => removeLineItem(line.id)}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12, marginBottom: 14 }}>
                    No line items yet — select a service above and click Add.
                  </div>
                )}

                {invoiceLines.length > 0 && (
                  <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
                    {[['Subtotal', lineSubtotal], ['Tax', lineTax], ['Grand Total', lineTotal]].map(([label, val]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: label === 'Grand Total' ? 14 : 12, fontWeight: label === 'Grand Total' ? 700 : 400, color: label === 'Grand Total' ? 'var(--navy)' : 'rgba(0,0,0,0.7)' }}>
                        <span>{label}</span><span>€{val.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => { setNewInvoiceOpen(false); refetch(); }}>Save as Draft</button>
                  <button className="btn btn-primary" disabled={invoiceLines.length === 0} onClick={finalizeInvoice}>
                    Finalize Invoice
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
