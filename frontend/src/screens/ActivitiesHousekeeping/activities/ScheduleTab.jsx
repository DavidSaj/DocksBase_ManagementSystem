import { useState, useEffect } from 'react';
import api from '../../../api.js';
import { bookingStatusBadge, fmtTime, today, Loading, Empty, Err, SecHdr } from '../shared.jsx';

export default function ScheduleTab() {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/activity-bookings/', { params: { date: today(), status: 'confirmed' } })
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
