import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { bookingStatusBadge, fmtDT, fmtTime, today, addDays, dateRange, Loading, Empty, Err, SecHdr, Drawer, Field, inputStyle } from '../shared.jsx';

function BookingDetail({ booking, onClose }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.post(`/activity-bookings/${booking.id}/cancel/`, { reason });
      onClose();
    } catch {
      alert('Failed to cancel booking.');
    } finally {
      setCancelling(false);
    }
  }

  const b = booking;
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        {bookingStatusBadge(b.status)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Activity</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{b.activity_name ?? `Activity #${b.activity}`}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Start</div>
          <div style={{ fontSize: 13 }}>{fmtDT(b.start_datetime)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Participants</div>
          <div style={{ fontSize: 13 }}>{b.participant_count}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Lead</div>
          <div style={{ fontSize: 13 }}>{b.lead_name || b.member_name || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Email</div>
          <div style={{ fontSize: 13 }}>{b.lead_email || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Phone</div>
          <div style={{ fontSize: 13 }}>{b.lead_phone || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Instructor</div>
          <div style={{ fontSize: 13 }}>{b.assigned_instructor_name ?? '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Payment mode</div>
          <div style={{ fontSize: 13 }}>{b.payment_mode === 'berth_invoice' ? 'Berth Invoice' : 'Direct'}</div>
        </div>
        {b.invoice && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Invoice</div>
            <div style={{ fontSize: 13 }}>#{b.invoice}</div>
          </div>
        )}
        {b.notes && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Notes</div>
            <div style={{ fontSize: 13 }}>{b.notes}</div>
          </div>
        )}
      </div>

      {b.status === 'confirmed' && (
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
          {!showCancel ? (
            <button className="btn btn-sm" style={{ background: '#c92a2a', color: '#fff', border: 'none', cursor: 'pointer' }} onClick={() => setShowCancel(true)}>
              Cancel Booking
            </button>
          ) : (
            <div>
              <Field label="Cancellation reason">
                <input style={inputStyle} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for cancellation…" />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCancel(false)}>Back</button>
                <button className="btn btn-sm" style={{ background: '#c92a2a', color: '#fff', border: 'none', cursor: 'pointer' }} onClick={handleCancel} disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BookingsTab() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFilter, setDateFilter] = useState(today());
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState('calendar'); // 'calendar' | 'list'
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [activities, setActivities] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    activity: '', start_datetime: '', participant_count: 1,
    lead_name: '', lead_email: '', lead_phone: '',
    payment_mode: 'direct', notes: '',
  });

  const loadBookings = useCallback(() => {
    setLoading(true);
    const params = {};
    if (dateFilter) params.date = dateFilter;
    if (statusFilter) params.status = statusFilter;
    api.get('/activity-bookings/', { params })
      .then(r => setBookings(r.data.results ?? r.data))
      .catch(() => setError('Failed to load bookings.'))
      .finally(() => setLoading(false));
  }, [dateFilter, statusFilter]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  useEffect(() => {
    api.get('/activity-catalogue/').then(r => setActivities(r.data.results ?? r.data)).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/activity-bookings/', {
        ...form,
        participant_count: Number(form.participant_count),
      });
      setShowForm(false);
      setForm({ activity: '', start_datetime: '', participant_count: 1, lead_name: '', lead_email: '', lead_phone: '', payment_mode: 'direct', notes: '' });
      loadBookings();
    } catch {
      alert('Failed to create booking.');
    } finally {
      setSaving(false);
    }
  }

  // Calendar week view: 7 cols from dateFilter
  const weekDates = dateRange(dateFilter, addDays(dateFilter, 6));
  const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 07:00 – 18:00

  const CAT_COLOURS = {
    water_sport: '#1c7ed6', lesson: '#7950f2', equipment: '#1a2d4a',
    guided_trip: '#0ca678', wellness: '#37b24d', other: '#868e96',
  };

  function bookingCol(b) {
    const act = activities.find(a => a.id === b.activity);
    return CAT_COLOURS[act?.category] ?? '#868e96';
  }

  function bookingsForDayHour(date, hour) {
    return bookings.filter(b => {
      const start = new Date(b.start_datetime);
      return start.toISOString().slice(0, 10) === date && start.getHours() === hour;
    });
  }

  return (
    <div>
      <SecHdr title="Activity Bookings">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Booking</>}
        </button>
      </SecHdr>

      {/* Controls */}
      <div className="filter-row">
        <input
          type="date"
          className="form-control form-control-sm"
          style={{ width: 160 }}
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
        />
        <select className="form-control form-control-sm" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No Show</option>
        </select>
        {/* View toggle */}
        <div className="tabs" style={{ marginLeft: 'auto' }}>
          {['calendar', 'list'].map(v => (
            <div key={v} className={`tab${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
              {v === 'calendar' ? 'Calendar' : 'List'}
            </div>
          ))}
        </div>
      </div>

      {/* New booking form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>New Booking</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Activity" required>
                <select required style={inputStyle} value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}>
                  <option value="">Select activity…</option>
                  {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Start date & time" required>
              <input required type="datetime-local" style={inputStyle} value={form.start_datetime} onChange={e => setForm(f => ({ ...f, start_datetime: e.target.value }))} />
            </Field>
            <Field label="Participants" required>
              <input required type="number" style={inputStyle} min={1} value={form.participant_count} onChange={e => setForm(f => ({ ...f, participant_count: e.target.value }))} />
            </Field>
            <Field label="Lead name">
              <input style={inputStyle} value={form.lead_name} onChange={e => setForm(f => ({ ...f, lead_name: e.target.value }))} placeholder="Walk-in or guest name" />
            </Field>
            <Field label="Lead email">
              <input type="email" style={inputStyle} value={form.lead_email} onChange={e => setForm(f => ({ ...f, lead_email: e.target.value }))} placeholder="email@example.com" />
            </Field>
            <Field label="Lead phone">
              <input style={inputStyle} value={form.lead_phone} onChange={e => setForm(f => ({ ...f, lead_phone: e.target.value }))} placeholder="+44…" />
            </Field>
            <Field label="Payment mode">
              <select style={inputStyle} value={form.payment_mode} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                <option value="direct">Direct Payment</option>
                <option value="berth_invoice">Add to Berth Invoice</option>
              </select>
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Booking'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : (
        <>
          {view === 'calendar' ? (
            // Week calendar view
            <div className="card" style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 700 }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                  <div style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)' }}>TIME</div>
                  {weekDates.map(d => {
                    const isToday = d === today();
                    return (
                      <div key={d} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: isToday ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.55)', background: isToday ? 'rgba(26,45,74,0.04)' : undefined }}>
                        {new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                    );
                  })}
                </div>
                {/* Hour rows */}
                {HOURS.map(h => (
                  <div key={h} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid rgba(0,0,0,0.05)', minHeight: 52 }}>
                    <div style={{ padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.35)', paddingTop: 8 }}>
                      {String(h).padStart(2, '0')}:00
                    </div>
                    {weekDates.map(d => {
                      const dayBookings = bookingsForDayHour(d, h);
                      return (
                        <div key={d} style={{ padding: 3, borderLeft: '1px solid rgba(0,0,0,0.04)', background: d === today() ? 'rgba(26,45,74,0.02)' : undefined }}>
                          {dayBookings.map(b => (
                            <div
                              key={b.id}
                              onClick={() => setSelected(b)}
                              style={{
                                background: bookingCol(b),
                                color: '#fff',
                                borderRadius: 4,
                                padding: '3px 6px',
                                fontSize: 11,
                                cursor: 'pointer',
                                marginBottom: 2,
                                opacity: b.status === 'cancelled' ? 0.45 : 1,
                              }}
                            >
                              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {fmtTime(b.start_datetime)} {b.activity_name ?? ''}
                              </div>
                              <div style={{ fontSize: 10, opacity: 0.85 }}>{b.participant_count} pax</div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {bookings.length === 0 && (
                <Empty title="No bookings this week" subtitle="Use the date picker to navigate, or create a new booking above." />
              )}
            </div>
          ) : (
            // List view
            bookings.length === 0 ? (
              <Empty title="No bookings found" subtitle="Adjust filters or create a new booking." />
            ) : (
              <div className="card" style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Date / Time</th>
                      <th>Lead</th>
                      <th>Participants</th>
                      <th>Instructor</th>
                      <th>Status</th>
                      <th>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map(b => (
                      <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                        <td style={{ fontWeight: 600 }}>{b.activity_name ?? `Activity #${b.activity}`}</td>
                        <td style={{ fontSize: 12 }}>{fmtDT(b.start_datetime)}</td>
                        <td style={{ fontSize: 12 }}>{b.lead_name || b.member_name || '—'}</td>
                        <td style={{ textAlign: 'center' }}>{b.participant_count}</td>
                        <td style={{ fontSize: 12 }}>{b.assigned_instructor_name ?? '—'}</td>
                        <td>{bookingStatusBadge(b.status)}</td>
                        <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{b.payment_mode === 'berth_invoice' ? 'Berth Invoice' : 'Direct'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      {/* Booking detail drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Booking Details">
        {selected && <BookingDetail booking={selected} onClose={() => { setSelected(null); loadBookings(); }} />}
      </Drawer>
    </div>
  );
}
