import { useCallback, useEffect, useState } from 'react';
import api from '../../../api.js';
import { SecHdr, Empty, Loading, Err, fmtDT } from '../shared.jsx';

function groupBySlot(bookings) {
  const map = new Map();
  for (const b of bookings) {
    const key = `${b.activity}:${b.start_datetime}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        activity: b.activity,
        activity_name: b.activity_name ?? `Activity #${b.activity}`,
        start_datetime: b.start_datetime,
        capacity_max: b.activity_capacity_max ?? null,
        requests: [],
      });
    }
    map.get(key).requests.push(b);
  }
  return Array.from(map.values());
}

export default function RequestsInbox() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/activity-bookings/', { params: { status: 'requested' } })
      .then(r => setRequests(r.data.results ?? r.data))
      .catch(() => setError('Failed to load requests.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirmOne(b) {
    try {
      await api.post(`/activity-bookings/${b.id}/confirm/`);
      load();
    } catch (e) {
      if (e.response?.status === 409) {
        alert(`Capacity exceeded. ${e.response.data?.remaining ?? 0} seats remaining.`);
        load();
      } else {
        alert('Failed to confirm.');
      }
    }
  }

  async function rejectOne(b) {
    const reason = prompt('Rejection reason (optional)') ?? '';
    try {
      await api.post(`/activity-bookings/${b.id}/reject/`, { reason });
      load();
    } catch {
      alert('Failed to reject.');
    }
  }

  async function rejectOverflow(group) {
    if (group.capacity_max == null) return;
    const sorted = group.requests
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const overflow = sorted.slice(group.capacity_max);
    if (!overflow.length) return;
    if (!confirm(`Reject ${overflow.length} overflow request(s)?`)) return;
    await Promise.all(overflow.map(b =>
      api.post(`/activity-bookings/${b.id}/reject/`, {
        reason: 'Slot full — please contact us to rebook.',
      })
    ));
    load();
  }

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;

  const groups = groupBySlot(requests);

  if (!groups.length) {
    return (
      <div>
        <SecHdr title="Requests" />
        <Empty title="No pending requests" subtitle="Public requests will appear here." />
      </div>
    );
  }

  return (
    <div>
      <SecHdr title="Requests" />
      {groups.map(g => {
        const reqSeats = g.requests.reduce((s, r) => s + r.participant_count, 0);
        const capacity = g.capacity_max ?? '?';
        const overbooked = g.capacity_max != null && reqSeats > g.capacity_max;
        return (
          <div
            key={g.key}
            className="card"
            style={{
              marginBottom: 16, padding: 14,
              borderLeft: overbooked ? '3px solid #f59f00' : undefined,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{g.activity_name} — {fmtDT(g.start_datetime)}</div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                  {capacity} capacity · {reqSeats} seats requested
                  {overbooked && ' · ⚠ over capacity'}
                </div>
              </div>
              {overbooked && (
                <button className="btn btn-ghost btn-sm" onClick={() => rejectOverflow(g)}>
                  Reject overflow
                </button>
              )}
            </div>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr><th>Lead</th><th>Participants</th><th>Submitted</th><th style={{ width: 180 }}></th></tr>
              </thead>
              <tbody>
                {g.requests
                  .slice()
                  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                  .map((b, idx, arr) => {
                    // Cumulative seats up to and including this row
                    const cumulative = arr.slice(0, idx + 1).reduce((s, r) => s + r.participant_count, 0);
                    const wouldExceed = g.capacity_max != null && cumulative > g.capacity_max;
                    return (
                      <tr key={b.id}>
                        <td>
                          {b.lead_name || '—'}
                          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{b.lead_email}</div>
                        </td>
                        <td>{b.participant_count}</td>
                        <td style={{ fontSize: 12 }}>{fmtDT(b.created_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={wouldExceed}
                            title={wouldExceed ? 'Would exceed capacity. Reject or rebook.' : ''}
                            onClick={() => confirmOne(b)}
                          >
                            Confirm
                          </button>
                          {' '}
                          <button className="btn btn-ghost btn-sm" onClick={() => rejectOne(b)}>
                            Reject
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
