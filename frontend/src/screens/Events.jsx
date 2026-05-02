import { useState } from 'react';
import { useEvents, useVenueHires } from '../hooks/useEvents.js';
import Ic from '../components/ui/Icon.jsx';

function statusBadge(s) {
  if (s === 'upcoming')  return <span className="badge badge-blue">Upcoming</span>;
  if (s === 'active')    return <span className="badge badge-green">Active</span>;
  if (s === 'completed') return <span className="badge badge-gray">Completed</span>;
  if (s === 'cancelled') return <span className="badge badge-red">Cancelled</span>;
  return <span className="badge badge-gray">{s}</span>;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatMon(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', { month: 'short' });
}

function formatDay(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).getDate();
}

function formatRevenue(val) {
  if (!val && val !== 0) return '—';
  return `£${Number(val).toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

function formatRate(val) {
  if (!val && val !== 0) return '—';
  return `£${Number(val).toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

function EventsTab() {
  const { events, loading, error, createEvent } = useEvents();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: '', event_type: 'other', location: '', organiser: '',
    contact: '', start_date: '', end_date: '', attendance: 0,
    fleet_count: 0, berths_blocked: 0, status: 'upcoming', revenue: 0,
  });

  async function handleCreate(e) {
    e.preventDefault();
    await createEvent(form);
    setShowNew(false);
    setForm({ name: '', event_type: 'other', location: '', organiser: '', contact: '', start_date: '', end_date: '', attendance: 0, fleet_count: 0, berths_blocked: 0, status: 'upcoming', revenue: 0 });
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading events…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load events.</div></div>;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Upcoming Events</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(v => !v)}>
          <Ic n="plus" s={11}/>{showNew ? 'Cancel' : 'New Event'}
        </button>
      </div>

      {showNew && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Event Name</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Summer Regatta 2026" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Type</label>
              <select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                <option value="race">Race</option>
                <option value="rally">Rally</option>
                <option value="social">Social</option>
                <option value="corporate">Corporate</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Start Date</label>
              <input required type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>End Date</label>
              <input required type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Location</label>
              <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Main Harbour" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Organiser</label>
              <input value={form.organiser} onChange={e => setForm(f => ({ ...f, organiser: e.target.value }))} placeholder="Name or club" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Contact</label>
              <input value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} placeholder="Email or phone" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Expected Attendance</label>
              <input type="number" min="0" value={form.attendance} onChange={e => setForm(f => ({ ...f, attendance: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Fleet (vessels)</label>
              <input type="number" min="0" value={form.fleet_count} onChange={e => setForm(f => ({ ...f, fleet_count: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Berths Blocked</label>
              <input type="number" min="0" value={form.berths_blocked} onChange={e => setForm(f => ({ ...f, berths_blocked: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Revenue (£)</label>
              <input type="number" min="0" step="0.01" value={form.revenue} onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">Save Event</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </form>
      )}

      {events.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No events yet</div>
          <div className="empty-sub">Add your first event above.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.map(ev => (
            <div key={ev.id} className="event-card">
              <div className="event-date-block">
                <div className="event-date-mon">{formatMon(ev.start_date)}</div>
                <div className="event-date-day">{formatDay(ev.start_date)}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.1px' }}>{ev.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                      {formatDate(ev.start_date)}{ev.end_date !== ev.start_date ? ` – ${formatDate(ev.end_date)}` : ''}{ev.location ? ` · ${ev.location}` : ''}
                    </div>
                  </div>
                  {statusBadge(ev.status)}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
                  <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Type: </span>{ev.event_type}</div>
                  {ev.organiser && <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Organiser: </span>{ev.organiser}</div>}
                  {ev.fleet_count > 0 && <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Fleet: </span>{ev.fleet_count} vessels</div>}
                  {ev.attendance > 0 && <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Attendance: </span>~{ev.attendance}</div>}
                  {ev.berths_blocked > 0 && <div><span style={{ color: 'rgba(0,0,0,0.4)' }}>Berths blocked: </span>{ev.berths_blocked}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                  <button className="btn btn-ghost btn-sm">View Details</button>
                  {ev.revenue > 0 && (
                    <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>
                      {formatRevenue(ev.revenue)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VenueTab() {
  const { venues, loading, error } = useVenueHires();

  if (loading) return <div className="empty"><div className="empty-title">Loading venues…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load venues.</div></div>;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Hireable Spaces</div>
        <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>New Venue</button>
      </div>
      {venues.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No venues configured</div>
          <div className="empty-sub">Add hireable spaces to start taking bookings.</div>
        </div>
      ) : (
        <div className="grid-3" style={{ alignItems: 'start' }}>
          {venues.map(v => (
            <div key={v.id} className="venue-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px' }}>{v.name}</div>
                <span className={`badge ${v.status === 'available' ? 'badge-green' : 'badge-orange'}`}>
                  {v.status.charAt(0).toUpperCase() + v.status.slice(1)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 10 }}>
                <span>Seated: <b>{v.capacity_seated}</b></span>
                <span>Standing: <b>{v.capacity_standing}</b></span>
              </div>
              {v.facilities?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {v.facilities.map(f => <span key={f} className="badge badge-gray">{f}</span>)}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <div>
                  <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Day Rate</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatRate(v.day_rate)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Hourly</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatRate(v.hourly_rate)}</div>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>Book</button>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>Check Availability</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Events() {
  const [tab, setTab] = useState('events');

  return (
    <div>
      <div className="tabs">
        {[['events', 'Events'], ['venue', 'Venue Hire']].map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>
      {tab === 'events' && <EventsTab />}
      {tab === 'venue'  && <VenueTab />}
    </div>
  );
}
