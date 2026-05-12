import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function MarinaCard({ card, onOpen, loading }) {
  const oColor = card.occupancy_pct >= 80 ? 'var(--red)' : card.occupancy_pct >= 50 ? 'var(--orange)' : 'var(--green)';
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{card.name}</div>
          <span className={`badge badge-${card.status === 'active' ? 'green' : 'gray'}`}>{card.status}</span>
        </div>
        <button className="btn btn-primary btn-sm" disabled={loading} onClick={onOpen} style={{ gap: 5 }}>
          <Ic n="log-in" s={11} /> Open
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Occupancy</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: oColor }}>{card.occupancy_pct}%</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Active / Berths</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{card.active_bookings} / {card.total_berths}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Revenue MTD</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{card.currency} {parseFloat(card.revenue_this_month).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
    </div>
  );
}

export default function Overview({ group }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
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
  if (error)   return <div className="empty"><div className="empty-title">Failed to load overview.</div></div>;
  if (!data)   return null;

  const { kpis, marinas } = data;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Overview</div>
      </div>

      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Berths',     val: kpis.total_berths.toLocaleString(),                               icon: 'anchor' },
          { label: 'Active Bookings',  val: kpis.total_active_bookings.toLocaleString(),                      icon: 'users'  },
          { label: 'MRR',              val: `${group.base_currency} ${Number(kpis.total_mrr).toLocaleString()}`, icon: 'dollar' },
          { label: 'Outstanding',      val: `${group.base_currency} ${parseFloat(kpis.total_outstanding).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: 'alert-tri' },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div className="stat-label">{k.label}</div>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.4)' }}>
                <Ic n={k.icon} s={13} />
              </div>
            </div>
            <div className="stat-val">{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
        {marinas.map(card => (
          <MarinaCard
            key={card.id}
            card={card}
            loading={ssoLoading === card.id}
            onOpen={() => handleOpen(card)}
          />
        ))}
      </div>
    </div>
  );
}
