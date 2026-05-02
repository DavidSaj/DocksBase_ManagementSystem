export const CELL = 20; // pixels per metre at scale 1

export const STATUS_COLORS = {
  available:   '#22c55e',
  occupied:    '#ef4444',
  reserved:    '#f59e0b',
  maintenance: '#6b7280',
};

export const AMENITY_TYPES = [
  { value: 'harbour_master', label: 'Harbour Master' },
  { value: 'fuel',           label: 'Fuel Pump' },
  { value: 'toilets',        label: 'Toilets' },
  { value: 'showers',        label: 'Showers' },
  { value: 'restaurant',     label: 'Restaurant' },
  { value: 'parking',        label: 'Parking' },
  { value: 'electricity',    label: 'Electricity' },
  { value: 'water',          label: 'Water' },
  { value: 'gate',           label: 'Security Gate' },
  { value: 'waste',          label: 'Waste Disposal' },
  { value: 'chandlery',      label: 'Chandlery' },
  { value: 'first_aid',      label: 'First Aid' },
];
