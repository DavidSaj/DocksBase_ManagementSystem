import useServiceCatalog from '../hooks/useServiceCatalog.js';

const PRICING_MODEL_LABELS = {
  flat:      'Flat Rate',
  per_night: 'Per Night',
  per_metre: 'Per Metre',
  per_litre: 'Per Litre',
  per_hour:  'Per Hour',
  per_kg:    'Per Kg',
};

function fmtPrice(val) {
  if (val == null) return '—';
  return `€${Number(val).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CatalogList({ category, onRowClick }) {
  const { items, loading, error } = useServiceCatalog(category);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 12, color: 'var(--red)' }}>
        Failed to load catalog items.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
        No pricing rules found. Click &ldquo;+ New Pricing Rule&rdquo; to add one.
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>Pricing Model</th>
            <th>Unit Price</th>
            <th>Tax %</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr
              key={item.id}
              onClick={() => onRowClick && onRowClick(item)}
              style={{ cursor: 'pointer' }}
            >
              <td>
                <div className="tbl-name">{item.name}</div>
              </td>
              <td style={{ fontSize: 12 }}>
                {PRICING_MODEL_LABELS[item.pricing_model] ?? item.pricing_model_display ?? item.pricing_model ?? '—'}
              </td>
              <td style={{ fontSize: 13, fontWeight: 600 }}>
                {fmtPrice(item.unit_price)}
              </td>
              <td style={{ fontSize: 12 }}>
                {item.tax_rate != null ? `${item.tax_rate}%` : '—'}
              </td>
              <td>
                {item.is_active
                  ? <span className="badge badge-green">Active</span>
                  : <span className="badge badge-gray">Inactive</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
