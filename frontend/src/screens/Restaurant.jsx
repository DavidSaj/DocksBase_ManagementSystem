import { useState } from 'react';
import { REST_TABLES, REST_BOOKINGS, MENU, REST_ORDERS } from '../data/mock.js';
import Ic from '../components/ui/Icon.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

const SECTIONS = ['Main', 'Terrace', 'Bar'];
const MENU_SECTIONS = ['Starters', 'Mains', 'Desserts', 'Drinks'];

const statusLabel = { available: 'Available', occupied: 'Occupied', reserved: 'Reserved', cleaning: 'Cleaning' };

export default function Restaurant() {
  const [tab, setTab]    = useState('floor');
  const [selTable, setSelTable] = useState(null);
  const [menuSec, setMenuSec]   = useState('Starters');

  return (
    <div>
      <PageHeader
        title="Restaurant"
        subtitle="Point-of-sale and floor management for the marina restaurant."
        infoBody={SCREEN_INFO.restaurant}
      />
      <div className="tabs">
        {[['floor','Floor Plan'],['reservations','Reservations'],['menu','Menu'],['orders','Live Orders'],['pos','POS / Bills']].map(([v,l]) => (
          <div key={v} className={`tab${tab===v?' active':''}`} onClick={() => { setTab(v); setSelTable(null); }}>{l}</div>
        ))}
      </div>

      {tab === 'floor' && (
        <div style={{ display: 'grid', gridTemplateColumns: selTable ? '1fr 280px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div className="sec-hdr">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[['available','#e8f5eb','Available'],['occupied','#dbeeff','Occupied'],['reserved','#fff5e0','Reserved'],['cleaning','#f4f3f0','Cleaning']].map(([s,c,l]) => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid rgba(0,0,0,0.1)' }}/>{l}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="badge badge-green">{REST_TABLES.filter(t=>t.status==='available').length} Free</span>
                <span className="badge badge-blue">{REST_TABLES.filter(t=>t.status==='occupied').length} Seated</span>
                <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>Walk-in</button>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              {SECTIONS.map(sec => (
                <div key={sec}>
                  <div className="rest-section-label">{sec} Dining</div>
                  <div className="rest-tables">
                    {REST_TABLES.filter(t => t.section === sec).map(t => (
                      <div
                        key={t.id}
                        className={`rest-table ${t.status}${selTable?.id===t.id?' selected':''}`}
                        onClick={() => setSelTable(selTable?.id===t.id ? null : t)}
                      >
                        <div className="rt-num">T{t.num}</div>
                        <div className="rt-cap">{t.capacity} covers</div>
                        {t.status === 'occupied' && <div className="rt-info">{t.party} pax · {t.seated}</div>}
                        {t.status === 'reserved' && t.reservation && <div className="rt-info">{t.reservation.time}</div>}
                        {t.status === 'available' && <div className="rt-info" style={{ opacity: 0.5 }}>Free</div>}
                        {t.status === 'cleaning' && <div className="rt-info" style={{ opacity: 0.5 }}>Cleaning</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selTable && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <div className="detail-title">Table {selTable.num}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelTable(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12}/></button>
              </div>
              <div className="detail-sub">{selTable.section} · {selTable.capacity} covers</div>
              <span className={`badge ${selTable.status==='available'?'badge-green':selTable.status==='occupied'?'badge-blue':selTable.status==='reserved'?'badge-gold':'badge-gray'}`}>{statusLabel[selTable.status]}</span>

              {selTable.status === 'occupied' && (
                <div style={{ marginTop: 14 }}>
                  {[['Party Size', selTable.party + ' guests'],['Seated At', selTable.seated],['Server', selTable.server]].map(([k,v]) => (
                    <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                  ))}
                </div>
              )}
              {selTable.status === 'reserved' && selTable.reservation && (
                <div style={{ marginTop: 14 }}>
                  {[['Guest', selTable.reservation.name],['Time', selTable.reservation.time],['Party', selTable.reservation.party + ' guests']].map(([k,v]) => (
                    <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                  ))}
                </div>
              )}

              <div className="detail-actions">
                {selTable.status === 'available' && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Seat Walk-in</button>}
                {selTable.status === 'occupied'  && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>View / Add Order</button>}
                {selTable.status === 'occupied'  && <button className="btn btn-gold" style={{ justifyContent: 'center' }}>Generate Bill</button>}
                {selTable.status === 'reserved'  && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Check In Guests</button>}
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Mark for Cleaning</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'reservations' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Dining Reservations — Today & Tomorrow</div>
            <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>New Reservation</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Guest</th><th>Date / Time</th><th>Party</th><th>Table</th><th>Notes</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {REST_BOOKINGS.map(b => (
                  <tr key={b.id}>
                    <td><div className="tbl-name">{b.name}</div><div className="tbl-sub">{b.phone}</div></td>
                    <td><div style={{ fontSize: 12, fontWeight: 500 }}>{b.date}</div><div className="tbl-sub">{b.time}</div></td>
                    <td style={{ fontSize: 12 }}>{b.party} guests</td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 12 }}>{b.table}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', maxWidth: 180 }}>{b.notes}</td>
                    <td><span className={`badge ${b.status==='confirmed'?'badge-green':'badge-gold'}`}>{b.status}</span></td>
                    <td><button className="btn btn-ghost btn-sm">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'menu' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', gap: 0 }}>
              {MENU_SECTIONS.map(s => (
                <button key={s} className={`btn btn-sm ${menuSec===s?'btn-primary':'btn-ghost'}`} style={{ borderRadius: s===MENU_SECTIONS[0]?'4px 0 0 4px':s===MENU_SECTIONS[MENU_SECTIONS.length-1]?'0 4px 4px 0':'0', borderRight: s!==MENU_SECTIONS[MENU_SECTIONS.length-1]?'none':undefined }} onClick={() => setMenuSec(s)}>{s}</button>
              ))}
            </div>
            <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>Add Item</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Item</th><th>Description</th><th>Price</th><th>Allergens</th><th>Dietary</th><th>GP</th><th>Prep</th></tr></thead>
              <tbody>
                {MENU.filter(m => m.section === menuSec).map(item => {
                  const cost  = parseFloat(item.cost.replace('€',''));
                  const price = parseFloat(item.price.replace('€',''));
                  const gp    = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
                  return (
                    <tr key={item.id}>
                      <td className="tbl-name">{item.name}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)', maxWidth: 240 }}>{item.desc}</td>
                      <td style={{ fontWeight: 700 }}>{item.price}</td>
                      <td style={{ maxWidth: 180 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {item.allergens.map(a => <span key={a} className="allergen">{a}</span>)}
                          {item.allergens.length === 0 && <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>—</span>}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {item.tags.map(t => <span key={t} className="diet-tag">{t}</span>)}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: gp >= 65 ? 'var(--green)' : gp >= 50 ? 'var(--orange)' : 'var(--red)' }}>{gp > 0 ? gp + '%' : '—'}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{item.prepTime}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Kitchen Display — Live Orders</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="badge badge-orange">{REST_ORDERS.filter(o=>o.items.some(i=>i.status==='in-prep')).length} In Prep</span>
              <span className="badge badge-green">{REST_ORDERS.filter(o=>o.items.some(i=>i.status==='ready')).length} Ready</span>
            </div>
          </div>
          <div className="kds-grid">
            {REST_ORDERS.map(order => (
              <div key={order.id} className="kds-card">
                <div className="kds-head">
                  <div>
                    <div className="kds-table-num">Table {order.table.replace('T','')}</div>
                    <div className="kds-covers">{order.covers} covers</div>
                  </div>
                  <div className="kds-time">{order.placed}</div>
                </div>
                {order.items.map((item, i) => (
                  <div key={i} className="kds-item">
                    <span className="kds-qty">{item.qty}×</span>
                    <span className="kds-item-name">{item.name}</span>
                    <span className={`kds-st ${item.status}`}>{item.status.replace('-',' ')}</span>
                  </div>
                ))}
                <div style={{ padding: '10px 14px', borderTop: 'var(--border)', display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm">Bump</button>
                  <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>Mark Ready</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'pos' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Select Table to Bill</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {REST_TABLES.filter(t => t.status === 'occupied').map(t => (
                <button key={t.id} className="btn btn-ghost" style={{ fontWeight: 700, fontSize: 13, padding: '8px 14px' }}>T{t.num} · {t.party}p</button>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Table 1 — Bill Preview</div>
            {[
              { item: 'Dressed Brown Crab ×2', price: '€28.00' },
              { item: 'Smoked Mackerel Pâté ×1', price: '€11.00' },
              { item: 'Catch of the Day ×2', price: '€52.00' },
              { item: 'Ribeye 28-Day ×1', price: '€38.00' },
              { item: 'House White ×2 (glass)', price: '€16.00' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                <span style={{ color: 'rgba(0,0,0,0.7)' }}>{r.item}</span>
                <span style={{ fontWeight: 600 }}>{r.price}</span>
              </div>
            ))}
            <div style={{ padding: '10px 0', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>Subtotal</span><span>€145.00</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'rgba(0,0,0,0.5)' }}>VAT (20%)</span><span>€29.00</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14, marginTop: 6, paddingTop: 8, borderTop: '2px solid rgba(0,0,0,0.1)' }}><span>Total</span><span>€174.00</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>Split Bill</button>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>Add Discount</button>
            </div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Payment Method</div>
            {[['Card (Chip & PIN)', 'primary'],['Cash','ghost'],['Marina Account','ghost'],['Gift Voucher','ghost']].map(([l,s]) => (
              <button key={l} className={`btn btn-${s}`} style={{ width: '100%', justifyContent: 'center', marginBottom: 8, padding: '10px' }}>{l}</button>
            ))}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: 10 }}>Charge to Marina Account</div>
              <input type="text" placeholder="Search marina guest…" style={{ width: '100%', marginBottom: 8 }} />
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Lookup Guest</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
