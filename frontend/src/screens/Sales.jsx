import { useState } from 'react';
import { useListings, useLeads } from '../hooks/useSales.js';
import Ic from '../components/ui/Icon.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

const TABS = [
  ['inventory', 'Inventory'],
  ['pipeline',  'Pipeline'],
  ['brokerage', 'Brokerage'],
];

const listSt = {
  active:      'badge-green',
  under_offer: 'badge-gold',
  sold:        'badge-navy',
  withdrawn:   'badge-gray',
};

const listLabel = {
  active:      'Active',
  under_offer: 'Under Offer',
  sold:        'Sold',
  withdrawn:   'Withdrawn',
};

const stageSt = {
  new:               'badge-gray',
  contacted:         'badge-blue',
  viewing_scheduled: 'badge-teal',
  viewing_completed: 'badge-gold',
  offer_made:        'badge-orange',
  sale_agreed:       'badge-navy',
};

const stageLabel = {
  new:               'New Enquiry',
  contacted:         'Contacted',
  viewing_scheduled: 'Viewing Scheduled',
  viewing_completed: 'Viewed',
  offer_made:        'Under Offer',
  sale_agreed:       'Sale Agreed',
};

function fmt(n) {
  if (n == null) return '—';
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0 });
}

// ── New Listing modal ────────────────────────────────────────────────────────

const BLANK_LISTING = {
  name: '', vessel_type: 'motor', make: '', model: '', loa: '', year: '',
  price: '', commission_pct: '10', location: '', status: 'active',
};

