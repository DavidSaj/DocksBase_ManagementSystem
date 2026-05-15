import { useEffect, useState } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { SecHdr, Empty, Loading, Err, Field, inputStyle } from '../shared.jsx';

const WEEKDAYS = [
  [0, 'Mon'], [1, 'Tue'], [2, 'Wed'], [3, 'Thu'],
  [4, 'Fri'], [5, 'Sat'], [6, 'Sun'],
];

export default function WeeklySlotsTab() {
  const [activities, setActivities] = useState([]);
  const [selected, setSelected] = useState('');
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/activity-catalogue/')
      .then(r => setActivities(r.data.results ?? r.data))
      .catch(() => setError('Failed to load activities.'));
  }, []);

  useEffect(() => {
    if (!selected) { setSlots([]); return; }
    setLoading(true);
    api.get(`/activity-time-slots/?activity=${selected}`)
      .then(r => setSlots(r.data.results ?? r.data))
      .catch(() => setError('Failed to load slots.'))
      .finally(() => setLoading(false));
  }, [selected]);

  async function addSlot(weekday) {
    const start = prompt('Start time (HH:MM, 24h)');
    if (!start || !/^\d{2}:\d{2}$/.test(start)) return;
    try {
      const { data } = await api.post('/activity-time-slots/', {
        activity: Number(selected),
        weekday,
        start_time: `${start}:00`,
        is_active: true,
      });
      setSlots(s => [...s, data]);
    } catch (e) {
      const detail = e.response?.data?.non_field_errors?.[0] || e.response?.data?.detail || 'Failed to add slot.';
      alert(detail);
    }
  }

  async function toggleSlot(slot) {
    const { data } = await api.patch(`/activity-time-slots/${slot.id}/`, { is_active: !slot.is_active });
    setSlots(s => s.map(x => x.id === slot.id ? data : x));
  }

  async function deleteSlot(slot) {
    if (!confirm('Delete slot?')) return;
    await api.delete(`/activity-time-slots/${slot.id}/`);
    setSlots(s => s.filter(x => x.id !== slot.id));
  }

  return (
    <div>
      <SecHdr title="Weekly Slots" />
      <div className="filter-row">
        <Field label="Activity">
          <select
            style={{ ...inputStyle, width: 280 }}
            value={selected}
            onChange={e => setSelected(e.target.value)}
          >
            <option value="">Select activity…</option>
            {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      {error && <Err msg={error} />}
      {!selected ? (
        <Empty title="Select an activity" subtitle="Choose an activity to manage its weekly slots." />
      ) : loading ? <Loading /> : (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {WEEKDAYS.map(([wd, label]) => {
              const daySlots = slots
                .filter(s => s.weekday === wd)
                .sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={wd} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 6, padding: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                  {daySlots.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 13, opacity: s.is_active ? 1 : 0.4 }}>
                        {s.start_time.slice(0, 5)}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleSlot(s)}>
                        {s.is_active ? 'On' : 'Off'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteSlot(s)}>
                        <Ic n="x" s={11} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => addSlot(wd)}
                    style={{ width: '100%' }}
                  >
                    + Add
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
