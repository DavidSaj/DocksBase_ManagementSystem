import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDT(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const days = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

function bookingStatusBadge(s) {
  const map = {
    confirmed: 'badge-green',
    cancelled: 'badge-red',
    completed: 'badge-gray',
    no_show:   'badge-orange',
  };
  const label = { confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed', no_show: 'No Show' };
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{label[s] ?? s}</span>;
}

function categoryBadge(c) {
  const map = {
    water_sport: 'badge-blue',
    lesson:      'badge-purple',
    equipment:   'badge-navy',
    guided_trip: 'badge-teal',
    wellness:    'badge-green',
    other:       'badge-gray',
  };
  const label = {
    water_sport: 'Water Sport', lesson: 'Lesson', equipment: 'Equipment Hire',
    guided_trip: 'Guided Trip', wellness: 'Wellness', other: 'Other',
  };
  return <span className={`badge ${map[c] ?? 'badge-gray'}`}>{label[c] ?? c}</span>;
}

function taskStatusBadge(s) {
  const map = {
    dirty:            'badge-red',
    in_progress:      'badge-orange',
    ready_inspection: 'badge-blue',
    clean:            'badge-teal',
    ready_guest:      'badge-green',
  };
  const label = {
    dirty: 'Dirty', in_progress: 'In Progress', ready_inspection: 'Ready for Inspection',
    clean: 'Clean', ready_guest: 'Ready for Guest',
  };
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{label[s] ?? s}</span>;
}

function priorityBadge(p) {
  const map = { normal: 'badge-gray', high: 'badge-orange', urgent: 'badge-red' };
  return <span className={`badge ${map[p] ?? 'badge-gray'}`}>{p}</span>;
}

// ─── Loading / empty states ──────────────────────────────────────────────────

function Loading({ label = 'Loading…' }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      {label}
    </div>
  );
}

function Empty({ title, subtitle }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function Err({ msg = 'Failed to load data.' }) {
  return (
    <div style={{ padding: 20, color: '#c92a2a', fontSize: 13 }}>{msg}</div>
  );
}

// ─── Shared: Section header ──────────────────────────────────────────────────

function SecHdr({ title, children }) {
  return (
    <div className="sec-hdr">
      <span className="sec-hdr-title">{title}</span>
      {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}

// ─── Shared: Drawer shell ───────────────────────────────────────────────────

function Drawer({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Shared: Form field ──────────────────────────────────────────────────────

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#c92a2a' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box', background: '#fff',
};

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITIES SECTION
// ════════════════════════════════════════════════════════════════════════════

// ─── Activity Types (Catalogue) tab ─────────────────────────────────────────

function ActivityTypesTab() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', category: 'other', description: '', duration_minutes: 60,
    capacity_min: 1, capacity_max: 10, min_age: 0,
    season_start: '', season_end: '', is_active: true,
  });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/catalogue/')
      .then(r => setActivities(r.data.results ?? r.data))
      .catch(() => setError('Failed to load activity types.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = activities.filter(a => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = !catFilter || a.category === catFilter;
    return matchSearch && matchCat;
  });

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/catalogue/', {
        ...form,
        duration_minutes: Number(form.duration_minutes),
        capacity_min: Number(form.capacity_min),
        capacity_max: Number(form.capacity_max),
        min_age: Number(form.min_age),
        season_start: form.season_start || null,
        season_end: form.season_end || null,
      });
      setShowForm(false);
      setForm({ name: '', category: 'other', description: '', duration_minutes: 60, capacity_min: 1, capacity_max: 10, min_age: 0, season_start: '', season_end: '', is_active: true });
      load();
    } catch {
      alert('Failed to create activity type.');
    } finally {
      setSaving(false);
    }
  }

  const categories = [
    { value: 'water_sport', label: 'Water Sport' },
    { value: 'lesson', label: 'Lesson' },
    { value: 'equipment', label: 'Equipment Hire' },
    { value: 'guided_trip', label: 'Guided Trip' },
    { value: 'wellness', label: 'Wellness' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <div>
      <SecHdr title="Activity Catalogue">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Activity</>}
        </button>
      </SecHdr>

      {/* Filters */}
      <div className="filter-row">
        <input
          className="form-control form-control-sm"
          style={{ width: 220 }}
          placeholder="Search activities…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="form-control form-control-sm"
          style={{ width: 160 }}
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* New activity form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>New Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Name" required>
                <input required style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kayaking Tour" />
              </Field>
            </div>
            <Field label="Category" required>
              <select style={inputStyle} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Duration (min)" required>
              <input type="number" style={inputStyle} value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} min={1} />
            </Field>
            <Field label="Min capacity">
              <input type="number" style={inputStyle} value={form.capacity_min} onChange={e => setForm(f => ({ ...f, capacity_min: e.target.value }))} min={1} />
            </Field>
            <Field label="Max capacity" required>
              <input type="number" style={inputStyle} value={form.capacity_max} onChange={e => setForm(f => ({ ...f, capacity_max: e.target.value }))} min={1} />
            </Field>
            <Field label="Min age">
              <input type="number" style={inputStyle} value={form.min_age} onChange={e => setForm(f => ({ ...f, min_age: e.target.value }))} min={0} />
            </Field>
            <Field label="Season start">
              <input type="date" style={inputStyle} value={form.season_start} onChange={e => setForm(f => ({ ...f, season_start: e.target.value }))} />
            </Field>
            <Field label="Season end">
              <input type="date" style={inputStyle} value={form.season_end} onChange={e => setForm(f => ({ ...f, season_end: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Description">
                <textarea style={{ ...inputStyle, height: 72, resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Activity'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : filtered.length === 0 ? (
        <Empty title="No activities found" subtitle="Add your first activity to start taking bookings." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {filtered.map(a => (
            <div key={a.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, flex: 1, marginRight: 8 }}>{a.name}</div>
                {a.is_active
                  ? <span className="badge badge-green" style={{ flexShrink: 0 }}>Active</span>
                  : <span className="badge badge-gray" style={{ flexShrink: 0 }}>Inactive</span>}
              </div>
              <div style={{ marginBottom: 8 }}>{categoryBadge(a.category)}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span>Duration: {a.duration_minutes} min</span>
                <span>Capacity: {a.capacity_min}–{a.capacity_max} pax</span>
                {a.min_age > 0 && <span>Min age: {a.min_age}</span>}
                {a.season_start && <span>Season: {fmt(a.season_start)} → {fmt(a.season_end)}</span>}
              </div>
              {a.description && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 8 }}>
                  {a.description.length > 100 ? a.description.slice(0, 100) + '…' : a.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Activity Bookings tab ───────────────────────────────────────────────────

function ActivityBookingsTab() {
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
    api.get('/bookings/', { params })
      .then(r => setBookings(r.data.results ?? r.data))
      .catch(() => setError('Failed to load bookings.'))
      .finally(() => setLoading(false));
  }, [dateFilter, statusFilter]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  useEffect(() => {
    api.get('/catalogue/').then(r => setActivities(r.data.results ?? r.data)).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/bookings/', {
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

function BookingDetail({ booking, onClose }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.post(`/bookings/${booking.id}/cancel/`, { reason });
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

// ─── Activity Resources tab ──────────────────────────────────────────────────

function ActivityResourcesTab() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activities, setActivities] = useState([]);
  const [form, setForm] = useState({
    activity: '', resource_type: 'instructor', required_role: '', quantity_required: 1,
  });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/activity-resource-requirements/')
      .then(r => setResources(r.data.results ?? r.data))
      .catch(() => setError('Failed to load resources.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/catalogue/').then(r => setActivities(r.data.results ?? r.data)).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/activity-resource-requirements/', { ...form, quantity_required: Number(form.quantity_required) });
      setShowForm(false);
      setForm({ activity: '', resource_type: 'instructor', required_role: '', quantity_required: 1 });
      load();
    } catch {
      alert('Failed to create resource requirement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SecHdr title="Resource Requirements">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />Add Requirement</>}
        </button>
      </SecHdr>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Activity" required>
                <select required style={inputStyle} value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}>
                  <option value="">Select activity…</option>
                  {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Resource type">
              <select style={inputStyle} value={form.resource_type} onChange={e => setForm(f => ({ ...f, resource_type: e.target.value }))}>
                <option value="instructor">Instructor (Staff)</option>
                <option value="asset">Equipment Asset</option>
              </select>
            </Field>
            <Field label="Required role / asset">
              <input style={inputStyle} value={form.required_role} onChange={e => setForm(f => ({ ...f, required_role: e.target.value }))} placeholder="e.g. Kayak Instructor" />
            </Field>
            <Field label="Quantity required">
              <input type="number" style={inputStyle} min={1} value={form.quantity_required} onChange={e => setForm(f => ({ ...f, quantity_required: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Requirement'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : resources.length === 0 ? (
        <Empty title="No resource requirements" subtitle="Define what staff and equipment each activity requires." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr><th>Activity</th><th>Type</th><th>Role / Asset</th><th>Qty</th></tr>
            </thead>
            <tbody>
              {resources.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.activity_name ?? `Activity #${r.activity}`}</td>
                  <td>
                    <span className={`badge ${r.resource_type === 'instructor' ? 'badge-purple' : 'badge-navy'}`}>
                      {r.resource_type === 'instructor' ? 'Instructor' : 'Asset'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{r.required_role || r.asset_name || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.quantity_required}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Activity Schedule tab ───────────────────────────────────────────────────

function ActivityScheduleTab() {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/bookings/', { params: { date: today(), status: 'confirmed' } })
      .then(r => setSchedule(r.data.results ?? r.data))
      .catch(() => setError('Failed to load schedule.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  if (schedule.length === 0) return <Empty title="No scheduled sessions" subtitle="Sessions appear here once activity bookings are confirmed." />;

  return (
    <div>
      <SecHdr title="Today's Schedule" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {schedule.map((s, i) => (
          <div key={s.id ?? i} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 56, textAlign: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy, #1a2d4a)' }}>{fmtTime(s.start_datetime)}</div>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>{fmtTime(s.end_datetime)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{s.activity_name}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                {s.participant_count} participant{s.participant_count !== 1 ? 's' : ''}
                {s.assigned_instructor_name ? ` · ${s.assigned_instructor_name}` : ''}
              </div>
            </div>
            <div>{bookingStatusBadge(s.status)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Activities main section ─────────────────────────────────────────────────

const ACT_TABS = [
  { key: 'types', label: 'Activity Types' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'resources', label: 'Resources' },
  { key: 'schedule', label: 'Schedule' },
];

function ActivitiesSection() {
  const [tab, setTab] = useState('types');
  return (
    <div>
      <SubTabBar tabs={ACT_TABS} active={tab} onChange={setTab} />
      <div style={{ marginTop: 20 }}>
        {tab === 'types'     && <ActivityTypesTab />}
        {tab === 'bookings'  && <ActivityBookingsTab />}
        {tab === 'resources' && <ActivityResourcesTab />}
        {tab === 'schedule'  && <ActivityScheduleTab />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HOUSEKEEPING SECTION
// ════════════════════════════════════════════════════════════════════════════

// ─── Housekeeping Tasks tab ──────────────────────────────────────────────────

const STATUS_COLOURS = {
  dirty:            '#c92a2a',
  in_progress:      '#e67700',
  ready_inspection: '#1c7ed6',
  clean:            '#0ca678',
  ready_guest:      '#37b24d',
};

const NEXT_STATUS = {
  dirty:            { label: 'Mark In Progress',         next: 'in_progress' },
  in_progress:      { label: 'Ready for Inspection',     next: 'ready_inspection' },
  ready_inspection: { label: 'Mark Clean',               next: 'clean' },
  clean:            { label: 'Ready for Guest',          next: 'ready_guest' },
};

function HousekeepingTasksTab({ onSelectTask }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(today());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    unit_type: 'vessel', unit_label: '', source_type: 'manual',
    priority: 'normal', notes: '', target_ready_by: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (unitFilter) params.unit_type = unitFilter;
    if (dateFilter) params.date = dateFilter;
    api.get('/tasks/', { params })
      .then(r => setTasks(r.data.results ?? r.data))
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }, [statusFilter, unitFilter, dateFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/tasks/', { ...form, target_ready_by: form.target_ready_by || null });
      setShowForm(false);
      setForm({ unit_type: 'vessel', unit_label: '', source_type: 'manual', priority: 'normal', notes: '', target_ready_by: '' });
      load();
    } catch {
      alert('Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SecHdr title="Housekeeping Tasks">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Task</>}
        </button>
      </SecHdr>

      {/* Filters */}
      <div className="filter-row">
        <select className="form-control form-control-sm" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="dirty">Dirty</option>
          <option value="in_progress">In Progress</option>
          <option value="ready_inspection">Ready for Inspection</option>
          <option value="clean">Clean</option>
          <option value="ready_guest">Ready for Guest</option>
        </select>
        <select className="form-control form-control-sm" style={{ width: 150 }} value={unitFilter} onChange={e => setUnitFilter(e.target.value)}>
          <option value="">All unit types</option>
          <option value="vessel">Vessel</option>
          <option value="accommodation">Accommodation</option>
          <option value="facility">Facility</option>
        </select>
        <input type="date" className="form-control form-control-sm" style={{ width: 160 }} value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
      </div>

      {/* New task form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>New Manual Task</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Unit type">
              <select style={inputStyle} value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
                <option value="vessel">Vessel</option>
                <option value="accommodation">Accommodation</option>
                <option value="facility">Facility</option>
              </select>
            </Field>
            <Field label="Unit name" required>
              <input required style={inputStyle} value={form.unit_label} onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} placeholder="e.g. Sea Sprite" />
            </Field>
            <Field label="Priority">
              <select style={inputStyle} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Target ready by">
              <input type="datetime-local" style={inputStyle} value={form.target_ready_by} onChange={e => setForm(f => ({ ...f, target_ready_by: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Task'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : tasks.length === 0 ? (
        <Empty title="No tasks found" subtitle="All clear — or adjust filters to see more." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assigned To</th>
                <th>Target Ready By</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const done = t.checklist_done ?? 0;
                const total = t.checklist_total ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : null;
                // Delay alert: target within 2h and not ready_guest
                const isDelayed = t.target_ready_by && t.status !== 'ready_guest' &&
                  (new Date(t.target_ready_by) - Date.now()) < 2 * 60 * 60 * 1000 &&
                  new Date(t.target_ready_by) > Date.now();
                return (
                  <tr
                    key={t.id}
                    style={{ cursor: 'pointer', outline: isDelayed ? '2px solid #e67700' : undefined }}
                    onClick={() => onSelectTask(t)}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {t.unit_label}
                      {isDelayed && <span style={{ marginLeft: 6, fontSize: 10, color: '#e67700', fontWeight: 700 }}><Ic n="alert-circle" s={10} /> Due soon</span>}
                    </td>
                    <td>
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>{t.unit_type}</span>
                    </td>
                    <td>{taskStatusBadge(t.status)}</td>
                    <td>{priorityBadge(t.priority)}</td>
                    <td style={{ fontSize: 12 }}>{t.assigned_to_name ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmtDT(t.target_ready_by)}</td>
                    <td style={{ fontSize: 12 }}>
                      {pct !== null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, minWidth: 60 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: '#37b24d', borderRadius: 3, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>{done}/{total}</span>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Housekeeping Matrix tab ─────────────────────────────────────────────────

function HousekeepingMatrixTab({ onSelectTaskId }) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromDate, setFromDate] = useState(today());

  const toDate = addDays(fromDate, 6);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/matrix/', { params: { from: fromDate, to: toDate } })
      .then(r => {
        // Try to handle both matrix format and plain list
        const raw = r.data;
        if (raw.units) {
          setMatrix(raw);
        } else {
          setMatrix(null);
        }
      })
      .catch(() => setError('Failed to load housekeeping matrix.'))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const dates = dateRange(fromDate, toDate);

  const STATUS_BG = {
    dirty:            '#ffe3e3',
    in_progress:      '#fff3bf',
    ready_inspection: '#d0ebff',
    clean:            '#c3fae8',
    ready_guest:      '#d3f9d8',
  };

  const STATUS_TEXT = {
    dirty: '#c92a2a', in_progress: '#e67700',
    ready_inspection: '#1864ab', clean: '#0b7a6a', ready_guest: '#2b8a3e',
  };

  // Summary chips from matrix data
  const allCells = matrix
    ? matrix.units.flatMap(u => Object.values(u.cells).filter(c => c.status))
    : [];
  const counts = {};
  for (const c of allCells) counts[c.status] = (counts[c.status] ?? 0) + 1;

  return (
    <div>
      <SecHdr title="Housekeeping Matrix">
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>From</label>
        <input type="date" className="form-control form-control-sm" style={{ width: 150 }} value={fromDate} onChange={e => setFromDate(e.target.value)} />
      </SecHdr>

      {/* Summary chips */}
      {matrix && (
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <span className="badge badge-red">{counts['dirty'] ?? 0} Dirty</span>
          <span className="badge badge-orange">{counts['in_progress'] ?? 0} In Progress</span>
          <span className="badge badge-blue">{counts['ready_inspection'] ?? 0} Inspection</span>
          <span className="badge badge-teal">{counts['clean'] ?? 0} Clean</span>
          <span className="badge badge-green">{counts['ready_guest'] ?? 0} Ready</span>
        </div>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : !matrix ? (
        <Empty title="Matrix data not available" subtitle="The housekeeping matrix endpoint will be available once the backend is deployed." />
      ) : matrix.units.length === 0 ? (
        <Empty title="No units in range" subtitle="No vessels or accommodation units with tasks in this period." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 600 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: `180px repeat(${dates.length}, 1fr)`, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)' }}>UNIT</div>
              {dates.map(d => (
                <div key={d} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: d === today() ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)', background: d === today() ? 'rgba(26,45,74,0.04)' : undefined }}>
                  {new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
              ))}
            </div>
            {/* Rows */}
            {matrix.units.map(unit => (
              <div key={unit.unit_id} style={{ display: 'grid', gridTemplateColumns: `180px repeat(${dates.length}, 1fr)`, borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'rgba(0,0,0,0.35)' }}>
                    {unit.unit_type === 'vessel'
                      ? <Ic n="home" s={12} />
                      : unit.unit_type === 'accommodation'
                        ? <Ic n="home" s={12} />
                        : <Ic n="package" s={12} />}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{unit.unit_label}</span>
                </div>
                {dates.map(d => {
                  const cell = unit.cells?.[d];
                  if (!cell || !cell.status) {
                    return <div key={d} style={{ padding: 6, background: 'rgba(0,0,0,0.02)', borderLeft: '1px solid rgba(0,0,0,0.04)' }} />;
                  }
                  const isDelayed = cell.target_ready_by && cell.status !== 'ready_guest' &&
                    (new Date(cell.target_ready_by) - Date.now()) < 2 * 60 * 60 * 1000 &&
                    new Date(cell.target_ready_by) > Date.now();
                  return (
                    <div
                      key={d}
                      onClick={() => cell.task_id && onSelectTaskId(cell.task_id)}
                      style={{
                        padding: 6,
                        background: STATUS_BG[cell.status] ?? '#f8f9fa',
                        borderLeft: '1px solid rgba(0,0,0,0.04)',
                        cursor: cell.task_id ? 'pointer' : 'default',
                        boxShadow: isDelayed ? 'inset 0 0 0 2px #e67700' : undefined,
                        transition: 'opacity 0.1s',
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: STATUS_TEXT[cell.status] ?? '#495057' }}>
                        {cell.status.replace('_', ' ').toUpperCase()}
                      </div>
                      {cell.assigned_to && (
                        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{cell.assigned_to}</div>
                      )}
                      {isDelayed && <div style={{ fontSize: 9, color: '#e67700', fontWeight: 700 }}><Ic n="alert-circle" s={9} /> Due soon</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Housekeeping Schedules tab ──────────────────────────────────────────────

function CleaningSchedulesTab() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ unit_label: '', unit_type: 'vessel', interval_days: 1, notes: '' });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/cleaning-schedules/', { params: {} })
      .then(r => setSchedules(r.data.results ?? r.data))
      .catch(() => setError('Failed to load cleaning schedules.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/cleaning-schedules/', { ...form, interval_days: Number(form.interval_days) });
      setShowForm(false);
      setForm({ unit_label: '', unit_type: 'vessel', interval_days: 1, notes: '' });
      load();
    } catch {
      alert('Failed to create schedule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SecHdr title="Recurring Cleaning Schedules">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Schedule</>}
        </button>
      </SecHdr>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Unit name" required>
              <input required style={inputStyle} value={form.unit_label} onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} placeholder="e.g. Sea Sprite" />
            </Field>
            <Field label="Unit type">
              <select style={inputStyle} value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
                <option value="vessel">Vessel</option>
                <option value="accommodation">Accommodation</option>
                <option value="facility">Facility</option>
              </select>
            </Field>
            <Field label="Repeat every (days)" required>
              <input required type="number" style={inputStyle} min={1} value={form.interval_days} onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...inputStyle, height: 56, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Schedule'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : schedules.length === 0 ? (
        <Empty title="No recurring schedules" subtitle="Set up mid-stay recurring cleaning for vessels and accommodation." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr><th>Unit</th><th>Type</th><th>Interval</th><th>Next run</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.unit_label}</td>
                  <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{s.unit_type}</span></td>
                  <td style={{ fontSize: 12 }}>Every {s.interval_days} day{s.interval_days !== 1 ? 's' : ''}</td>
                  <td style={{ fontSize: 12 }}>{fmt(s.next_run_date)}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{s.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Inspection Checklists tab ───────────────────────────────────────────────

function InspectionChecklistsTab() {
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ unit_type: 'vessel', text: '', order: 0 });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/checklist-templates/')
      .then(r => setChecklists(r.data.results ?? r.data))
      .catch(() => setError('Failed to load checklists.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/checklist-templates/', { ...form, order: Number(form.order) });
      setShowForm(false);
      setForm({ unit_type: 'vessel', text: '', order: 0 });
      load();
    } catch {
      alert('Failed to create checklist item.');
    } finally {
      setSaving(false);
    }
  }

  const grouped = checklists.reduce((acc, item) => {
    const g = item.unit_type ?? 'other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const unitTypeLabel = { vessel: 'Vessel', accommodation: 'Accommodation', facility: 'Facility' };

  return (
    <div>
      <SecHdr title="Inspection Checklist Templates">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />Add Item</>}
        </button>
      </SecHdr>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Unit type">
              <select style={inputStyle} value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
                <option value="vessel">Vessel</option>
                <option value="accommodation">Accommodation</option>
                <option value="facility">Facility</option>
              </select>
            </Field>
            <Field label="Order">
              <input type="number" style={inputStyle} min={0} value={form.order} onChange={e => setForm(f => ({ ...f, order: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Checklist item text" required>
                <input required style={inputStyle} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="e.g. Check life jacket storage…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Item'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : checklists.length === 0 ? (
        <Empty title="No checklist templates" subtitle="Add items for each unit type — they'll be pre-loaded when tasks are assigned." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(grouped).map(([unitType, items]) => (
            <div key={unitType} className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{unitTypeLabel[unitType] ?? unitType}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', width: 24, textAlign: 'right', flexShrink: 0 }}>{item.order}</span>
                    <span style={{ fontSize: 13 }}>{item.text}</span>
                    {!item.is_active && <span className="badge badge-gray" style={{ fontSize: 10, marginLeft: 'auto' }}>Inactive</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Housekeeping Log tab ────────────────────────────────────────────────────

function HousekeepingLogTab() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/tasks/', { params: { status: 'ready_guest' } })
      .then(r => setLog(r.data.results ?? r.data))
      .catch(() => setError('Failed to load log.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  if (log.length === 0) return <Empty title="No log entries" subtitle="Completed housekeeping tasks will appear here." />;

  return (
    <div>
      <SecHdr title="Housekeeping Log" />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Status</th>
              <th>Source</th>
              <th>Assigned To</th>
              <th>Completed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {log.map(entry => (
              <tr key={entry.id}>
                <td style={{ fontWeight: 600 }}>{entry.unit_label}</td>
                <td>{taskStatusBadge(entry.status)}</td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{entry.source_type?.replace('_', ' ')}</td>
                <td style={{ fontSize: 12 }}>{entry.assigned_to_name ?? '—'}</td>
                <td style={{ fontSize: 12 }}>{fmtDT(entry.completed_at)}</td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Task detail drawer ──────────────────────────────────────────────────────

function TaskDetailDrawer({ taskId, onClose }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalateForm, setEscalateForm] = useState({ description: '', severity: 'medium' });
  const [showEscalate, setShowEscalate] = useState(false);

  const load = useCallback(() => {
    if (!taskId) return;
    setLoading(true);
    api.get(`/tasks/${taskId}/`)
      .then(r => setTask(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdvance() {
    if (!task || !NEXT_STATUS[task.status]) return;
    setAdvancing(true);
    try {
      await api.post(`/tasks/${task.id}/advance/`);
      load();
    } catch {
      alert('Failed to advance task status.');
    } finally {
      setAdvancing(false);
    }
  }

  async function toggleChecklist(itemId, isDone) {
    try {
      await api.patch(`/tasks/${task.id}/checklist/${itemId}/`, { is_done: !isDone });
      load();
    } catch {
      alert('Failed to update checklist.');
    }
  }

  async function handleEscalate(e) {
    e.preventDefault();
    setEscalating(true);
    try {
      await api.post(`/tasks/${task.id}/escalate-defect/`, escalateForm);
      setShowEscalate(false);
      setEscalateForm({ description: '', severity: 'medium' });
      alert('Defect escalated to maintenance. The Maintenance Manager has been notified.');
    } catch {
      alert('Failed to escalate defect.');
    } finally {
      setEscalating(false);
    }
  }

  if (loading) return <Loading />;
  if (!task) return <Err msg="Failed to load task details." />;

  const nextStep = NEXT_STATUS[task.status];
  const checklist = task.checklist ?? [];
  const photos = task.photos ?? [];

  return (
    <div>
      {/* Status header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {taskStatusBadge(task.status)}
        {priorityBadge(task.priority)}
        <span className="badge badge-gray" style={{ fontSize: 10 }}>{task.source_type?.replace(/_/g, ' ')}</span>
      </div>

      {/* Unit info */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{task.unit_label}</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
          {task.unit_type}
          {task.target_ready_by && ` · Ready by ${fmtDT(task.target_ready_by)}`}
        </div>
        {task.assigned_to_name && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>Assigned to: {task.assigned_to_name}</div>}
        {task.supervisor_name && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 2 }}>Supervisor: {task.supervisor_name}</div>}
      </div>

      {/* Advance button */}
      {nextStep && (
        <button
          className="btn btn-primary btn-sm"
          style={{ width: '100%', marginBottom: 20, padding: '10px 0', fontSize: 13 }}
          onClick={handleAdvance}
          disabled={advancing}
        >
          {advancing ? 'Updating…' : nextStep.label}
        </button>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Checklist ({checklist.filter(c => c.is_done).length}/{checklist.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map(item => (
              <label
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}
              >
                <input
                  type="checkbox"
                  checked={item.is_done}
                  onChange={() => toggleChecklist(item.id, item.is_done)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, textDecoration: item.is_done ? 'line-through' : 'none', color: item.is_done ? 'rgba(0,0,0,0.35)' : undefined }}>
                  {item.checklist_item_text ?? item.text}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Photos ({photos.length})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photos.map(p => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img
                  src={p.image}
                  alt={p.caption || p.photo_type}
                  style={{ width: 100, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)' }}
                />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 9, padding: '2px 4px', borderRadius: '0 0 6px 6px', textAlign: 'center' }}>
                  {p.photo_type}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {task.notes && (
        <div style={{ marginBottom: 20, padding: '10px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 4 }}>NOTES</div>
          <div style={{ fontSize: 13 }}>{task.notes}</div>
        </div>
      )}

      {/* Escalate to maintenance */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
        {!showEscalate ? (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: '#c92a2a', borderColor: '#c92a2a' }}
            onClick={() => setShowEscalate(true)}
          >
            Escalate to Maintenance
          </button>
        ) : (
          <form onSubmit={handleEscalate}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#c92a2a', marginBottom: 10 }}>
              Escalate Defect — Maintenance Manager will be notified immediately
            </div>
            <Field label="Description" required>
              <textarea
                required
                style={{ ...inputStyle, height: 64, resize: 'vertical' }}
                value={escalateForm.description}
                onChange={e => setEscalateForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe the defect…"
              />
            </Field>
            <Field label="Severity">
              <select style={inputStyle} value={escalateForm.severity} onChange={e => setEscalateForm(f => ({ ...f, severity: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowEscalate(false)}>Cancel</button>
              <button type="submit" className="btn btn-sm" style={{ background: '#c92a2a', color: '#fff', border: 'none', cursor: 'pointer' }} disabled={escalating}>
                {escalating ? 'Escalating…' : 'Escalate Defect'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Housekeeping main section ───────────────────────────────────────────────

const HK_TABS = [
  { key: 'matrix', label: 'Matrix' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'log', label: 'Log' },
];

function HousekeepingSection() {
  const [tab, setTab] = useState('matrix');
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  return (
    <div>
      <SubTabBar tabs={HK_TABS} active={tab} onChange={setTab} />
      <div style={{ marginTop: 20 }}>
        {tab === 'matrix'      && <HousekeepingMatrixTab onSelectTaskId={setSelectedTaskId} />}
        {tab === 'tasks'       && <HousekeepingTasksTab onSelectTask={t => setSelectedTaskId(t.id)} />}
        {tab === 'schedules'   && <CleaningSchedulesTab />}
        {tab === 'inspections' && <InspectionChecklistsTab />}
        {tab === 'log'         && <HousekeepingLogTab />}
      </div>

      <Drawer open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} title="Task Details" width={500}>
        {selectedTaskId && (
          <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}
      </Drawer>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED: Sub-tab bar
// ════════════════════════════════════════════════════════════════════════════

function SubTabBar({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <div key={t.key} className={`tab${active === t.key ? ' active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TOP-LEVEL: ActivitiesHousekeeping screen
// ════════════════════════════════════════════════════════════════════════════

const TOP_TABS = [
  { key: 'activities', label: 'Activities' },
  { key: 'housekeeping', label: 'Housekeeping' },
];

export default function ActivitiesHousekeeping() {
  const [topTab, setTopTab] = useState('activities');

  return (
    <div>
      <PageHeader
        title="Activities & Housekeeping"
        subtitle="Bookable boater activities — paddleboard rentals, lessons, guided trips — plus the cleaning side: housekeeping tasks, schedules, and the staff board."
        infoBody={SCREEN_INFO.activities}
      />
      {/* Top-level tab bar */}
      <div className="tabs">
        {TOP_TABS.map(t => (
          <div key={t.key} className={`tab${topTab === t.key ? ' active' : ''}`} onClick={() => setTopTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {topTab === 'activities'   && <ActivitiesSection />}
      {topTab === 'housekeeping' && <HousekeepingSection />}
    </div>
  );
}
