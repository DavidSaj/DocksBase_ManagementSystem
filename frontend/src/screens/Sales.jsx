import { useState } from 'react';
import { LISTINGS, LEADS } from '../data/mock.js';
import Ic from '../components/ui/Icon.jsx';

const TABS = [
  ['inventory', 'Inventory'],
  ['pipeline',  'Pipeline'],
  ['brokerage', 'Brokerage'],
];

const listSt = {
  'active':      'badge-green',
  'under-offer': 'badge-gold',
  'sold':        'badge-navy',
  'withdrawn':   'badge-gray',
};

const stageSt = {
  'new':               'badge-gray',
  'contacted':         'badge-blue',
  'viewing-scheduled': 'badge-teal',
  'viewing-completed': 'badge-gold',
  'under-offer':       'badge-orange',
  'sale-agreed':       'badge-navy',
  'completed':         'badge-green',
};

const stageLabel = {
  'new':               'New Enquiry',
  'contacted':         'Contacted',
  'viewing-scheduled': 'Viewing Scheduled',
  'viewing-completed': 'Viewed',
  'under-offer':       'Under Offer',
  'sale-agreed':       'Sale Agreed',
  'completed':         'Completed',
};

function fmt(n) {
  return '£' + n.toLocaleString('en-GB');
}

