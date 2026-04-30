import { useState } from 'react';
import { EVENTS, VENUES } from '../data/mock.js';
import Ic from '../components/ui/Icon.jsx';

const FLEET = [
  { event: 'EV-001', vessel: 'Nordic Spirit',  loa: '14m', flag: 'SWE', skipper: 'A. Lindqvist',  berth: 'A3', arrived: false },
  { event: 'EV-001', vessel: 'Seawind',         loa: '11m', flag: 'NOR', skipper: 'P. Haugen',     berth: 'A7', arrived: false },
  { event: 'EV-001', vessel: 'Orca VI',         loa: '16m', flag: 'GBR', skipper: 'T. Hutchinson', berth: 'B3', arrived: false },
  { event: 'EV-001', vessel: 'Belle Mer',       loa: '12m', flag: 'FRA', skipper: 'M. Girard',     berth: 'B6', arrived: false },
];

function statusBadge(s) {
  if (s === 'confirmed') return <span className="badge badge-green">Confirmed</span>;
  if (s === 'inquiry')   return <span className="badge badge-gold">Inquiry</span>;
  if (s === 'cancelled') return <span className="badge badge-red">Cancelled</span>;
  return <span className="badge badge-gray">{s}</span>;
}

export default function Events() {
  const [tab, setTab]   = useState('events');
  const [fleet, setFleet] = useState(FLEET);

  const toggle = (i) => setFleet(f => f.map((v, idx) => idx === i ? { ...v, arrived: !v.arrived } : v));

  return (
    <div>
      <div className="tabs">
        {[['events','Events'],['venue','Venue Hire'],['fleet','Fleet Bookings']].map(([v,l]) => (
          <div key={v} className={`tab${tab===v?' active':''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'events' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Upcoming Events</div>
            <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>New Event</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {EVENTS.map(ev => {
              const [day] = ev.dates.split(' ');
              const dayNum = day.replace(/\D/g, '') || '—';
              const mon = ev.dates.match(/[A-Z][a-z]+/)?.[0] || '';
              return (
                <div key={ev.id} className="event-card">
                  <div className="event-date-block">
                    <div className="event-date-mon">{mon}</div>
                    <div className="event-date-day">{dayNum}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.1px' }}>{ev.name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{ev.dates} · {ev.location}</div>
                      </div>
                      {statusBadge(ev.status)}
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Type: </span>{ev.type}</div>
                      <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Organiser: </span>{ev.organiser}</div>
                      {ev.fleet > 0 && <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Fleet: </span>{ev.fleet} vessels</div>}
                      <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Attendance: </span>~{ev.attendance}</div>
                      {ev.berthsBlocked > 0 && <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Berths blocked: </span>{ev.berthsBlocked}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="btn btn-ghost btn-sm">View Details</button>
                      <button className="btn btn-ghost btn-sm">Send Message</button>
                      {ev.fleet > 0 && <button className="btn btn-ghost btn-sm">Fleet Manifest</button>}
                      <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>{ev.revenue}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'venue' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Hireable Spaces</div>
            <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>New Hire Booking</button>
          </div>
          <div className="grid-3" style={{ alignItems: 'start' }}>
            {VENUES.map(v => (
              <div key={v.id} className="venue-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px' }}>{v.name}</div>
                  <span className={`badge ${v.status==='available'?'badge-green':'badge-orange'}`}>{v.status.charAt(0).toUpperCase()+v.status.slice(1)}</span>
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 10 }}>
                  <span>Seated: <b>{v.capacitySeated}</b></span>
                  <span>Standing: <b>{v.capacityStanding}</b></span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {v.facilities.map(f => <span key={f} className="badge badge-gray">{f}</span>)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <div><div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Day Rate</div><div style={{ fontWeight: 700, fontSize: 14 }}>{v.rateDay}</div></div>
                  <div style={{ textAlign: 'right' }}><div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Hourly</div><div style={{ fontWeight: 700, fontSize: 14 }}>{v.rateHour}</div></div>
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>Book</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>Check Availability</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'fleet' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">East Coast Spring Regatta — Fleet Manifest</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-blue">18 vessels registered</span>
              <span className="badge badge-green">{fleet.filter(f=>f.arrived).length} arrived</span>
              <button className="btn btn-ghost btn-sm"><Ic n="file" s={11}/>Export</button>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
            <table className="tbl">
              <thead><tr><th>Vessel</th><th>LOA</th><th>Flag</th><th>Skipper</th><th>Assigned Berth</th><th>Arrived</th><th></th></tr></thead>
              <tbody>
                {fleet.map((v, i) => (
                  <tr key={i}>
                    <td className="tbl-name">{v.vessel}</td>
                    <td style={{ fontSize: 12 }}>{v.loa}</td>
                    <td style={{ fontSize: 12 }}>{v.flag}</td>
                    <td style={{ fontSize: 12 }}>{v.skipper}</td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 12 }}>{v.berth}</td>
                    <td>
                      <div
                        className={`task-check${v.arrived?' done':''}`}
                        onClick={() => toggle(i)}
                        style={{ cursor: 'pointer' }}
                      >
                        {v.arrived && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2,6 5,9 10,3"/></svg>}
                      </div>
                    </td>
                    <td><button className="btn btn-ghost btn-sm">Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Fleet Billing</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
                Generate consolidated invoice to Harwich YC or individual invoices per vessel.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Consolidated Invoice</button>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>Individual Invoices</button>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Message Fleet</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select><option>Email + SMS</option><option>Email only</option><option>SMS only</option></select>
                <input type="text" placeholder="Subject…" />
                <textarea rows={3} placeholder="Message to all fleet participants…" style={{ resize: 'vertical' }} />
                <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Send to All Fleet</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
