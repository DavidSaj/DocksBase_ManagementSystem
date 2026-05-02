export const CELL = 20; // pixels per metre at scale 1

// Grid display
export const GRID_MINOR = CELL;      // line every 1m (fine)
export const GRID_MAJOR = CELL * 5;  // line every 5m (accent)

export const STATUS_COLORS = {
  available:   '#22c55e',
  occupied:    '#ef4444',
  reserved:    '#f59e0b',
  maintenance: '#6b7280',
};

export const PIER_TYPE_COLORS = {
  concrete: '#94a3b8',
  pontoon:  '#a16207',
  land:     '#86efac',
};

export const PIER_TYPES = [
  { value: 'concrete', label: 'Concrete Pier',  color: '#94a3b8' },
  { value: 'pontoon',  label: 'Wooden Pontoon', color: '#a16207' },
  { value: 'land',     label: 'Land / Grass',   color: '#86efac' },
];

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
