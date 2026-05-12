import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function Marinas({ group }) {
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [ssoLoading, setSsoLoading] = useState(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setData(null);
    setError(false);
    api.get(`enterprise/groups/${group.id}/overview/`)
      .then(r => { if (!ignore) setData(r.data); })
      .catch(() => { if (!ignore) setError(true); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [group.id]);

  async function handleOpen(card) {
    setSsoLoading(card.id);
    try {
      const { data: td } = await api.post(`enterprise/groups/${group.id}/exchange_token/`, { marina_id: card.id });
      const marinaUrl = import.meta.env.VITE_MARINA_URL || 'http://localhost:5173';
      window.open(`${marinaUrl}?sso_token=${td.access}`, '_blank');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to open marina.');
    } finally {
      setSsoLoading(null);
    }
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load marinas.</div></div>;
  if (!data)   return null;

  const { marinas } = data;
  const fmt = v => parseFloat(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">
          Marinas <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({marinas.length})</span>
        </div>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Marina</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Occupancy</th>
              <th style={{ textAlign: 'right' }}>Active / Berths</th>
              <th style={{ textAlign: 'right' }}>Revenue MTD</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {marinas.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No marinas in group.</td></tr>
            ) : marinas.map(card => (
              <tr key={card.id}>
                <td><div className="tbl-name">{card.name}</div></td>
                <td><span className={`badge badge-${card.status === 'active' ? 'green' : 'gray'}`}>{card.status}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontWeight: 600, color: card.occupancy_pct >= 80 ? 'var(--red)' : card.occupancy_pct >= 50 ? 'var(--orange)' : 'var(--green)' }}>
                    {Math.round(card.occupancy_pct)}%
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{card.active_bookings} / {card.total_berths}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{card.currency} {fmt(card.revenue_this_month)}</td>
                <td>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={ssoLoading === card.id}
                    onClick={() => handleOpen(card)}
                    style={{ gap: 5 }}
                  >
                    <Ic n="log-in" s={11} /> Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