export default function Sales() {
  const [tab, setTab] = useState('inventory');
  const [sel, setSel] = useState(null);

  const activeListings = LISTINGS.filter(l => l.status === 'active').length;
  const totalValue     = LISTINGS.filter(l => l.status !== 'sold').reduce((s, l) => s + l.price, 0);
  const underOffer     = LISTINGS.filter(l => l.status === 'under-offer').length;

  const selectedLead    = LEADS.find(l => l.id === sel);
  const selectedListing = LISTINGS.find(l => l.id === sel);

  return (
    <div>
      <div className="tabs">
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => { setTab(v); setSel(null); }}>{l}</div>
        ))}
      </div>

      {/* ── Inventory ───────────────────────────────────────────────── */}
      {tab === 'inventory' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              ['Active Listings', activeListings, 'badge-green'],
              ['Under Offer',     underOffer,     'badge-gold'],
              ['Total Asking',    '£' + (totalValue / 1000).toFixed(0) + 'k', 'badge-blue'],
            ].map(([l, v, b]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: 'var(--border)', borderRadius: 8, padding: '8px 14px' }}>
                <span className={`badge ${b}`}>{v}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.6)' }}>{l}</span>
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }}><Ic n="plus" s={12} /> New Listing</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: selectedListing ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
            <div className="card">
              <table className="tbl" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>ID</th>
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
                  {LISTINGS.map(l => (
                    <tr key={l.id} onClick={() => setSel(sel === l.id ? null : l.id)} style={{ cursor: 'pointer', background: sel === l.id ? '#fafaf9' : undefined }}>
                      <td style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>{l.id}</td>
                      <td>
                        <div className="tbl-name">{l.name}</div>
                        <div className="tbl-sub">{l.make} {l.model}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{l.type}</td>
                      <td style={{ fontSize: 12 }}>{l.loa}</td>
                      <td style={{ fontSize: 12 }}>{l.year}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{fmt(l.price)}</td>
                      <td style={{ fontSize: 12 }}>{l.status === 'sold' ? '—' : `${l.daysListed}d`}</td>
                      <td style={{ fontSize: 12 }}>{l.location}</td>
                      <td><span className={`badge ${listSt[l.status] || 'badge-gray'}`}>{l.status.replace('-', ' ')}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); }}>Edit</button>
                        </div>
                      </td>
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
                <div className="detail-sub">{selectedListing.make} {selectedListing.model} · {selectedListing.year}</div>
                <span className={`badge ${listSt[selectedListing.status]}`} style={{ marginBottom: 14, display: 'inline-block' }}>{selectedListing.status.replace('-', ' ')}</span>
                <div style={{ marginTop: 8 }}>
                  {[
                    ['Listing ID',  selectedListing.id],
                    ['Type',        selectedListing.type],
                    ['LOA',         selectedListing.loa],
                    ['Year Built',  selectedListing.year],
                    ['Asking Price',fmt(selectedListing.price)],
                    ['Commission',  `${selectedListing.commission}%`],
                    ['Owner',       selectedListing.owner],
                    ['Location',    selectedListing.location],
                    ['Days Listed', selectedListing.status === 'sold' ? '—' : `${selectedListing.daysListed} days`],
                  ].map(([k, v]) => (
                    <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                  ))}
                  <div style={{ marginTop: 10, padding: '10px 0', borderTop: 'var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Highlights</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>{selectedListing.highlights}</div>
                  </div>
                </div>
                <div className="detail-actions">
                  {selectedListing.status === 'active'      && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Mark Under Offer</button>}
                  {selectedListing.status === 'under-offer' && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Mark Sold</button>}
                  <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Generate Contract</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pipeline ─────────────────────────────────────────────────── */}
      {tab === 'pipeline' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              ['Total Leads', LEADS.length, 'badge-blue'],
              ['Under Offer', LEADS.filter(l => l.stage === 'under-offer').length, 'badge-orange'],
              ['New Today',   LEADS.filter(l => l.created === '25 Apr 2026').length, 'badge-teal'],
            ].map(([l, v, b]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: 'var(--border)', borderRadius: 8, padding: '8px 14px' }}>
                <span className={`badge ${b}`}>{v}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.6)' }}>{l}</span>
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }}><Ic n="plus" s={12} /> Log Enquiry</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: selectedLead ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
            <div className="card">
              <table className="tbl" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>ID</th>
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
                  {LEADS.map(lead => (
                    <tr key={lead.id} onClick={() => setSel(sel === lead.id ? null : lead.id)} style={{ cursor: 'pointer', background: sel === lead.id ? '#fafaf9' : undefined }}>
                      <td style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>{lead.id}</td>
                      <td>
                        <div className="tbl-name">{lead.name}</div>
                        <div className="tbl-sub">{lead.contact}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{lead.listing}</td>
                      <td style={{ fontSize: 12 }}>{lead.budget}</td>
                      <td><span className={`badge ${stageSt[lead.stage] || 'badge-gray'}`}>{stageLabel[lead.stage] || lead.stage}</span></td>
                      <td style={{ fontSize: 12 }}>{lead.source}</td>
                      <td style={{ fontSize: 12 }}>{lead.lastContact}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={e => e.stopPropagation()}>Update</button>
                      </td>
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
                    ['Lead ID',      selectedLead.id],
                    ['Listing',      selectedLead.listing],
                    ['Budget',       selectedLead.budget],
                    ['Source',       selectedLead.source],
                    ['Created',      selectedLead.created],
                    ['Last Contact', selectedLead.lastContact],
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
                  {selectedLead.stage === 'new'               && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Mark Contacted</button>}
                  {selectedLead.stage === 'contacted'         && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Schedule Viewing</button>}
                  {selectedLead.stage === 'viewing-scheduled' && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Viewing Completed</button>}
                  {selectedLead.stage === 'viewing-completed' && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Record Offer</button>}
                  {selectedLead.stage === 'under-offer'       && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Mark Sale Agreed</button>}
                  <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Log Activity</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Brokerage ────────────────────────────────────────────────── */}
      {tab === 'brokerage' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Brokerage Agreements</div>
            <button className="btn btn-primary btn-sm"><Ic n="plus" s={12} /> New Agreement</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Active Agreements', value: LISTINGS.filter(l => l.status !== 'sold' && l.status !== 'withdrawn').length, sub: 'Vessels currently listed', badge: 'badge-green' },
              { label: 'Commission Held',   value: '£' + LISTINGS.filter(l => l.status !== 'sold').reduce((s, l) => s + Math.round(l.price * l.commission / 100), 0).toLocaleString('en-GB'), sub: 'Estimated at asking price', badge: 'badge-gold' },
            ].map(s => (
              <div key={s.label} className="card" style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', marginBottom: 2 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>{s.sub}</div>
              </div>
            ))}
          </div>

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
                {LISTINGS.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div className="tbl-name">{l.name}</div>
                      <div className="tbl-sub">{l.make} {l.model} · {l.loa}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{l.owner}</td>
                    <td style={{ fontSize: 12 }}>{l.type}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{fmt(l.price)}</td>
                    <td style={{ fontSize: 12 }}>{l.commission}%</td>
                    <td style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>{fmt(Math.round(l.price * l.commission / 100))}</td>
                    <td style={{ fontSize: 12 }}>{l.status === 'sold' ? '—' : `${l.daysListed}d`}</td>
                    <td><span className={`badge ${listSt[l.status] || 'badge-gray'}`}>{l.status.replace('-', ' ')}</span></td>
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
        </div>
      )}
    </div>
  );
}
