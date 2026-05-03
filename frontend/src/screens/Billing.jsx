import { useState, useEffect, useCallback, useRef } from 'react';
import useInvoices from '../hooks/useInvoices.js';
import useFuelEntries from '../hooks/useFuelEntries.js';
import usePOSCatalog from '../hooks/usePOSCatalog.js';
import useBoaterAccounts from '../hooks/useBoaterAccounts.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api from '../api.js';

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

  const { invoices: rawInv, loading, refetch } = useInvoices();
  const invoices = rawInv.map(fmtInv);

  // Fuel Dock POS — real completed entries
  const { entries: fuelEntries, loading: fuelLoading, refetch: refetchFuelEntries } = useFuelEntries({ limit: 20 });

  // Quick Sale state
  const [selectedPOSItem,  setSelectedPOSItem]  = useState(null);
  const [posLitres,        setPosLitres]        = useState('');
  const [posQuery,         setPosQuery]         = useState('');
  const [posSuggestions,   setPosSuggestions]   = useState([]);
  const [posResolved,      setPosResolved]      = useState(null);
  const [posSubmitting,    setPosSubmitting]    = useState(false);
  const [posError,         setPosError]         = useState('');
  const debounceRef = useRef(null);

  const { items: posCatalog, loading: posLoading } = usePOSCatalog();

  const {
    accounts, loading: acctLoading, fetchAccounts,
    selectedId, drawerData, drawerLoading,
    openDrawer, refreshDrawer, closeDrawer,
  } = useBoaterAccounts();

  const [acctSearch, setAcctSearch]   = useState('');
  const [acctShowAll, setAcctShowAll] = useState(false);

  const [payAmount, setPayAmount]   = useState('');
  const [payMethod, setPayMethod]   = useState('bank_transfer');
  const [payNotes, setPayNotes]     = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payModalInv, setPayModalInv] = useState(null);

  // Batch billing state
  const defaultPeriod = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const [batchPeriod, setBatchPeriod] = useState(defaultPeriod);
  const [batchMemberType, setBatchMemberType] = useState('all');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState(null);

  // Z-Report state
  const [zDate, setZDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [zReport, setZReport] = useState(null);
  const [zLoading, setZLoading] = useState(false);

  const fetchZReport = useCallback((date) => {
    setZLoading(true);
    api.get('/billing/z-report/', { params: { date } })
      .then(r => setZReport(r.data))
      .catch(() => setZReport(null))
      .finally(() => setZLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'accounts') fetchZReport(zDate);
  }, [tab, zDate, fetchZReport]);

  useEffect(() => {
    if (tab === 'boater-accounts') fetchAccounts({ search: acctSearch, showAll: acctShowAll });
  }, [tab, acctSearch, acctShowAll, fetchAccounts]);

  async function runBatch() {
    setBatchLoading(true);
    setBatchResult(null);
    try {
      const r = await api.post('/billing/invoices/batch/', {
        billing_period: batchPeriod,
        member_type: batchMemberType,
      });
      setBatchResult(r.data);
      refetch();
    } catch (e) {
      setBatchResult({ error: e?.response?.data?.detail ?? 'Batch billing failed.' });
    } finally {
      setBatchLoading(false);
    }
  }

  async function exportCSV() {
    try {
      const resp = await api.get('/billing/invoices/export/', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    }
  }

  // Generate last 6 months for the batch period selector
  const batchPeriodOptions = (() => {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      opts.push({ val, label });
    }
    return opts;
  })();

  const today = new Date();
  const debtors = rawInv
    .filter(inv => inv.status === 'open' || inv.status === 'overdue')
    .map(inv => {
      const dueDate = inv.due_date ? new Date(inv.due_date) : null;
      const daysOverdue = dueDate ? Math.max(0, Math.floor((today - dueDate) / 86400000)) : 0;
      const bucket = daysOverdue === 0 ? 'current'
        : daysOverdue <= 7 ? '0–7'
        : daysOverdue <= 30 ? '8–30'
        : '31–60';
      return {
        id: inv.invoice_number,
        vessel: inv.vessel_name ?? inv.member_name ?? '—',
        owner: inv.member_name ?? '—',
        amount: `€${Number(inv.total ?? 0).toFixed(2)}`,
        due: inv.due_date ?? '—',
        daysOverdue,
        bucket,
        reminders: 0,
      };
    });

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

  const FUEL_COLORS = { diesel: '#0075de', petrol: '#dd5b00', pump_out: '#2a9d99' };

  function posTotal() {
    if (!selectedPOSItem) return 0;
    if (selectedPOSItem.pricing_model === 'per_litre') {
      const l = parseFloat(posLitres);
      return (isNaN(l) || l <= 0) ? 0 : +(l * parseFloat(selectedPOSItem.unit_price)).toFixed(2);
    }
    return parseFloat(selectedPOSItem.unit_price);
  }

  function posPriceLabel(item) {
    return item.pricing_model === 'per_litre'
      ? `€${Number(item.unit_price).toFixed(2)}/L`
      : `€${Number(item.unit_price).toFixed(2)} flat`;
  }

  function handlePosQueryChange(e) {
    const val = e.target.value;
    setPosQuery(val);
    setPosResolved(null);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setPosSuggestions([]); return; }
    debounceRef.current = setTimeout(() => {
      api.get('/members/', { params: { search: val } })
        .then(r => setPosSuggestions((r.data.results ?? r.data).slice(0, 5)))
        .catch(() => {});
    }, 300);
  }

  function handlePosSuggestionSelect(member) {
    const vessel = member.vessels?.[0] ?? null;
    setPosResolved({ id: member.id, vesselId: vessel?.id ?? null });
    setPosQuery(vessel ? `${member.name} — ${vessel.name}` : member.name);
    setPosSuggestions([]);
  }

  function clearPosForm() {
    clearTimeout(debounceRef.current);
    setSelectedPOSItem(null);
    setPosLitres('');
    setPosQuery('');
    setPosSuggestions([]);
    setPosResolved(null);
    setPosSubmitting(false);
    setPosError('');
  }

  async function handleProcessSale() {
    const total = posTotal();
    if (total <= 0) return;
    setPosSubmitting(true);
    setPosError('');
    try {
      const isPerLitre = selectedPOSItem.pricing_model === 'per_litre';
      await api.post('/fuel-dock/queue/', {
        status:          'completed',
        fuel_type:       selectedPOSItem.fuel_dock_type,
        actual_litres:   isPerLitre ? posLitres : null,
        price_per_litre: isPerLitre ? selectedPOSItem.unit_price : null,
        total_amount:    isPerLitre ? null : String(parseFloat(selectedPOSItem.unit_price).toFixed(2)),
        ...(posResolved
          ? { member: posResolved.id, ...(posResolved.vesselId ? { vessel: posResolved.vesselId } : {}) }
          : { guest_description: posQuery || 'Walk-up' }),
      });
      clearPosForm();
      refetchFuelEntries();
    } catch {
      setPosError('Sale failed — please try again.');
    } finally {
      setPosSubmitting(false);
    }
  }

  const total = posTotal();

  const lineSubtotal = invoiceLines.reduce((s, l) => s + Number(l.line_subtotal ?? l.total_price ?? 0), 0);
  const lineTax      = invoiceLines.reduce((s, l) => s + Number(l.line_tax ?? 0), 0);
  const lineTotal    = lineSubtotal + lineTax;

  const count = (s) => invoices.filter(i => i.status === s).length;

  async function recordPayment() {
    if (!selectedId || !payAmount) return;
    setPayLoading(true);
    try {
      await api.post(`/billing/accounts/${selectedId}/payments/`, {
        amount: payAmount, method: payMethod, notes: payNotes,
      });
      setPayAmount(''); setPayNotes('');
      await refreshDrawer(selectedId);
    } catch (e) {
      alert(e?.response?.data?.detail ?? 'Payment failed.');
    } finally {
      setPayLoading(false);
    }
  }

  function openPayModal(inv) {
    setPayModalInv(inv);
    setPayAmount(Number(inv.total).toFixed(2));
    setPayMethod('cash');
    setPayNotes('');
  }

  async function recordInvoicePayment() {
    if (!payModalInv?.member || !payAmount) return;
    setPayLoading(true);
    try {
      await api.post(`/billing/accounts/${payModalInv.member}/payments/`, {
        amount: payAmount, method: payMethod, notes: payNotes,
      });
      setPayModalInv(null);
      setPayAmount('');
      setPayNotes('');
      refetch();
    } catch (e) {
      alert(e?.response?.data?.detail ?? 'Payment failed.');
    } finally {
      setPayLoading(false);
    }
  }

  async function sendInvite(memberId, email) {
    try {
      await api.post(`/billing/accounts/${memberId}/generate-invite/`);
      alert(`Invite sent to ${email}`);
      await refreshDrawer(memberId);
    } catch (e) {
      alert(e?.response?.data?.detail ?? 'Failed to send invite.');
    }
  }

  return (
    <div>
      <div className="tabs">
        {[['invoices','Invoices'],['boater-accounts','Boater Accounts'],['utilities','Utility Meters'],['pos','Fuel Dock POS'],['debtors','Aged Debtors'],['accounts','Accounts']].map(([v,l]) => (
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
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {inv.status !== 'paid' && inv.member && (
                          <button className="btn btn-primary btn-sm" onClick={() => openPayModal(inv)}>
                            Record Payment
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm">{inv.status === 'paid' ? 'View' : 'Chase'}</button>
                      </div>
                    </td>
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
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '32px 0', fontSize: 12 }}>
                    Utility meter readings coming soon — enter readings manually via the berth detail panel.
                  </td>
                </tr>
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
                {posLoading ? (
                  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 8 }}>Loading catalog…</div>
                ) : posCatalog.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 8 }}>
                    No POS items configured. Add items in Settings → Service Catalog and enable "Show in POS".
                  </div>
                ) : posCatalog.map(item => (
                  <div key={item.id}
                    onClick={() => { setPosLitres(''); setPosError(''); setPosSubmitting(false); setSelectedPOSItem(item); }}
                    style={{
                      background: selectedPOSItem?.id === item.id ? 'var(--bg-active, #eef4ff)' : 'var(--bg)',
                      borderRadius: 8, padding: '14px', cursor: 'pointer',
                      border: selectedPOSItem?.id === item.id ? '1.5px solid var(--blue, #0075de)' : 'var(--border)',
                      transition: 'box-shadow 0.1s',
                    }}
                    onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow2)'}
                    onMouseOut={e  => e.currentTarget.style.boxShadow = ''}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.8)' }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: FUEL_COLORS[item.fuel_dock_type] ?? '#888', fontWeight: 600, marginTop: 4 }}>
                      {posPriceLabel(item)}
                    </div>
                  </div>
                ))}
              </div>
              {selectedPOSItem && (
                <div style={{ marginTop: 12, padding: '12px 0 4px', borderTop: 'var(--border)' }}>

                  {/* Member / Guest combobox */}
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 3 }}>
                      Vessel / Member <span style={{ fontWeight: 400 }}>(optional)</span>
                    </div>
                    <input
                      value={posQuery}
                      onChange={handlePosQueryChange}
                      onBlur={() => setTimeout(() => setPosSuggestions([]), 200)}
                      placeholder="Search member or type guest name…"
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px',
                        border: 'var(--border)', borderRadius: 6, outline: 'none',
                        borderColor: posResolved ? 'var(--green, #2a9d50)' : undefined }}
                    />
                    {posResolved && (
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-2px)',
                        color: 'var(--green, #2a9d50)', fontSize: 13, fontWeight: 700 }}>✓</span>
                    )}
                    {posSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                        background: '#fff', border: 'var(--border)', borderRadius: 6,
                        boxShadow: 'var(--shadow2)', marginTop: 2 }}>
                        {posSuggestions.map(m => (
                          <div key={m.id}
                            onMouseDown={() => handlePosSuggestionSelect(m)}
                            style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
                            onMouseOver={e => e.currentTarget.style.background = 'var(--bg)'}
                            onMouseOut={e  => e.currentTarget.style.background = '#fff'}>
                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                            {m.vessels?.[0] && <span style={{ color: 'rgba(0,0,0,0.4)', marginLeft: 6 }}>— {m.vessels[0].name}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Litres input (per_litre items only) */}
                  {selectedPOSItem.pricing_model === 'per_litre' && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 3 }}>Litres</div>
                      <input
                        type="number" min="0" step="0.1"
                        value={posLitres}
                        onChange={e => setPosLitres(e.target.value)}
                        placeholder="0.0"
                        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px',
                          border: 'var(--border)', borderRadius: 6, outline: 'none' }}
                      />
                    </div>
                  )}

                  {/* Total */}
                  {total > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: 10, fontSize: 13 }}>
                      <span style={{ color: 'rgba(0,0,0,0.5)' }}>Total</span>
                      <span style={{ fontWeight: 700 }}>€{total.toFixed(2)}</span>
                    </div>
                  )}

                  {posError && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{posError}</div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={clearPosForm} style={{ flex: 1 }}>Cancel</button>
                    <button
                      className="btn btn-gold"
                      onClick={handleProcessSale}
                      disabled={posSubmitting || total <= 0}
                      style={{ flex: 2, justifyContent: 'center', fontSize: 13, padding: '10px' }}>
                      {posSubmitting ? 'Processing…' : 'Process Sale'}
                    </button>
                  </div>
                </div>
              )}

              {!selectedPOSItem && (
                <button className="btn btn-gold" style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: '10px', marginTop: 12 }} disabled>
                  Select item above
                </button>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><div className="card-header-title">Recent Fuel Sales</div></div>
            <div className="card-body" style={{ padding: 0 }}>
              {fuelLoading ? (
                <div style={{ padding: '16px 18px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
              ) : fuelEntries.length === 0 ? (
                <div style={{ padding: '16px 18px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No completed sales yet.</div>
              ) : fuelEntries.map(e => {
                const name = e.vessel_name ?? e.guest_description ?? '—';
                const litres = e.actual_litres ? `${e.actual_litres}L` : '—';
                const fuelLabel = e.fuel_type === 'pump_out' ? 'Pump-out' : (e.fuel_type ?? '—').charAt(0).toUpperCase() + (e.fuel_type ?? '').slice(1);
                const amount = e.total_amount != null ? `€${Number(e.total_amount).toFixed(2)}` : '—';
                const when = e.completed_at ? new Date(e.completed_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
                return (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: 'var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>{fuelLabel} · {litres} · {when}</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{amount}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'debtors' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Aged Debtor Report</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-red">{debtors.filter(d=>d.daysOverdue>0).length} Overdue</span>
              <button className="btn btn-ghost btn-sm"><Ic n="file" s={11}/>Export</button>
              <button className="btn btn-primary btn-sm">Chase All Overdue</button>
            </div>
          </div>
          <div className="grid-2" style={{ alignItems: 'start', marginBottom: 16 }}>
            {[['0–7 Days',debtors.filter(d=>d.bucket==='0–7').length,'badge-orange'],['8–30 Days',debtors.filter(d=>d.bucket==='8–30').length,'badge-red'],['31–60 Days',debtors.filter(d=>d.bucket==='31–60').length,'badge-red'],['Current / Upcoming',debtors.filter(d=>d.bucket==='current').length,'badge-gray']].map(([l,c,b]) => (
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
                {debtors.map(d => (
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
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6 }}>
                  Generate invoices for all active berth holders in the selected billing period.
                  Re-running is safe — already-invoiced bookings are skipped automatically.
                </div>
                <select value={batchPeriod} onChange={e => setBatchPeriod(e.target.value)}>
                  {batchPeriodOptions.map(o => (
                    <option key={o.val} value={o.val}>{o.label}</option>
                  ))}
                </select>
                <select value={batchMemberType} onChange={e => setBatchMemberType(e.target.value)}>
                  <option value="all">All berth holders</option>
                  <option value="seasonal">Seasonal only</option>
                  <option value="transient">Transient only</option>
                </select>
                <button
                  className="btn btn-primary"
                  style={{ justifyContent: 'center' }}
                  disabled={batchLoading}
                  onClick={runBatch}
                >
                  {batchLoading ? 'Generating…' : 'Generate Batch Invoices'}
                </button>
                {batchResult && !batchResult.error && (
                  <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
                    ✓ Created {batchResult.created} invoice{batchResult.created !== 1 ? 's' : ''}, skipped {batchResult.skipped} (already invoiced)
                  </div>
                )}
                {batchResult?.error && (
                  <div style={{ fontSize: 12, color: 'var(--red)' }}>{batchResult.error}</div>
                )}
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Exports</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }} onClick={exportCSV}>
                  <Ic n="file" s={12}/>All Invoices (CSV)
                </button>
                {[['Debtor Report (PDF)','file'],['Revenue Summary (XLSX)','file'],['Utility Charges (CSV)','file']].map(([l,i]) => (
                  <button key={l} className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8, opacity: 0.45, cursor: 'not-allowed' }} disabled>
                    <Ic n={i} s={12}/>{l} <span style={{ fontSize: 10, marginLeft: 'auto', color: 'rgba(0,0,0,0.35)' }}>Coming soon</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>End-of-Day Z-Report</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <input
                  type="date"
                  value={zDate}
                  onChange={e => setZDate(e.target.value)}
                  style={{ border: 'var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, fontFamily: 'var(--font)' }}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => fetchZReport(zDate)}>Refresh</button>
              </div>
              {zLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>Loading…</div>
              ) : zReport ? (
                <>
                  {zReport.lines.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No POS activity on {zDate}.</div>
                  ) : zReport.lines.map(line => (
                    <div key={line.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                      <span style={{ color: 'rgba(0,0,0,0.55)' }}>{line.label}</span>
                      <span style={{ fontWeight: 700 }}>€{line.total}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
                    <span>Total</span><span>€{zReport.grand_total}</span>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => window.print()}>Print Z-Report</button>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Could not load report.</div>
              )}
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Payment Reconciliation</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: 1.6 }}>
                Automatic bank statement reconciliation is planned for a future release.
                For now, invoices can be marked paid manually via the Invoices tab.
              </div>
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

      {tab === 'boater-accounts' && !selectedId && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Search member name…"
                value={acctSearch}
                onChange={e => setAcctSearch(e.target.value)}
                style={{ border: 'var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font)', width: 220 }}
              />
              <label style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input type="checkbox" checked={acctShowAll} onChange={e => setAcctShowAll(e.target.checked)} />
                Show settled
              </label>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th><th>Type</th><th>Berth</th>
                  <th>Outstanding</th><th>Credit</th>
                  <th>Open Inv.</th><th>Oldest Due</th><th>Portal</th><th></th>
                </tr>
              </thead>
              <tbody>
                {acctLoading ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : accounts.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No outstanding balances.</td></tr>
                ) : accounts.map(a => {
                  const isOverdue = a.oldest_due_date && new Date(a.oldest_due_date) < new Date();
                  return (
                    <tr key={a.member_id}>
                      <td className="tbl-name">{a.name}</td>
                      <td><span className="badge badge-navy">{a.member_type}</span></td>
                      <td style={{ fontSize: 12 }}>{a.berth_code ?? '—'}</td>
                      <td style={{ fontWeight: 700, color: isOverdue ? 'var(--red)' : 'inherit' }}>
                        €{Number(a.total_outstanding).toFixed(2)}
                      </td>
                      <td style={{ fontSize: 12, color: Number(a.credit_on_account) > 0 ? 'var(--green)' : 'rgba(0,0,0,0.35)' }}>
                        {Number(a.credit_on_account) > 0 ? `€${Number(a.credit_on_account).toFixed(2)}` : '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>{a.open_invoice_count}</td>
                      <td style={{ fontSize: 12, color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.45)' }}>
                        {a.oldest_due_date ?? '—'}
                      </td>
                      <td>
                        {a.portal_active
                          ? <span className="badge badge-green">Active</span>
                          : <span className="badge badge-gray">No portal</span>}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => openDrawer(a.member_id)}>
                          View Account →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'boater-accounts' && selectedId && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* Dimmed list behind drawer */}
          <div style={{ flex: 1, opacity: 0.4, pointerEvents: 'none', overflow: 'hidden', maxHeight: 400 }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Name</th><th>Outstanding</th><th>Portal</th></tr></thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.member_id}>
                      <td className="tbl-name">{a.name}</td>
                      <td>€{Number(a.total_outstanding).toFixed(2)}</td>
                      <td>{a.portal_active ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drawer */}
          <div className="card" style={{ width: 480, flexShrink: 0, padding: 24 }}>
            {drawerLoading && !drawerData ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '20px 0', textAlign: 'center' }}>Loading…</div>
            ) : drawerData ? (
              <>
                {/* Header */}
                <div style={{ marginBottom: 18 }}>
                  <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={closeDrawer}>
                    ← Back
                  </button>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{drawerData.member.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                        <span className="badge badge-navy" style={{ marginRight: 6 }}>{drawerData.member.member_type}</span>
                        {drawerData.member.berth_code ?? 'No berth'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>
                        €{Number(drawerData.summary.total_outstanding).toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>outstanding</div>
                      {Number(drawerData.summary.credit_on_account) > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginTop: 4 }}>
                          Credit: €{Number(drawerData.summary.credit_on_account).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                    onClick={() => sendInvite(drawerData.member.id, drawerData.member.email)}
                  >
                    {drawerData.member.portal_active ? 'Re-send Portal Invite' : 'Generate Portal Invite'}
                  </button>
                </div>

                {/* Record Payment form */}
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Record Payment</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      type="number" step="0.01" min="0.01"
                      placeholder="Amount"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      style={{ flex: 1, border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}
                    />
                    <select
                      value={payMethod}
                      onChange={e => setPayMethod(e.target.value)}
                      style={{ border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}
                    >
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cash">Cash</option>
                      <option value="external_card">Card</option>
                    </select>
                  </div>
                  <input
                    placeholder="Notes (optional)"
                    value={payNotes}
                    onChange={e => setPayNotes(e.target.value)}
                    style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    disabled={!payAmount || payLoading}
                    onClick={recordPayment}
                  >
                    {payLoading ? 'Recording…' : 'Record Payment'}
                  </button>
                </div>

                {/* Invoice groups */}
                {(['berth', 'fuel', 'restaurant', 'other']).map(cat => {
                  const catLabels = { berth: 'Berth Fees', fuel: 'Fuel Dock', restaurant: 'Restaurant', other: 'Other' };
                  const catSources = { berth: ['berth','booking'], fuel: ['fuel_dock'], restaurant: ['restaurant_order'], other: [] };
                  const invoices = drawerData.open_invoices.filter(inv =>
                    cat === 'other'
                      ? !['berth','booking','fuel_dock','restaurant_order'].includes(inv.source_type)
                      : catSources[cat].includes(inv.source_type)
                  );
                  if (invoices.length === 0) return null;
                  const catTotal = invoices.reduce((s, inv) => s + Number(inv.total) - Number(inv.amount_paid_so_far), 0);
                  return (
                    <div key={cat} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        <span>{catLabels[cat]}</span>
                        <span>€{catTotal.toFixed(2)}</span>
                      </div>
                      {invoices.map(inv => {
                        const isOverdue = inv.due_date && new Date(inv.due_date) < new Date();
                        const partiallyPaid = Number(inv.amount_paid_so_far) > 0;
                        return (
                          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{inv.invoice_number}</div>
                              <div style={{ fontSize: 11, color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.4)' }}>
                                {inv.due_date ? `Due ${inv.due_date}` : 'No due date'}
                                {isOverdue && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: 9 }}>OVERDUE</span>}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 700 }}>
                                €{(Number(inv.total) - Number(inv.amount_paid_so_far)).toFixed(2)}
                              </div>
                              {partiallyPaid && (
                                <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
                                  €{Number(inv.amount_paid_so_far).toFixed(2)} of €{Number(inv.total).toFixed(2)} paid
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {drawerData.open_invoices.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '20px 0' }}>
                    No outstanding charges.
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Could not load account data.</div>
            )}
          </div>
        </div>
      )}

      {payModalInv && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setPayModalInv(null)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Record Payment</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>
              {payModalInv.invoice_number} · {payModalInv.member_name ?? 'Unknown'} · Invoice total €{Number(payModalInv.total).toFixed(2)}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>AMOUNT RECEIVED (€)</div>
              <input
                type="number" step="0.01" min="0.01" autoFocus
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>PAYMENT METHOD</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[['cash', 'Cash'], ['external_card', 'Card'], ['bank_transfer', 'Bank Transfer']].map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setPayMethod(v)}
                    style={{
                      padding: '10px 4px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: payMethod === v ? '2px solid var(--navy)' : '1px solid rgba(0,0,0,0.15)',
                      background: payMethod === v ? 'var(--navy)' : '#fff',
                      color: payMethod === v ? '#fff' : 'rgba(0,0,0,0.6)',
                    }}
                  >{l}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>NOTES (optional)</div>
              <input
                placeholder="e.g. Cash received, ref: 0042"
                value={payNotes}
                onChange={e => setPayNotes(e.target.value)}
                style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPayModalInv(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2, justifyContent: 'center', fontSize: 13 }}
                disabled={!payAmount || parseFloat(payAmount) <= 0 || payLoading}
                onClick={recordInvoicePayment}
              >
                {payLoading
                  ? 'Recording…'
                  : `Record ${payMethod === 'cash' ? 'Cash' : payMethod === 'external_card' ? 'Card' : 'Bank Transfer'} — €${Number(payAmount || 0).toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