function NewListingForm({ onCreate, onClose }) {
  const [form, setForm] = useState(BLANK_LISTING);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreate({
        ...form,
        loa: form.loa ? Number(form.loa) : null,
        year: form.year ? Number(form.year) : null,
        price: Number(form.price),
        commission_pct: Number(form.commission_pct),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Vessel Name / Listing Title</label>
          <input required value={form.name} onChange={set('name')} placeholder="e.g. Moody 38 — Sunseeker" />
        </div>
        <div>
          <label style={lbl}>Type</label>
          <select value={form.vessel_type} onChange={set('vessel_type')}>
            <option value="motor">Motor</option>
            <option value="sail">Sail</option>
            <option value="catamaran">Catamaran</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="under_offer">Under Offer</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
        <div><label style={lbl}>Make</label><input value={form.make} onChange={set('make')} placeholder="e.g. Moody" /></div>
        <div><label style={lbl}>Model</label><input value={form.model} onChange={set('model')} placeholder="e.g. 38" /></div>
        <div><label style={lbl}>LOA (m)</label><input type="number" step="0.1" min="0" value={form.loa} onChange={set('loa')} placeholder="12.5" /></div>
        <div><label style={lbl}>Year</label><input type="number" min="1900" max="2100" value={form.year} onChange={set('year')} placeholder="2018" /></div>
        <div><label style={lbl}>Asking Price (£)</label><input required type="number" min="0" step="1" value={form.price} onChange={set('price')} placeholder="45000" /></div>
        <div><label style={lbl}>Commission (%)</label><input required type="number" min="0" max="100" step="0.5" value={form.commission_pct} onChange={set('commission_pct')} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Location</label><input value={form.location} onChange={set('location')} placeholder="e.g. Berth A4" /></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Listing'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

// ── New Lead modal ───────────────────────────────────────────────────────────

const BLANK_LEAD = {
  name: '', contact: '', listing: '', budget: '', stage: 'new', source: 'other', notes: '',
};

function NewLeadForm({ listings, onCreate, onClose }) {
  const [form, setForm] = useState(BLANK_LEAD);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreate({
        ...form,
        listing: form.listing ? Number(form.listing) : null,
        budget: form.budget ? Number(form.budget) : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div><label style={lbl}>Prospect Name</label><input required value={form.name} onChange={set('name')} placeholder="Full name" /></div>
        <div><label style={lbl}>Contact (email/phone)</label><input value={form.contact} onChange={set('contact')} placeholder="email or phone" /></div>
        <div>
          <label style={lbl}>Interested In</label>
          <select value={form.listing} onChange={set('listing')}>
            <option value="">— No specific listing —</option>
            {listings.filter(l => l.status === 'active' || l.status === 'under_offer').map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div><label style={lbl}>Budget (£)</label><input type="number" min="0" value={form.budget} onChange={set('budget')} placeholder="50000" /></div>
        <div>
          <label style={lbl}>Stage</label>
          <select value={form.stage} onChange={set('stage')}>
            {Object.entries(stageLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Source</label>
          <select value={form.source} onChange={set('source')}>
            <option value="website">Website</option>
            <option value="referral">Referral</option>
            <option value="walk_in">Walk-in</option>
            <option value="broker">Broker</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Notes</label>
          <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Any details about the enquiry…" style={{ resize: 'vertical' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Enquiry'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

const lbl = { fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 };

// ── Inventory tab ────────────────────────────────────────────────────────────

function InventoryTab() {
  const { listings, loading, error, createListing, updateListing } = useListings();
  const [sel, setSel]         = useState(null);
  const [showNew, setShowNew] = useState(false);

  if (loading) return <div className="empty"><div className="empty-title">Loading listings…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load listings.</div></div>;

  const active      = listings.filter(l => l.status === 'active').length;
  const underOffer  = listings.filter(l => l.status === 'under_offer').length;
  const totalValue  = listings.filter(l => l.status !== 'sold').reduce((s, l) => s + Number(l.price), 0);
  const selectedListing = listings.find(l => l.id === sel);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          ['Active Listings', active,    'badge-green'],
          ['Under Offer',     underOffer, 'badge-gold'],
          ['Total Asking',    '£' + (totalValue / 1000).toFixed(0) + 'k', 'badge-blue'],
        ].map(([l, v, b]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: 'var(--border)', borderRadius: 8, padding: '8px 14px' }}>
            <span className={`badge ${b}`}>{v}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.6)' }}>{l}</span>
          </div>
        ))}
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowNew(v => !v)}>
          <Ic n="plus" s={12} />{showNew ? 'Cancel' : 'New Listing'}
        </button>
      </div>

      {showNew && <NewListingForm onCreate={createListing} onClose={() => setShowNew(false)} />}

      {listings.length === 0 ? (
        <div className="empty"><div className="empty-title">No listings yet</div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedListing ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="card">
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Vessel</th>
                  <th>Type</th>
                  <th>LOA</th>
                  <th>Year</th>
                  <th>Asking Price</th>
                  <th>Days Listed</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map(l => (
                  <tr key={l.id} onClick={() => setSel(sel === l.id ? null : l.id)} style={{ cursor: 'pointer', background: sel === l.id ? '#fafaf9' : undefined }}>
                    <td>
                      <div className="tbl-name">{l.name}</div>
                      <div className="tbl-sub">{[l.make, l.model].filter(Boolean).join(' ')}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{l.vessel_type}</td>
                    <td style={{ fontSize: 12 }}>{l.loa ? `${l.loa}m` : '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.year || '—'}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{fmt(l.price)}</td>
                    <td style={{ fontSize: 12 }}>{l.days_listed != null ? `${l.days_listed}d` : '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.location || '—'}</td>
                    <td><span className={`badge ${listSt[l.status] || 'badge-gray'}`}>{listLabel[l.status] || l.status}</span></td>
                    <td><button className="btn btn-ghost btn-sm" onClick={e => e.stopPropagation()}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedListing && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div className="detail-title">{selectedListing.name}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
              </div>
              <div className="detail-sub">{[selectedListing.make, selectedListing.model, selectedListing.year].filter(Boolean).join(' · ')}</div>
              <span className={`badge ${listSt[selectedListing.status]}`} style={{ marginBottom: 14, display: 'inline-block' }}>{listLabel[selectedListing.status]}</span>
              <div style={{ marginTop: 8 }}>
                {[
                  ['Type',         selectedListing.vessel_type],
                  ['LOA',          selectedListing.loa ? `${selectedListing.loa}m` : '—'],
                  ['Year Built',   selectedListing.year || '—'],
                  ['Asking Price', fmt(selectedListing.price)],
                  ['Commission',   `${selectedListing.commission_pct}%`],
                  ['Est. Comm.',   fmt(selectedListing.est_commission)],
                  ['Owner',        selectedListing.owner_name || '—'],
                  ['Location',     selectedListing.location || '—'],
                  ['Days Listed',  selectedListing.days_listed != null ? `${selectedListing.days_listed} days` : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                ))}
                {selectedListing.highlights?.length > 0 && (
                  <div style={{ marginTop: 10, padding: '10px 0', borderTop: 'var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Highlights</div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: 'rgba(0,0,0,0.6)', lineHeight: 1.8 }}>
                      {selectedListing.highlights.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <div className="detail-actions">
                {selectedListing.status === 'active' && (
                  <button className="btn btn-primary" style={{ justifyContent: 'center' }}
                    onClick={() => updateListing(selectedListing.id, { status: 'under_offer' })}>
                    Mark Under Offer
                  </button>
                )}
                {selectedListing.status === 'under_offer' && (
                  <button className="btn btn-primary" style={{ justifyContent: 'center' }}
                    onClick={() => updateListing(selectedListing.id, { status: 'sold' }).then(() => setSel(null))}>
                    Mark Sold
                  </button>
                )}
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Generate Contract</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pipeline tab ─────────────────────────────────────────────────────────────

const STAGE_NEXT = {
  new:               { label: 'Mark Contacted',       next: 'contacted' },
  contacted:         { label: 'Schedule Viewing',      next: 'viewing_scheduled' },
  viewing_scheduled: { label: 'Viewing Completed',     next: 'viewing_completed' },
  viewing_completed: { label: 'Record Offer',          next: 'offer_made' },
  offer_made:        { label: 'Mark Sale Agreed',      next: 'sale_agreed' },
};

function PipelineTab() {
  const { listings } = useListings();
  const { leads, loading, error, createLead, updateLead } = useLeads();
  const [sel, setSel]         = useState(null);
  const [showNew, setShowNew] = useState(false);

  if (loading) return <div className="empty"><div className="empty-title">Loading pipeline…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load pipeline.</div></div>;

  const selectedLead = leads.find(l => l.id === sel);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          ['Total Leads',  leads.length,                                      'badge-blue'],
          ['Under Offer',  leads.filter(l => l.stage === 'offer_made').length, 'badge-orange'],
          ['Sale Agreed',  leads.filter(l => l.stage === 'sale_agreed').length,'badge-navy'],
        ].map(([l, v, b]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: 'var(--border)', borderRadius: 8, padding: '8px 14px' }}>
            <span className={`badge ${b}`}>{v}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.6)' }}>{l}</span>
          </div>
        ))}
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowNew(v => !v)}>
          <Ic n="plus" s={12} />{showNew ? 'Cancel' : 'Log Enquiry'}
        </button>
      </div>

      {showNew && <NewLeadForm listings={listings} onCreate={createLead} onClose={() => setShowNew(false)} />}

      {leads.length === 0 ? (
        <div className="empty"><div className="empty-title">No enquiries yet</div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedLead ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="card">
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Prospect</th>
                  <th>Listing</th>
                  <th>Budget</th>
                  <th>Stage</th>
                  <th>Source</th>
                  <th>Last Contact</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id} onClick={() => setSel(sel === lead.id ? null : lead.id)} style={{ cursor: 'pointer', background: sel === lead.id ? '#fafaf9' : undefined }}>
                    <td>
                      <div className="tbl-name">{lead.name}</div>
                      <div className="tbl-sub">{lead.contact}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{lead.listing_name || '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmt(lead.budget)}</td>
                    <td><span className={`badge ${stageSt[lead.stage] || 'badge-gray'}`}>{stageLabel[lead.stage] || lead.stage}</span></td>
                    <td style={{ fontSize: 12 }}>{lead.source?.replace('_', ' ')}</td>
                    <td style={{ fontSize: 12 }}>{lead.last_contact || '—'}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={e => e.stopPropagation()}>Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedLead && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div className="detail-title">{selectedLead.name}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
              </div>
              <div className="detail-sub">{selectedLead.contact}</div>
              <span className={`badge ${stageSt[selectedLead.stage]}`} style={{ marginBottom: 14, display: 'inline-block' }}>{stageLabel[selectedLead.stage]}</span>
              <div style={{ marginTop: 8 }}>
                {[
                  ['Listing',      selectedLead.listing_name || '—'],
                  ['Budget',       fmt(selectedLead.budget)],
                  ['Source',       selectedLead.source?.replace('_', ' ') || '—'],
                  ['Created',      selectedLead.created_at ? new Date(selectedLead.created_at).toLocaleDateString('en-GB') : '—'],
                  ['Last Contact', selectedLead.last_contact || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                ))}
                {selectedLead.notes && (
                  <div style={{ marginTop: 10, padding: '10px 0', borderTop: 'var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Notes</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>{selectedLead.notes}</div>
                  </div>
                )}
              </div>
              <div className="detail-actions">
                {STAGE_NEXT[selectedLead.stage] && (
                  <button className="btn btn-primary" style={{ justifyContent: 'center' }}
                    onClick={() => updateLead(selectedLead.id, { stage: STAGE_NEXT[selectedLead.stage].next })}>
                    {STAGE_NEXT[selectedLead.stage].label}
                  </button>
                )}
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Log Activity</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Brokerage tab ─────────────────────────────────────────────────────────────

function BrokerageTab() {
  const { listings, loading, error } = useListings();

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load data.</div></div>;

  const activeAgreements = listings.filter(l => l.status !== 'sold' && l.status !== 'withdrawn');
  const commissionHeld   = activeAgreements.reduce((s, l) => s + Number(l.est_commission || 0), 0);

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Brokerage Agreements</div>
        <button className="btn btn-primary btn-sm"><Ic n="plus" s={12} /> New Agreement</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Active Agreements', value: activeAgreements.length,  sub: 'Vessels currently listed', badge: 'badge-green' },
          { label: 'Commission Held',   value: fmt(commissionHeld),      sub: 'Estimated at asking price', badge: 'badge-gold' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', marginBottom: 2 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {listings.length === 0 ? (
        <div className="empty"><div className="empty-title">No listings yet</div></div>
      ) : (
        <div className="card">
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Listing</th>
                <th>Owner</th>
                <th>Type</th>
                <th>Asking Price</th>
                <th>Commission</th>
                <th>Est. Commission</th>
                <th>Days Listed</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map(l => (
                <tr key={l.id}>
                  <td>
                    <div className="tbl-name">{l.name}</div>
                    <div className="tbl-sub">{[l.make, l.model, l.loa ? `${l.loa}m` : null].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{l.owner_name || '—'}</td>
                  <td style={{ fontSize: 12 }}>{l.vessel_type}</td>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>{fmt(l.price)}</td>
                  <td style={{ fontSize: 12 }}>{l.commission_pct}%</td>
                  <td style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>{fmt(l.est_commission)}</td>
                  <td style={{ fontSize: 12 }}>{l.days_listed != null ? `${l.days_listed}d` : '—'}</td>
                  <td><span className={`badge ${listSt[l.status] || 'badge-gray'}`}>{listLabel[l.status] || l.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm">Agreement</button>
                      <button className="btn btn-ghost btn-sm">Disburse</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Sales() {
  const [tab, setTab] = useState('inventory');

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Boat sales inventory, CRM pipeline, and brokerage listings."
        infoBody={SCREEN_INFO.sales}
      />
      <div className="tabs">
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'pipeline'  && <PipelineTab />}
      {tab === 'brokerage' && <BrokerageTab />}
    </div>
  );
}
