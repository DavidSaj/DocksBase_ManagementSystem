import { useState, useEffect } from 'react';
import api from '../api.js';

function RevenueChart({ data, currency }) {
  if (!data || data.length === 0) return null;
  const maxTotal = Math.max(...data.map(m => parseFloat(m.total)));
  if (maxTotal === 0) return (
    <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
      No revenue data yet.
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 140, marginBottom: 6 }}>
        {data.map((month) => {
          const pct = (parseFloat(month.total) / maxTotal) * 100;
          return (
            <div key={month.period} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div
                title={`${month.period}: ${currency} ${parseFloat(month.total).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                style={{
                  height: `${pct}%`,
                  minHeight: parseFloat(month.total) > 0 ? 3 : 0,
                  background: 'var(--navy2)',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 0.3s',
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {data.map(month => (
          <div key={month.period} style={{ flex: 1, fontSize: 9, color: 'rgba(0,0,0,0.35)', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {month.period.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Financials({ group }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setData(null);
    setError(false);
    api.get(`enterprise/groups/${group.id}/financials/`)
      .then(r => { if (!ignore) setData(r.data); })
      .catch(() => { if (!ignore) setError(true); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [group.id]);

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load financials.</div></div>;
  if (!data)   return null;

  const fmt = v => parseFloat(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">
          Financials
          <span style={{ fontWeight: 400, fontSize: 12, color: 'rgba(0,0,0,0.38)', marginLeft: 6 }}>{data.base_currency}</span>
        </div>
      </div>

      {data.missing_fx && data.missing_fx.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff8e1', borderRadius: 6, fontSize: 12, color: '#795548', border: '1px solid rgba(180,130,0,0.2)' }}>
          Missing exchange rates for: {data.missing_fx.join(', ')}. Those amounts are excluded from totals.
        </div>
      )}

      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Paid This Month', val: `${data.base_currency} ${fmt(data.paid_this_month)}` },
          { label: 'Outstanding',     val: `${data.base_currency} ${fmt(data.outstanding)}` },
          { label: 'MRR',             val: `${data.base_currency} ${fmt(data.mrr)}` },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div className="stat-label">{k.label}</div>
            <div className="stat-val" style={{ fontSize: 22 }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Revenue — 12 months</div>
        <RevenueChart data={data.monthly_revenue} currency={data.base_currency} />
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Period</th>
              <th style={{ textAlign: 'right' }}>Total ({data.base_currency})</th>
            </tr>
          </thead>
          <tbody>
            {[...data.monthly_revenue].reverse().map(month => (
              <tr key={month.period}>
                <td>{month.period}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmt(month.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
