import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api.js';
import Turnstile from '../../components/Turnstile.jsx';
import { useUserContext } from '../../context/UserContext.jsx';

function fmtSlot(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function today() { return new Date().toISOString().slice(0, 10); }
function addDays(s, n) {
  const d = new Date(s);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function ActivityDetail() {
  const { slug, activityId } = useParams();
  const nav = useNavigate();
  // useUserContext returns { user, capabilities, marinaSlug }
  // user has { type, email } — no name field available
  const { user } = useUserContext() ?? {};

  const [activity, setActivity] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({
    participant_count: 1,
    lead_name:  '',
    lead_email: user?.email || '',
    lead_phone: '',
    notes: '',
  });
  const [captchaToken, setCaptchaToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Fetch activity (from the list endpoint, filter by id).
  useEffect(() => {
    api.get(`/public/activities/?marina=${slug}`).then(r => {
      const list = r.data || [];
      const found = list.find(a => String(a.id) === String(activityId));
      setActivity(found || null);
    }).catch(() => setActivity(null));
  }, [slug, activityId]);

  // Fetch slots for next 30 days.
  useEffect(() => {
    if (!activityId) return;
    const from = today();
    const to   = addDays(from, 30);
    api.get(`/public/activities/${activityId}/slots/?from=${from}&to=${to}`)
      .then(r => setSlots(r.data.slots || []))
      .catch(() => setError('Could not load slots.'));
  }, [activityId]);

  async function fetchSlots() {
    const from = today();
    const to   = addDays(from, 30);
    const r = await api.get(`/public/activities/${activityId}/slots/?from=${from}&to=${to}`);
    setSlots(r.data.slots || []);
  }

  async function submit(e) {
    e.preventDefault();
    if (!selectedSlot || !captchaToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/public/activity-requests/', {
        marina_slug:       slug,
        activity_id:       Number(activityId),
        start_datetime:    selectedSlot.start_datetime,
        participant_count: Number(form.participant_count),
        lead_name:         form.lead_name,
        lead_email:        form.lead_email,
        lead_phone:        form.lead_phone,
        notes:             form.notes,
        captcha_token:     captchaToken,
      });
      nav(`/${slug}/activities/${activityId}/requested?ref=${data.id}`);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (err.response?.status === 409) {
        setError('That slot was just filled. Please pick another.');
        await fetchSlots();
        setSelectedSlot(null);
      } else if (detail === 'captcha_failed') {
        setError('CAPTCHA failed. Please refresh and try again.');
      } else {
        setError('Could not submit request. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (activity === null && !error) return <div className="p-feed__empty">Loading…</div>;
  if (!activity) return <div className="p-feed__empty">Activity not found.</div>;

  return (
    <div className="p-page" style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: 4 }}>{activity.name}</h1>
      {activity.description && (
        <p style={{ color: 'rgba(0,0,0,0.6)', marginBottom: 20 }}>{activity.description}</p>
      )}

      <h2 className="p-eyebrow" style={{ marginBottom: 8 }}>Pick a slot</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {slots.map(s => {
          const isSelected = selectedSlot?.start_datetime === s.start_datetime;
          const disabled = s.state === 'full';
          return (
            <button
              key={s.start_datetime}
              type="button"
              disabled={disabled}
              onClick={() => setSelectedSlot(s)}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: isSelected ? '2px solid #1c7ed6' : '1px solid rgba(0,0,0,0.15)',
                background: disabled ? 'rgba(0,0,0,0.04)' : '#fff',
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtSlot(s.start_datetime)}</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
                {s.state === 'full'
                  ? 'Fully requested — contact marina'
                  : s.state === 'low'
                    ? `Only ${s.available} spots left`
                    : `${s.available} spots`}
              </div>
            </button>
          );
        })}
        {slots.length === 0 && <div className="p-feed__empty">No upcoming slots.</div>}
      </div>

      {selectedSlot && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Participants</span>
            <input
              type="number"
              min={1}
              max={activity.capacity_max}
              required
              value={form.participant_count}
              onChange={e => setForm(f => ({ ...f, participant_count: e.target.value }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Name</span>
            <input required value={form.lead_name} onChange={e => setForm(f => ({ ...f, lead_name: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Email</span>
            <input type="email" required value={form.lead_email} onChange={e => setForm(f => ({ ...f, lead_email: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Phone</span>
            <input value={form.lead_phone} onChange={e => setForm(f => ({ ...f, lead_phone: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Notes</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <Turnstile onToken={setCaptchaToken} />
          {error && <div className="p-feed__empty" style={{ color: '#c92a2a' }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting || !captchaToken}
            style={{ padding: '10px 16px', borderRadius: 6, border: 0, background: '#1c7ed6', color: '#fff', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer' }}
          >
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </form>
      )}
    </div>
  );
}
