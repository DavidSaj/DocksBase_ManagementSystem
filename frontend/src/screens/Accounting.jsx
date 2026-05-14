import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

// ── Helpers ────────────────────────────────────────────────────────────────

const LABEL = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  display: 'block', marginBottom: 4,
};

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 460, padding: 24, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Ic n="x" s={12} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function fmt(val, currency = '') {
  if (val == null) return '—';
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

function fmtDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Status badge ──────────────────────────────────────────────────────────

const BADGE_CLASS = {
  true:        'badge-green',
  false:       'badge-orange',
  asset:       'badge-blue',
  liability:   'badge-red',
  equity:      'badge-purple',
  revenue:     'badge-green',
  expense:     'badge-orange',
  active:      'badge-green',
  inactive:    'badge-gray',
  draft:       'badge-blue',
  matched:     'badge-green',
  discrepancy: 'badge-orange',
  approved:    'badge-purple',
  paid:        'badge-teal',
  disputed:    'badge-red',
  void:        'badge-gray',
  completed:   'badge-teal',
  cancelled:   'badge-gray',
  paused:      'badge-orange',
  ok:          'badge-green',
  error:       'badge-red',
  skipped:     'badge-gray',
  pending:     'badge-orange',
};

const STATUS_LABELS = {
  true: 'Posted', false: 'Draft',
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expense',
  active: 'Active', inactive: 'Inactive',
  draft: 'Draft', matched: 'Matched', discrepancy: 'Discrepancy',
  approved: 'Approved', paid: 'Paid', disputed: 'Disputed', void: 'Void',
  completed: 'Completed', cancelled: 'Cancelled', paused: 'Paused',
  ok: 'OK', error: 'Error', skipped: 'Skipped', pending: 'Pending',
};

function Badge({ value, label }) {
  const key = value === true ? true : value === false ? false : value;
  const cls = BADGE_CLASS[key] ?? 'badge-gray';
  const txt = STATUS_LABELS[key] ?? label ?? String(value);
  return <span className={`badge ${cls}`}>{txt}</span>;
}

// ── Loading / empty states ─────────────────────────────────────────────────

function LoadingRow({ cols }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: 'center', padding: '32px 16px', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
        Loading…
      </td>
    </tr>
  );
}

function EmptyRow({ cols, message = 'No records found.' }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: 'center', padding: '32px 16px', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
        {message}
      </td>
    </tr>
  );
}


// ── 1. Journal tab ─────────────────────────────────────────────────────────

function JournalTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceType, setSourceType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (sourceType) params.source_type = sourceType;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await api.get('/journal-entries/', { params });
      setEntries(data.results ?? data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [sourceType, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const SOURCE_LABELS = {
    invoice: 'Invoice', payment: 'Payment', credit_note: 'Credit Note',
    deferred_recognition: 'Deferred Recognition', ap_invoice: 'AP Invoice',
    ap_payment: 'AP Payment', manual: 'Manual Journal', fx_revaluation: 'FX Revaluation',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div className="card">
        <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={LABEL}>Source Type</label>
            <select
              className="input"
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">All types</option>
              {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={LABEL}>Date From</label>
            <input
              type="date" className="input"
              value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={LABEL}>Date To</label>
            <input
              type="date" className="input"
              value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <button className="btn btn-sm btn-primary" onClick={load}>
              Filter
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Journal Entries</div>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>General ledger — double-entry</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Date</th>
                <th>Source</th>
                <th>Description</th>
                <th>Currency</th>
                <th>FX Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={7} />
              ) : entries.length === 0 ? (
                <EmptyRow cols={7} message="No journal entries found." />
              ) : entries.map(je => (
                <tr key={je.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>
                    {je.reference || `JE-${je.id}`}
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtDate(je.entry_date)}</td>
                  <td><Badge value={je.source_type} label={SOURCE_LABELS[je.source_type] ?? je.source_type} /></td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', maxWidth: 260 }}>
                    {je.description || '—'}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{je.currency}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{je.fx_rate === '1.000000' || je.fx_rate === 1 ? '1.00' : je.fx_rate}</td>
                  <td><Badge value={je.is_posted} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 2. Accounts (Chart of Accounts) tab ──────────────────────────────────

function AccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'revenue' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    api.get('/accounts/')
      .then(r => setAccounts(r.data.results ?? r.data))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }, []);

  function openForm() {
    setForm({ code: '', name: '', account_type: 'revenue' });
    setFormError('');
    setShowForm(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const { data } = await api.post('/accounts/', form);
      setAccounts(prev => [data, ...prev]);
      setShowForm(false);
    } catch (err) {
      const d = err?.response?.data;
      setFormError(d?.detail ?? Object.values(d ?? {}).flat().join(' ') ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const filtered = typeFilter ? accounts.filter(a => a.account_type === typeFilter) : accounts;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="filter-row">
          {['', 'asset', 'liability', 'equity', 'revenue', 'expense'].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`btn btn-sm${typeFilter === t ? ' btn-primary' : ''}`}
            >
              {t ? t.charAt(0).toUpperCase() + t.slice(1) : 'All'}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={openForm}>
          <Ic n="plus" s={12} /> Add Account
        </button>
      </div>

      {showForm && (
        <Modal title="New Account" onClose={() => setShowForm(false)}>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={LABEL}>Code</label>
              <input
                className="input"
                placeholder="4100"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                required
                autoFocus
                style={{ marginTop: 4, width: '100%' }}
              />
            </div>
            <div>
              <label style={LABEL}>Name</label>
              <input
                className="input"
                placeholder="Berth Revenue"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                style={{ marginTop: 4, width: '100%' }}
              />
            </div>
            <div>
              <label style={LABEL}>Type</label>
              <select
                className="input"
                value={form.account_type}
                onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}
                style={{ marginTop: 4, width: '100%' }}
              >
                {['asset', 'liability', 'equity', 'revenue', 'expense'].map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            {formError && (
              <div style={{ fontSize: 12, color: '#b91c1c', background: '#fff5f5', borderRadius: 6, padding: '8px 12px' }}>{formError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Saving…' : 'Create Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Chart of Accounts</div>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{accounts.length} accounts</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Cost Centre</th>
                <th>External Code</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={6} />
              ) : filtered.length === 0 ? (
                <EmptyRow cols={6} message="No accounts found." />
              ) : filtered.map(a => (
                <tr key={a.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{a.code}</td>
                  <td style={{ fontSize: 13 }}>{a.name}</td>
                  <td><Badge value={a.account_type} /></td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                    {a.cost_centre_name ?? a.cost_centre ?? '—'}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                    {a.external_code || '—'}
                  </td>
                  <td><Badge value={a.is_active ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 3. Cost Centres tab ───────────────────────────────────────────────────

function CostCentresTab() {
  const [centres, setCentres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api.get('/cost-centres/')
      .then(r => setCentres(r.data.results ?? r.data))
      .catch(() => setCentres([]))
      .finally(() => setLoading(false));
  }, []);

  function openForm() {
    setForm({ code: '', name: '' });
    setFormError('');
    setShowForm(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const { data } = await api.post('/cost-centres/', form);
      setCentres(prev => [...prev, data]);
      setShowForm(false);
    } catch (err) {
      const d = err?.response?.data;
      setFormError(d?.detail ?? Object.values(d ?? {}).flat().join(' ') ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-sm" onClick={openForm}>
          <Ic n="plus" s={12} /> Add Cost Centre
        </button>
      </div>

      {showForm && (
        <Modal title="New Cost Centre" onClose={() => setShowForm(false)}>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={LABEL}>Code</label>
              <input
                className="input"
                placeholder="FUEL"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                required
                autoFocus
                style={{ marginTop: 4, width: '100%' }}
              />
            </div>
            <div>
              <label style={LABEL}>Name</label>
              <input
                className="input"
                placeholder="Fuel Dock"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                style={{ marginTop: 4, width: '100%' }}
              />
            </div>
            {formError && (
              <div style={{ fontSize: 12, color: '#b91c1c', background: '#fff5f5', borderRadius: 6, padding: '8px 12px' }}>{formError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Saving…' : 'Create Cost Centre'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Cost Centres</div>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>P&L department groupings</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={3} />
              ) : centres.length === 0 ? (
                <EmptyRow cols={3} message="No cost centres configured. Add one above." />
              ) : centres.map(cc => (
                <tr key={cc.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{cc.code}</td>
                  <td style={{ fontSize: 13 }}>{cc.name}</td>
                  <td><Badge value={cc.is_active ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 4. Payables tab (Suppliers / POs / AP Invoices) ───────────────────────

function PayablesTab() {
  const [subTab, setSubTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [pos, setPos] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = statusFilter ? { status: statusFilter } : {};
    Promise.all([
      api.get('/ap-invoices/', { params }),
      api.get('/purchase-orders/'),
      api.get('/suppliers/'),
    ])
      .then(([inv, po, sup]) => {
        setInvoices(inv.data.results ?? inv.data);
        setPos(po.data.results ?? po.data);
        setSuppliers(sup.data.results ?? sup.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const PO_STATUS_CLASS = {
    open:     'badge-blue',
    received: 'badge-green',
    invoiced: 'badge-purple',
    closed:   'badge-gray',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="tabs">
        {[['invoices', 'AP Invoices'], ['purchase-orders', 'Purchase Orders']].map(([t, label]) => (
          <div key={t} className={`tab${subTab === t ? ' active' : ''}`} onClick={() => setSubTab(t)}>
            {label}
          </div>
        ))}
      </div>

      {subTab === 'invoices' && (
        <>
          {/* Status filter */}
          <div className="filter-row">
            {['', 'draft', 'discrepancy', 'approved', 'paid', 'disputed', 'void'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`btn btn-sm${statusFilter === s ? ' btn-primary' : ''}`}
              >
                {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-header-title">AP Invoices</div>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>Supplier invoices — three-way match</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Supplier</th>
                    <th>Invoice Date</th>
                    <th>Due Date</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Match</th>
                    <th>OCR Source</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <LoadingRow cols={8} />
                  ) : invoices.length === 0 ? (
                    <EmptyRow cols={8} message="No AP invoices found." />
                  ) : invoices.map(inv => (
                    <tr key={inv.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                        {inv.supplier_invoice_number || `AP-${inv.id}`}
                      </td>
                      <td style={{ fontSize: 13 }}>{inv.supplier_name ?? inv.supplier ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(inv.invoice_date)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(inv.due_date)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                        {fmt(inv.total_amount, inv.currency)}
                      </td>
                      <td><Badge value={inv.status} /></td>
                      <td>
                        {inv.match_status ? (
                          <span className={`badge ${inv.match_status === 'ok' ? 'badge-green' : inv.match_status === 'no_po' ? 'badge-gray' : 'badge-orange'}`}>
                            {inv.match_status === 'ok' ? 'Matched' : inv.match_status === 'no_po' ? 'No PO' : 'Variance'}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                        {inv.ocr_service || '—'}
                        {inv.ocr_confidence != null && (
                          <span style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)' }}>
                            ({parseFloat(inv.ocr_confidence).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {subTab === 'purchase-orders' && (
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Purchase Orders</div>
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>Three-way match source documents</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Supplier</th>
                  <th>Issue Date</th>
                  <th>Expected Delivery</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <LoadingRow cols={6} />
                ) : pos.length === 0 ? (
                  <EmptyRow cols={6} message="No purchase orders found." />
                ) : pos.map(po => (
                  <tr key={po.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                      PO-{po.po_number}
                    </td>
                    <td style={{ fontSize: 13 }}>{po.supplier_name ?? po.supplier ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(po.issue_date)}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(po.expected_delivery)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                      {fmt(po.total_amount)}
                    </td>
                    <td>
                      <span className={`badge ${PO_STATUS_CLASS[po.status] ?? 'badge-gray'}`}>
                        {po.status.charAt(0).toUpperCase() + po.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 5. Suppliers tab ───────────────────────────────────────────────────────

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/suppliers/')
      .then(r => setSuppliers(r.data.results ?? r.data))
      .catch(() => setSuppliers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Suppliers</div>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{suppliers.length} suppliers</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact Email</th>
              <th>Payment Terms</th>
              <th>External ID</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRow cols={5} />
            ) : suppliers.length === 0 ? (
              <EmptyRow cols={5} message="No suppliers configured." />
            ) : suppliers.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</td>
                <td style={{ fontSize: 12 }}>
                  {s.contact_email
                    ? <a href={`mailto:${s.contact_email}`} style={{ color: 'var(--teal, #009688)' }}>{s.contact_email}</a>
                    : '—'
                  }
                </td>
                <td style={{ fontSize: 12 }}>{s.payment_terms ? `${s.payment_terms} days` : '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                  {s.external_id || '—'}
                </td>
                <td><Badge value={s.is_active ? 'active' : 'inactive'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 6. Sync tab ───────────────────────────────────────────────────────────

function SyncTab() {
  const [syncRecords, setSyncRecords] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/accounting-sync/'),
      api.get('/exchange-rates/'),
    ])
      .then(([sync, fx]) => {
        setSyncRecords(sync.data.results ?? sync.data);
        setRates(fx.data.results ?? fx.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const DIRECTION_LABELS = { push: 'Push', pull: 'Pull' };
  const OBJ_LABELS = {
    invoice: 'Invoice', payment: 'Payment', gl_entry: 'GL Entry',
    contact: 'Contact', account: 'Account',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Exchange Rates summary */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Exchange Rates</div>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>Latest daily FX snapshots</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Rate</th>
                <th>Date</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={4} />
              ) : rates.length === 0 ? (
                <EmptyRow cols={4} message="No exchange rates recorded." />
              ) : rates.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>
                    {r.from_currency}/{r.to_currency}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.rate}</td>
                  <td style={{ fontSize: 12 }}>{fmtDate(r.rate_date)}</td>
                  <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>
                    {r.source || 'manual'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Accounting Sync Log */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Accounting Integration Sync Log</div>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            Recent push/pull events to external accounting systems
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Platform</th>
                <th>Direction</th>
                <th>Object Type</th>
                <th>Local ID</th>
                <th>External ID</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRow cols={8} />
              ) : syncRecords.length === 0 ? (
                <EmptyRow cols={8} message="No sync events recorded. Connect an accounting platform to start syncing." />
              ) : syncRecords.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
                    {r.synced_at ? new Date(r.synced_at).toLocaleString(undefined, {
                      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    }) : '—'}
                  </td>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>
                    {r.platform ?? r.config_platform ?? '—'}
                  </td>
                  <td>
                    <span className={`badge ${r.direction === 'push' ? 'badge-blue' : 'badge-purple'}`}>
                      {DIRECTION_LABELS[r.direction] ?? r.direction}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{OBJ_LABELS[r.object_type] ?? r.object_type}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.local_id}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                    {r.external_id || '—'}
                  </td>
                  <td><Badge value={r.status} /></td>
                  <td style={{ fontSize: 11, color: '#c62828', maxWidth: 180 }}>
                    {r.error_detail
                      ? <span title={r.error_detail}>{r.error_detail.slice(0, 60)}{r.error_detail.length > 60 ? '…' : ''}</span>
                      : <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Surcharge Rules info section */}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '14px 16px' }}>
          <SurchargeRulesSummary />
        </div>
      </div>
    </div>
  );
}

function SurchargeRulesSummary() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/surcharge-rules/')
      .then(r => setRules(r.data.results ?? r.data))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading surcharge rules…</div>;
  if (rules.length === 0) return (
    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No surcharge rules configured.</div>
  );

  return (
    <div>
      <div className="stat-label" style={{ marginBottom: 8 }}>
        Surcharge Rules ({rules.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {rules.map(r => (
          <span key={r.id} className={`badge ${r.is_active ? 'badge-blue' : 'badge-gray'}`}>
            {r.name}
            <span style={{ marginLeft: 6, opacity: 0.7 }}>
              {r.amount_type === 'percentage' ? `${r.amount}%` : fmt(r.amount)} · {r.trigger_type?.replace('_', ' ')}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

const TABS = [
  ['journal',      'Journal'],
  ['accounts',     'Accounts'],
  ['cost-centres', 'Cost Centres'],
  ['payables',     'Payables'],
  ['suppliers',    'Suppliers'],
  ['sync',         'Sync'],
];

export default function Accounting() {
  const [tab, setTab] = useState('journal');

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy, #1a2d4a)' }}>
          Financial Accounting
        </div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
          General ledger, chart of accounts, cost centres, AP workflow, and accounting integration sync
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([id, label]) => (
          <div key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>

      {tab === 'journal'       && <JournalTab />}
      {tab === 'accounts'      && <AccountsTab />}
      {tab === 'cost-centres'  && <CostCentresTab />}
      {tab === 'payables'      && <PayablesTab />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'sync'      && <SyncTab />}
    </div>
  );
}
