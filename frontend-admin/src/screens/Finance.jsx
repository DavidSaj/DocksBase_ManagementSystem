import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Finance() {
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    api.get('/admin/finance/').then(r => setData(r.data));
    api.get('/admin/payments/').then(r => setPayments(r.data));
  }, []);

  const fmt = n => n != null ? `€${Number(n).toLocaleString()}` : '—';

  if (!data) return <div style={{ color: '#999' }}>Loading…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Finance</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        {[['MRR', data.mrr], ['ARR', data.arr], ['Avg per Account', data.avg_revenue_per_account]].map(([l, v]) => (
          <div key={l} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>{l}</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{fmt(v)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Revenue by Plan</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr>{['Plan', 'Marinas', 'Revenue/mo'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 0', color: '#999', fontSize: 12 }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.revenue_by_plan?.map(p => (
                <tr key={p.plan}><td style={{ padding: '6px 0' }}>{p.plan}</td><td>{p.count}</td><td>{fmt(p.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Revenue by Marina</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr>{['Marina', 'Plan', 'MRR'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 0', color: '#999', fontSize: 12 }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.revenue_by_marina?.slice(0, 10).map((m, i) => (
                <tr key={i}><td style={{ padding: '6px 0' }}>{m.name}</td><td>{m.plan}</td><td>{fmt(m.mrr)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Payment History</h3>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr>{['Marina', 'Amount', 'Status', 'Period', 'Paid At'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 0', color: '#999', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr></thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f9f9f9' }}>
                <td style={{ padding: '8px 0' }}>{p.marina_name || p.marina}</td>
                <td>{fmt(p.amount)}</td>
                <td style={{ color: p.status === 'overdue' ? '#dc2626' : p.status === 'paid' ? '#16a34a' : '#d97706' }}>{p.status}</td>
                <td style={{ color: '#999' }}>{p.period_start}</td>
                <td style={{ color: '#999' }}>{p.paid_at?.slice(0, 10) || '—'}</td>
              </tr>
            ))}
            {!payments.length && <tr><td colSpan={5} style={{ padding: 16, color: '#999', textAlign: 'center' }}>No payment records</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
