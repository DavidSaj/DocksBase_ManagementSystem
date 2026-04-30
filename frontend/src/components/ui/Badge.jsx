const STATUS_MAP = {
  occupied:      'badge-blue',
  available:     'badge-green',
  reserved:      'badge-gold',
  maintenance:   'badge-red',
  active:        'badge-green',
  confirmed:     'badge-blue',
  pending:       'badge-gold',
  overdue:       'badge-red',
  paid:          'badge-green',
  unpaid:        'badge-orange',
  scheduled:     'badge-teal',
  complete:      'badge-green',
  'in-progress': 'badge-blue',
  missing:       'badge-red',
  Transient:     'badge-navy',
  Seasonal:      'badge-gold',
};

export default function StatusBadge({ s }) {
  return (
    <span className={`badge ${STATUS_MAP[s] || 'badge-gray'}`}>{s}</span>
  );
}
