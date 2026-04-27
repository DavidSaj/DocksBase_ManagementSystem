// ── EXISTING DATA ────────────────────────────────────────────────────────────

// Price tiers: 8m=28, 10m=38, 12m=48, 14m=62, 15m=72, 18m=88, 20m=95, 25m=140
// Amenities: Pier A = power+water+wifi, Pier B = power+water+wifi+fuel, Pier C = power+water
// maxDraft: reasonable depth per slip

export const PIERS = [
  { id: 'A', slips: [
    { id: 'A1', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Ocean Star',  owner: 'C. Hammond',  type: 'Motor Yacht', draft: '1.8m' },
    { id: 'A2', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Seabird III', owner: 'T. Marchetti', type: 'Catamaran',   draft: '1.2m' },
    { id: 'A3', len: '15m', maxDraft: '3.0m', pricePerNight: 72, amenities: ['power','water','wifi'], status: 'available',   vessel: null },
    { id: 'A4', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'],        status: 'maintenance', vessel: null },
    { id: 'A5', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Lady K',      owner: 'A. Schwartz',  type: 'Motor Yacht', draft: '2.1m' },
    { id: 'A6', len: '20m', maxDraft: '3.5m', pricePerNight: 95, amenities: ['power','water','wifi'], status: 'reserved',    vessel: 'Nordic Blue', owner: 'K. Eriksson',  type: 'Sailboat',    draft: '2.4m' },
    { id: 'A7', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi'], status: 'available',   vessel: null },
    { id: 'A8', len: '14m', maxDraft: '3.0m', pricePerNight: 62, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Windseeker',  owner: 'R. Fontaine',  type: 'Sailboat',    draft: '1.5m' },
  ]},
  { id: 'B', slips: [
    { id: 'B1', len: '18m', maxDraft: '3.8m', pricePerNight: 88, amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Blue Horizon', owner: 'M. Osei',      type: 'Motor Yacht', draft: '2.4m' },
    { id: 'B2', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Saltwater',    owner: 'J. Hartmann',  type: 'Sailboat',    draft: '1.4m' },
    { id: 'B3', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi','fuel'], status: 'available',   vessel: null },
    { id: 'B4', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi','fuel'], status: 'reserved',    vessel: 'Puffin',       owner: 'S. Yamamoto',  type: 'Sailboat',    draft: '1.3m' },
    { id: 'B5', len: '25m', maxDraft: '4.5m', pricePerNight: 140,amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Nautilus V',   owner: 'B. Rousseau',  type: 'Superyacht',  draft: '3.0m' },
    { id: 'B6', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi','fuel'], status: 'available',   vessel: null },
    { id: 'B7', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','fuel'],        status: 'maintenance', vessel: null },
    { id: 'B8', len: '14m', maxDraft: '3.2m', pricePerNight: 62, amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Avalon',       owner: 'P. Singh',     type: 'Motor Yacht', draft: '1.9m' },
  ]},
  { id: 'C', slips: [
    { id: 'C1', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'], status: 'available',   vessel: null },
    { id: 'C2', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'], status: 'occupied',    vessel: 'Pebble',       owner: 'G. Costa',     type: 'Dinghy',      draft: '0.6m' },
    { id: 'C3', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water'], status: 'occupied',    vessel: 'Storm Chaser', owner: 'W. James',     type: 'Sailboat',    draft: '1.6m' },
    { id: 'C4', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'], status: 'available',   vessel: null },
    { id: 'C5', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water'], status: 'reserved',    vessel: 'Tempest',      owner: 'L. Müller',    type: 'Sailboat',    draft: '1.7m' },
    { id: 'C6', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water'], status: 'occupied',    vessel: 'Horizon',      owner: 'F. Nakamura',  type: 'Motor Yacht', draft: '1.8m' },
  ]},
];

export const BOOKINGS = [
  { id: 'BK-1041', vessel: 'Ocean Star',  owner: 'C. Hammond',  berth: 'A1', checkin: '22 Apr', checkout: '26 Apr', nights: 4,   type: 'Transient', status: 'active',    paid: true,  amount: '€480' },
  { id: 'BK-1042', vessel: 'Windseeker',  owner: 'R. Fontaine', berth: 'A8', checkin: '23 Apr', checkout: '25 Apr', nights: 2,   type: 'Transient', status: 'active',    paid: true,  amount: '€220' },
  { id: 'BK-1043', vessel: 'Seabird III', owner: 'T. Marchetti',berth: 'A2', checkin: '21 Apr', checkout: '27 Apr', nights: 6,   type: 'Transient', status: 'active',    paid: false, amount: '€660' },
  { id: 'BK-1044', vessel: 'Lady K',      owner: 'A. Schwartz', berth: 'A5', checkin: '23 Apr', checkout: '24 Apr', nights: 1,   type: 'Transient', status: 'pending',   paid: false, amount: '€150' },
  { id: 'BK-1045', vessel: 'Saltwater',   owner: 'J. Hartmann', berth: 'B2', checkin: '20 Apr', checkout: '23 Apr', nights: 3,   type: 'Transient', status: 'overdue',   paid: false, amount: '€330' },
  { id: 'BK-1046', vessel: 'Blue Horizon',owner: 'M. Osei',     berth: 'B1', checkin: '24 Apr', checkout: '28 Apr', nights: 4,   type: 'Transient', status: 'confirmed', paid: true,  amount: '€640' },
  { id: 'BK-1047', vessel: 'Puffin',      owner: 'S. Yamamoto', berth: 'B4', checkin: '23 Apr', checkout: '25 Apr', nights: 2,   type: 'Transient', status: 'pending',   paid: false, amount: '€200' },
  { id: 'BK-S01',  vessel: 'Nautilus V',  owner: 'B. Rousseau', berth: 'B5', checkin: '1 May',  checkout: '31 Oct', nights: 183, type: 'Seasonal',  status: 'confirmed', paid: true,  amount: '€8,200' },
  { id: 'BK-S02',  vessel: 'Avalon',      owner: 'P. Singh',    berth: 'B8', checkin: '1 Apr',  checkout: '30 Sep', nights: 183, type: 'Seasonal',  status: 'confirmed', paid: true,  amount: '€5,500' },
];

export const HAUL_SCHEDULE = [
  { id: 'HS-01', vessel: 'Winter Gale',  owner: 'P. Andersen', type: 'Haul-out', date: 'Mon 28 Apr', time: '08:00', crane: 'Travelift A', crew: 'Yard Team 1', status: 'scheduled' },
  { id: 'HS-02', vessel: 'Sea Sprite',   owner: 'M. Walsh',    type: 'Splash',   date: 'Mon 28 Apr', time: '10:30', crane: 'Travelift A', crew: 'Yard Team 1', status: 'scheduled' },
  { id: 'HS-03', vessel: 'Arctic Fox',   owner: 'T. Berg',     type: 'Haul-out', date: 'Tue 29 Apr', time: '09:00', crane: 'Travelift B', crew: 'Yard Team 2', status: 'scheduled' },
  { id: 'HS-04', vessel: 'Morning Tide', owner: 'H. Clarke',   type: 'Splash',   date: 'Tue 29 Apr', time: '14:00', crane: 'Travelift A', crew: 'Yard Team 1', status: 'scheduled' },
  { id: 'HS-05', vessel: 'Blue Dancer',  owner: 'C. Petit',    type: 'Haul-out', date: 'Wed 30 Apr', time: '08:00', crane: 'Travelift B', crew: 'Yard Team 2', status: 'confirmed' },
];

export const DRY_STORAGE = [
  ['Arctic Fox', 'Winter Gale', null,          'Comet',   'Sirocco',   'Blue Dancer'],
  [null,         'Sea Sprite',  'Morning Tide', null,      'White Cap',  null        ],
  ['Dune',       null,          null,           'Grey Seal', null,       'Iron Mast' ],
  [null,         null,          'Typhoon',      'Compass', null,         null        ],
];

export const INVOICES = [
  { id: 'INV-2041', vessel: 'Ocean Star',  owner: 'C. Hammond',  amount: '€480',   type: 'Berth Fee',  issued: '22 Apr', due: '26 Apr', status: 'paid' },
  { id: 'INV-2042', vessel: 'Seabird III', owner: 'T. Marchetti',amount: '€660',   type: 'Berth Fee',  issued: '21 Apr', due: '27 Apr', status: 'unpaid' },
  { id: 'INV-2043', vessel: 'Saltwater',   owner: 'J. Hartmann', amount: '€330',   type: 'Berth Fee',  issued: '20 Apr', due: '23 Apr', status: 'overdue' },
  { id: 'INV-2044', vessel: 'Nautilus V',  owner: 'B. Rousseau', amount: '€8,200', type: 'Seasonal',   issued: '1 Apr',  due: '1 May',  status: 'paid' },
  { id: 'INV-2045', vessel: 'Ocean Star',  owner: 'C. Hammond',  amount: '€62',    type: 'Electricity',issued: '22 Apr', due: '26 Apr', status: 'paid' },
  { id: 'INV-2046', vessel: 'Lady K',      owner: 'A. Schwartz', amount: '€150',   type: 'Berth Fee',  issued: '23 Apr', due: '24 Apr', status: 'pending' },
  { id: 'INV-2047', vessel: 'Blue Horizon',owner: 'M. Osei',     amount: '€640',   type: 'Berth Fee',  issued: '24 Apr', due: '28 Apr', status: 'paid' },
  { id: 'INV-2048', vessel: 'Windseeker',  owner: 'R. Fontaine', amount: '€220',   type: 'Berth Fee',  issued: '23 Apr', due: '25 Apr', status: 'paid' },
];

export const UTILITY_METERS = [
  { berth: 'A1', vessel: 'Ocean Star',  elec_start: 4821,  elec_cur: 4939,  water_start: 120, water_cur: 145 },
  { berth: 'A2', vessel: 'Seabird III', elec_start: 2100,  elec_cur: 2188,  water_start: 88,  water_cur: 101 },
  { berth: 'A5', vessel: 'Lady K',      elec_start: 6500,  elec_cur: 6543,  water_start: 210, water_cur: 218 },
  { berth: 'A8', vessel: 'Windseeker',  elec_start: 330,   elec_cur: 354,   water_start: 40,  water_cur: 45  },
  { berth: 'B1', vessel: 'Blue Horizon',elec_start: 9100,  elec_cur: 9340,  water_start: 480, water_cur: 512 },
  { berth: 'B2', vessel: 'Saltwater',   elec_start: 720,   elec_cur: 748,   water_start: 30,  water_cur: 35  },
  { berth: 'B5', vessel: 'Nautilus V',  elec_start: 11200, elec_cur: 11680, water_start: 820, water_cur: 890 },
];

export const MEMBERS = [
  { id: 'M-001', name: 'C. Hammond',  vessel: 'Ocean Star',  type: 'Transient', email: 'c.hammond@email.com',   phone: '+44 7700 900001', insurance: 'Dec 2025', docs: 'complete', joined: 'Jan 2024', tags: ['VIP', 'Repeat'] },
  { id: 'M-002', name: 'T. Marchetti',vessel: 'Seabird III', type: 'Transient', email: 't.marchetti@email.com', phone: '+39 347 0001234',  insurance: 'Oct 2025', docs: 'complete', joined: 'Mar 2024', tags: [] },
  { id: 'M-003', name: 'B. Rousseau', vessel: 'Nautilus V',  type: 'Seasonal',  email: 'b.rousseau@email.com',  phone: '+33 6 12 34 56 78',insurance: 'Jun 2026', docs: 'complete', joined: 'May 2022', tags: ['Seasonal', 'VIP'] },
  { id: 'M-004', name: 'J. Hartmann', vessel: 'Saltwater',   type: 'Transient', email: 'j.hartmann@email.com',  phone: '+31 6 98765432',  insurance: 'EXPIRED',  docs: 'missing',  joined: 'Aug 2023', tags: ['Outstanding Debt'] },
  { id: 'M-005', name: 'P. Singh',    vessel: 'Avalon',      type: 'Seasonal',  email: 'p.singh@email.com',     phone: '+44 7700 900005', insurance: 'Jan 2026', docs: 'complete', joined: 'Feb 2021', tags: ['Seasonal'] },
  { id: 'M-006', name: 'M. Osei',     vessel: 'Blue Horizon',type: 'Transient', email: 'm.osei@email.com',      phone: '+233 20 0001234', insurance: 'Jun 2026', docs: 'complete', joined: 'Sep 2023', tags: [] },
  { id: 'M-007', name: 'A. Schwartz', vessel: 'Lady K',      type: 'Transient', email: 'a.schwartz@email.com',  phone: '+49 151 00112233',insurance: 'Mar 2025', docs: 'pending',  joined: 'Nov 2024', tags: [] },
];

export const TASKS = [
  { id: 1, text: 'Empty trash bins on Pier A and Pier B',                                   assign: 'Dock Team A', priority: 'low',    done: false, dock: 'Pier A/B' },
  { id: 2, text: 'Assist inbound vessel Ocean Star at Slip A1 — 08:30',                     assign: 'Dock Team A', priority: 'high',   done: true,  dock: 'A1' },
  { id: 3, text: 'Clean bathhouse facilities — Block C',                                    assign: 'Dock Team B', priority: 'medium', done: false, dock: 'Block C' },
  { id: 4, text: 'Inspect Pier B cleats for damage after last night storm report',           assign: 'Dock Team B', priority: 'high',   done: false, dock: 'Pier B' },
  { id: 5, text: 'Confirm fuel dock pump calibration before 10:00',                         assign: 'Fuel Team',   priority: 'high',   done: false, dock: 'Fuel Dock' },
  { id: 6, text: 'Check berth A4 — maintenance flag, electrical issue pending inspection',  assign: 'Electrician', priority: 'medium', done: false, dock: 'A4' },
  { id: 7, text: 'Prepare Travelift A for haul-out schedule at 08:00 tomorrow',             assign: 'Yard Team 1', priority: 'high',   done: false, dock: 'Boatyard' },
  { id: 8, text: 'Send overdue payment reminder to J. Hartmann (BK-1045)',                  assign: 'Office',      priority: 'medium', done: false, dock: 'Office' },
];

export const INCIDENTS = [
  { id: 'INC-21', date: '22 Apr 09:14', vessel: 'Seabird III', berth: 'A2',    desc: 'Minor contact with finger pier on arrival. Gelcoat scuff on starboard bow. Photographed. Owner notified.', severity: 'low',    reporter: 'M. Hargreaves' },
  { id: 'INC-20', date: '21 Apr 17:30', vessel: '—',           berth: 'Pier B', desc: 'Cleat B7-3 reported loose. Dock crew flagged for maintenance. Berth B7 taken out of service.',           severity: 'medium', reporter: 'Dock Team B' },
  { id: 'INC-19', date: '19 Apr 11:00', vessel: 'Saltwater',   berth: 'B2',    desc: 'Vessel found listing 5° to port on morning inspection. Bilge pump activated. Owner contacted.',            severity: 'high',   reporter: 'M. Hargreaves' },
];

export const ACTIVITY_FEED = [
  { color: '#0075de', text: 'Ocean Star (A1) checked in. Capt. C. Hammond. Est. 4 nights.',    time: '08:42 today' },
  { color: '#1a8c2e', text: 'INV-2044 paid — Nautilus V seasonal berth €8,200.',               time: '08:15 today' },
  { color: '#dd5b00', text: 'Berth A4 flagged for maintenance — electrical fault.',             time: '07:58 today' },
  { color: '#b01c1c', text: 'Payment overdue: BK-1045 Saltwater. 3 days past due.',            time: '07:00 today' },
  { color: '#2a9d99', text: 'Travelift A service completed. Ready for haul-out schedule.',      time: 'Yesterday 17:30' },
  { color: '#615d59', text: 'Puffin (B4) booking confirmed. Arriving 23 Apr.',                  time: 'Yesterday 16:10' },
];

// ── VESSEL REGISTRY ──────────────────────────────────────────────────────────

export const VESSELS = [
  { id: 'V-001', name: 'Ocean Star',   reg: 'SSR-44231',  flag: 'GBR', mmsi: '235001201', callsign: 'MZOA3', type: 'Motor Yacht', loa: '12.0m', beam: '3.8m', draft: '1.8m', airDraft: '7.5m', yearBuilt: 2018, builder: 'Sunseeker',   model: 'Predator 50',    engine: 'Twin Volvo IPS 600',    fuel: 'Diesel', tankCap: '850L',  fwTank: '200L', shorePower: '32A', mooringPref: 'Finger',   owner: 'C. Hammond',  ownerRef: 'M-001', berth: 'A1', berthStatus: 'in-berth', aisActive: true,  insurance: { insurer: 'Pantaenius',   policy: 'PAN-2024-44231', expiry: 'Dec 2025', daysLeft: 245, status: 'valid'   }, safety: { flares: 'Jun 2025', lifeRaft: 'Mar 2027', epirb: 'Jan 2026', extinguisher: 'Apr 2026' } },
  { id: 'V-002', name: 'Seabird III',  reg: 'SSR-29812',  flag: 'ITA', mmsi: '247001802', callsign: 'ICFA1', type: 'Catamaran',   loa: '10.0m', beam: '5.2m', draft: '1.2m', airDraft: '18.5m',yearBuilt: 2015, builder: 'Leopard',    model: 'Leopard 42',     engine: 'Twin Volvo D2-40',      fuel: 'Diesel', tankCap: '320L',  fwTank: '300L', shorePower: '16A', mooringPref: 'Hammerhead', owner: 'T. Marchetti',ownerRef: 'M-002', berth: 'A2', berthStatus: 'in-berth', aisActive: true,  insurance: { insurer: 'Allianz',      policy: 'ALZ-IT-90033',   expiry: 'Oct 2025', daysLeft: 175, status: 'valid'   }, safety: { flares: 'Dec 2024', lifeRaft: 'Oct 2026', epirb: 'Mar 2026', extinguisher: 'Jan 2026' } },
  { id: 'V-003', name: 'Nautilus V',   reg: 'SSR-77001',  flag: 'FRA', mmsi: '228001005', callsign: 'FZNA5', type: 'Superyacht',  loa: '25.0m', beam: '6.8m', draft: '3.0m', airDraft: '28.0m',yearBuilt: 2021, builder: 'Ferretti',  model: 'Custom Line 96', engine: 'Triple MTU 12V 2000',   fuel: 'Diesel', tankCap: '6000L', fwTank: '800L', shorePower: '63A', mooringPref: 'Alongside', owner: 'B. Rousseau', ownerRef: 'M-003', berth: 'B5', berthStatus: 'in-berth', aisActive: true,  insurance: { insurer: 'Pantaenius',   policy: 'PAN-2024-77001', expiry: 'Jun 2026', daysLeft: 427, status: 'valid'   }, safety: { flares: 'Jan 2027', lifeRaft: 'Jun 2026', epirb: 'Apr 2027', extinguisher: 'Mar 2026' } },
  { id: 'V-004', name: 'Saltwater',    reg: 'SSR-31405',  flag: 'NLD', mmsi: '244001340', callsign: 'PHSW4', type: 'Sailboat',    loa: '10.0m', beam: '3.2m', draft: '1.4m', airDraft: '14.8m',yearBuilt: 2012, builder: 'Bavaria',   model: 'Cruiser 37',     engine: 'Volvo D1-30',           fuel: 'Diesel', tankCap: '130L',  fwTank: '100L', shorePower: '16A', mooringPref: 'Finger',   owner: 'J. Hartmann', ownerRef: 'M-004', berth: 'B2', berthStatus: 'in-berth', aisActive: false, insurance: { insurer: '—',            policy: '—',              expiry: 'EXPIRED',  daysLeft: -12, status: 'expired' }, safety: { flares: 'Mar 2024', lifeRaft: 'Nov 2025', epirb: 'Dec 2024', extinguisher: 'Jul 2025' } },
  { id: 'V-005', name: 'Avalon',       reg: 'SSR-58210',  flag: 'GBR', mmsi: '235005821', callsign: 'MAVL5', type: 'Motor Yacht', loa: '14.0m', beam: '4.1m', draft: '1.9m', airDraft: '6.8m', yearBuilt: 2019, builder: 'Fairline', model: 'Squadron 48',    engine: 'Twin Yanmar 4JH110',    fuel: 'Diesel', tankCap: '600L',  fwTank: '250L', shorePower: '32A', mooringPref: 'Finger',   owner: 'P. Singh',    ownerRef: 'M-005', berth: 'B8', berthStatus: 'in-berth', aisActive: true,  insurance: { insurer: 'Navigators',   policy: 'NAV-2025-58210', expiry: 'Jan 2026', daysLeft: 282, status: 'valid'   }, safety: { flares: 'Aug 2026', lifeRaft: 'Jan 2027', epirb: 'Nov 2026', extinguisher: 'Sep 2026' } },
  { id: 'V-006', name: 'Blue Horizon', reg: 'SSR-48833',  flag: 'GHA', mmsi: '627001488', callsign: 'GBHL6', type: 'Motor Yacht', loa: '18.0m', beam: '5.0m', draft: '2.4m', airDraft: '9.2m', yearBuilt: 2016, builder: 'Princess', model: 'V55',            engine: 'Twin IPS 900',          fuel: 'Diesel', tankCap: '1400L', fwTank: '350L', shorePower: '32A', mooringPref: 'Alongside', owner: 'M. Osei',     ownerRef: 'M-006', berth: 'B1', berthStatus: 'in-berth', aisActive: true,  insurance: { insurer: 'Pantaenius',   policy: 'PAN-2024-48833', expiry: 'Jun 2026', daysLeft: 427, status: 'valid'   }, safety: { flares: 'Mar 2026', lifeRaft: 'Feb 2027', epirb: 'Jul 2026', extinguisher: 'Dec 2025' } },
  { id: 'V-007', name: 'Lady K',       reg: 'SSR-61204',  flag: 'DEU', mmsi: '211001612', callsign: 'DLAK7', type: 'Motor Yacht', loa: '12.0m', beam: '3.7m', draft: '2.1m', airDraft: '8.0m', yearBuilt: 2020, builder: 'Beneteau', model: 'Gran Turismo 41',engine: 'Twin Volvo IPS 350',    fuel: 'Diesel', tankCap: '500L',  fwTank: '180L', shorePower: '16A', mooringPref: 'Finger',   owner: 'A. Schwartz', ownerRef: 'M-007', berth: 'A5', berthStatus: 'in-berth', aisActive: false, insurance: { insurer: 'ERGO Marine', policy: 'ERG-DE-61204',   expiry: 'Mar 2025', daysLeft: -30, status: 'expired' }, safety: { flares: 'Nov 2025', lifeRaft: 'Apr 2026', epirb: 'Jun 2025', extinguisher: 'Feb 2026' } },
  { id: 'V-008', name: 'Nordic Blue',  reg: 'SSR-90441',  flag: 'SWE', mmsi: '265001904', callsign: 'SENB8', type: 'Sailboat',    loa: '20.0m', beam: '5.5m', draft: '2.4m', airDraft: '29.0m',yearBuilt: 2017, builder: 'Hallberg-Rassy', model: 'HR 44DS', engine: 'Volvo D2-75',        fuel: 'Diesel', tankCap: '400L',  fwTank: '480L', shorePower: '32A', mooringPref: 'Alongside', owner: 'K. Eriksson', ownerRef: null, berth: 'A6', berthStatus: 'reserved', aisActive: true, insurance: { insurer: 'Trygg-Hansa', policy: 'TH-SE-90441',   expiry: 'Sep 2026', daysLeft: 520, status: 'valid'   }, safety: { flares: 'May 2026', lifeRaft: 'Aug 2027', epirb: 'Mar 2027', extinguisher: 'Oct 2026' } },
  { id: 'V-009', name: 'Windseeker',   reg: 'SSR-22781',  flag: 'FRA', mmsi: '228001227', callsign: 'FZWK9', type: 'Sailboat',    loa: '14.0m', beam: '4.2m', draft: '1.5m', airDraft: '21.5m',yearBuilt: 2013, builder: 'Jeanneau', model: 'Sun Odyssey 45DS',engine: 'Yanmar 3JH40',         fuel: 'Diesel', tankCap: '200L',  fwTank: '220L', shorePower: '16A', mooringPref: 'Finger',   owner: 'R. Fontaine', ownerRef: null, berth: 'A8', berthStatus: 'in-berth', aisActive: false, insurance: { insurer: 'MAT2i',        policy: 'MAT-FR-22781',   expiry: 'Aug 2025', daysLeft: 100, status: 'valid'   }, safety: { flares: 'Feb 2026', lifeRaft: 'Jul 2026', epirb: 'Jan 2026', extinguisher: 'Nov 2025' } },
  { id: 'V-010', name: 'Puffin',       reg: 'JCY-4412',   flag: 'JPN', mmsi: '431001044', callsign: 'JQPF0', type: 'Sailboat',    loa: '10.0m', beam: '3.1m', draft: '1.3m', airDraft: '15.0m',yearBuilt: 2011, builder: 'Dufour',   model: 'Dufour 36',      engine: 'Volvo D1-20',           fuel: 'Diesel', tankCap: '100L',  fwTank: '80L',  shorePower: '16A', mooringPref: 'Finger',   owner: 'S. Yamamoto', ownerRef: null, berth: 'B4', berthStatus: 'reserved',  aisActive: false, insurance: { insurer: 'Tokio Marine', policy: 'TM-JP-4412',    expiry: 'Nov 2025', daysLeft: 215, status: 'valid'   }, safety: { flares: 'Apr 2025', lifeRaft: 'Dec 2025', epirb: 'Sep 2025', extinguisher: 'Mar 2025' } },
];

// ── STAFF & ROTA ─────────────────────────────────────────────────────────────

export const STAFF = [
  { id: 'S-001', initials: 'MH', name: 'M. Hargreaves', role: 'Harbor Master',         dept: 'Management', phone: '+44 7700 900100', email: 'm.hargreaves@harwichmarina.com', start: 'Mar 2018', contract: 'Full-time',  certs: ['VHF Radio (GMDSS)', 'First Aid', 'ADR Fuel'] },
  { id: 'S-002', initials: 'DP', name: 'D. Philips',    role: 'Dock Master',            dept: 'Dock',       phone: '+44 7700 900102', email: 'd.philips@harwichmarina.com',    start: 'Jun 2020', contract: 'Full-time',  certs: ['VHF Radio', 'First Aid', 'Forklift'] },
  { id: 'S-003', initials: 'LT', name: 'L. Turner',     role: 'Dock Master',            dept: 'Dock',       phone: '+44 7700 900103', email: 'l.turner@harwichmarina.com',     start: 'Apr 2021', contract: 'Full-time',  certs: ['VHF Radio', 'First Aid'] },
  { id: 'S-004', initials: 'RB', name: 'R. Blackwood',  role: 'Yard Supervisor',        dept: 'Boatyard',   phone: '+44 7700 900104', email: 'r.blackwood@harwichmarina.com',  start: 'Jan 2019', contract: 'Full-time',  certs: ['Forklift', 'Travelift Operator', 'First Aid', 'COSHH'] },
  { id: 'S-005', initials: 'AC', name: 'A. Chen',       role: 'Finance Officer',        dept: 'Office',     phone: '+44 7700 900105', email: 'a.chen@harwichmarina.com',       start: 'Sep 2022', contract: 'Full-time',  certs: ['AAT Level 3'] },
  { id: 'S-006', initials: 'JO', name: 'J. O\'Brien',   role: 'Fuel Dock Operator',     dept: 'Fuel',       phone: '+44 7700 900106', email: 'j.obrien@harwichmarina.com',     start: 'May 2023', contract: 'Part-time',  certs: ['ADR Fuel', 'First Aid'] },
  { id: 'S-007', initials: 'KP', name: 'K. Patel',      role: 'Maintenance Technician', dept: 'Maintenance',phone: '+44 7700 900107', email: 'k.patel@harwichmarina.com',      start: 'Nov 2021', contract: 'Full-time',  certs: ['18th Edition Electrical', 'First Aid', 'PAT Testing'] },
  { id: 'S-008', initials: 'SM', name: 'S. Moreau',     role: 'Dock Staff',             dept: 'Dock',       phone: '+44 7700 900108', email: 's.moreau@harwichmarina.com',     start: 'Mar 2024', contract: 'Seasonal',   certs: ['VHF Radio'] },
];

export const ROTA = [
  { staffId: 'S-001', shifts: { Mon: '08–16 · Mgmt',  Tue: '08–16 · Mgmt',  Wed: '08–16 · Mgmt',  Thu: '08–16 · Mgmt',  Fri: '08–16 · Mgmt',  Sat: 'Off',           Sun: 'Off'           } },
  { staffId: 'S-002', shifts: { Mon: '07–15 · Dock',   Tue: '07–15 · Dock',   Wed: 'Off',            Thu: '07–15 · Dock',   Fri: '07–15 · Dock',   Sat: '08–16 · Dock',  Sun: 'Off'           } },
  { staffId: 'S-003', shifts: { Mon: 'Off',             Tue: '08–16 · Dock',   Wed: '08–16 · Dock',  Thu: 'Off',            Fri: '08–16 · Dock',   Sat: '08–16 · Dock',  Sun: '09–13 · Dock'  } },
  { staffId: 'S-004', shifts: { Mon: '07–15 · Yard',   Tue: '07–15 · Yard',   Wed: '07–15 · Yard',  Thu: '07–15 · Yard',   Fri: '07–15 · Yard',   Sat: 'Off',           Sun: 'Off'           } },
  { staffId: 'S-005', shifts: { Mon: '09–17 · Office', Tue: '09–17 · Office', Wed: '09–17 · Office',Thu: '09–17 · Office', Fri: '09–17 · Office', Sat: 'Off',           Sun: 'Off'           } },
  { staffId: 'S-006', shifts: { Mon: '08–14 · Fuel',   Tue: '08–14 · Fuel',   Wed: '08–14 · Fuel',  Thu: 'Off',            Fri: '08–14 · Fuel',   Sat: '08–14 · Fuel',  Sun: '08–14 · Fuel'  } },
  { staffId: 'S-007', shifts: { Mon: '08–16 · Maint',  Tue: '08–16 · Maint',  Wed: '08–16 · Maint', Thu: '08–16 · Maint',  Fri: '08–16 · Maint',  Sat: 'Off',           Sun: 'Off'           } },
  { staffId: 'S-008', shifts: { Mon: '07–13 · Dock',   Tue: 'Off',            Wed: '07–13 · Dock',  Thu: '07–13 · Dock',   Fri: 'Off',            Sat: '07–15 · Dock',  Sun: '07–15 · Dock'  } },
];

export const CERTIFICATIONS = [
  { staffId: 'S-001', cert: 'VHF Radio (GMDSS Operator)', body: 'Ofcom / RYA',       issued: 'Jan 2020', expiry: 'Jan 2025', status: 'expired'   },
  { staffId: 'S-001', cert: 'First Aid (Maritime)',        body: 'St John Ambulance', issued: 'Mar 2023', expiry: 'Mar 2026', status: 'valid'     },
  { staffId: 'S-001', cert: 'ADR Fuel Handling',           body: 'SQA',               issued: 'Jun 2022', expiry: 'Jun 2027', status: 'valid'     },
  { staffId: 'S-002', cert: 'VHF Radio Operator',          body: 'RYA',               issued: 'Apr 2019', expiry: 'Apr 2024', status: 'expired'   },
  { staffId: 'S-002', cert: 'First Aid at Work',           body: 'Red Cross',         issued: 'Nov 2022', expiry: 'Nov 2025', status: 'due-soon'  },
  { staffId: 'S-002', cert: 'Counterbalance Forklift',     body: 'RTITB',             issued: 'Jun 2020', expiry: 'Jun 2025', status: 'due-soon'  },
  { staffId: 'S-004', cert: 'Travelift Operator',          body: 'Marine Travelift',  issued: 'Feb 2021', expiry: 'Feb 2026', status: 'valid'     },
  { staffId: 'S-004', cert: 'Counterbalance Forklift',     body: 'RTITB',             issued: 'Jan 2019', expiry: 'Jan 2024', status: 'expired'   },
  { staffId: 'S-004', cert: 'COSHH Awareness',             body: 'NEBOSH',            issued: 'Mar 2022', expiry: 'Mar 2027', status: 'valid'     },
  { staffId: 'S-007', cert: '18th Edition Electrical',     body: 'City & Guilds',     issued: 'Sep 2023', expiry: 'Sep 2026', status: 'valid'     },
  { staffId: 'S-007', cert: 'PAT Testing',                 body: 'City & Guilds',     issued: 'Sep 2023', expiry: 'Sep 2025', status: 'due-soon'  },
];

// ── BOATYARD — WORK ORDERS & PARTS ──────────────────────────────────────────

export const WORK_ORDERS = [
  { id: 'WO-001', vessel: 'Arctic Fox',   owner: 'P. Andersen', title: 'Full hull antifoul and osmosis treatment',       category: 'Painting',     assigned: 'Yard Team 1',  status: 'in-progress', priority: 'normal', created: '20 Apr 2026', due: '30 Apr 2026', estimate: '€1,840', actual: '€980',   desc: 'Full hull antifoul application. Osmosis check. 2-pot epoxy barrier coat where required. Ablative antifoul topcoat applied.' },
  { id: 'WO-002', vessel: 'Sea Sprite',   owner: 'M. Walsh',    title: 'Engine service — 200hr Volvo D1-30',             category: 'Mechanical',   assigned: 'R. Hughes Marine', status: 'pending-auth', priority: 'normal', created: '21 Apr 2026', due: '28 Apr 2026', estimate: '€640',  actual: '—',      desc: 'Annual engine service. Oil, impeller, belts, filters. Check stern gland. Coolant flush.' },
  { id: 'WO-003', vessel: 'Morning Tide', owner: 'H. Clarke',   title: 'Standing rigging inspection and replacement',     category: 'Rigging',      assigned: 'Canvas Works Ltd', status: 'authorised',   priority: 'high',   created: '19 Apr 2026', due: '27 Apr 2026', estimate: '€2,100', actual: '€420',  desc: 'Full standing rigging inspection. Replace shrouds and stays — original 2011 wire showing wear at toggles.' },
  { id: 'WO-004', vessel: 'Berth A4',     owner: '—',           title: 'Shore power panel B4 fault diagnosis and repair', category: 'Electrical',   assigned: 'K. Patel',     status: 'in-progress', priority: 'urgent', created: '22 Apr 2026', due: '24 Apr 2026', estimate: '€380',  actual: '€190',   desc: 'Circuit breaker B4 tripping under load. Intermittent fault. Testing reveals loose neutral conductor at panel terminal.' },
  { id: 'WO-005', vessel: 'Winter Gale',  owner: 'P. Andersen', title: 'Keel bolt inspection — pre-haul prep',           category: 'Structural',   assigned: 'Yard Team 1',  status: 'completed',   priority: 'high',   created: '18 Apr 2026', due: '23 Apr 2026', estimate: '€320',  actual: '€310',   desc: 'Pre-haul keel bolt torque check and visual inspection. All bolts within spec. No seepage noted.' },
  { id: 'WO-006', vessel: 'Dune',         owner: 'S. Costa',    title: 'Canvas dodger and bimini replacement',            category: 'Canvas',       assigned: 'Canvas Works Ltd', status: 'pending-auth', priority: 'normal', created: '23 Apr 2026', due: '15 May 2026', estimate: '€1,200', actual: '—',     desc: 'Replace existing dodger and bimini. Customer has selected Sunbrella Charcoal 5032. New frame welded from S316 tube.' },
];

export const PARTS = [
  { id: 'P-001', name: 'Antifoul Paint 5L (Black)',       partNo: 'INT-AF-BLK-5',  category: 'Paints',      supplier: 'International Paints', unit: 'Can',     cost: '€45.00', sell: '€67.50', par: 10, stock: 14, location: 'Rack B-3'  },
  { id: 'P-002', name: 'Epoxy Barrier Coat 5L (Grey)',    partNo: 'INT-EP-GRY-5',  category: 'Paints',      supplier: 'International Paints', unit: 'Can',     cost: '€78.00', sell: '€117.00',par: 6,  stock: 8,  location: 'Rack B-3'  },
  { id: 'P-003', name: 'Engine Oil 15W40 Marine 5L',      partNo: 'VLVO-OIL-5',   category: 'Lubricants',  supplier: 'Volvo Penta Parts',    unit: 'Can',     cost: '€32.00', sell: '€48.00', par: 12, stock: 5,  location: 'Rack A-1'  },
  { id: 'P-004', name: 'Impeller Volvo D1/D2 (74mm)',     partNo: 'VLVO-IMP-74',  category: 'Spares',      supplier: 'Volvo Penta Parts',    unit: 'Each',    cost: '€28.00', sell: '€42.00', par: 4,  stock: 2,  location: 'Bin C-12'  },
  { id: 'P-005', name: 'Sika Flex 291 Adhesive (300ml)',  partNo: 'SIKA-291-300',  category: 'Adhesives',   supplier: 'Marine Trade',         unit: 'Tube',    cost: '€12.00', sell: '€18.00', par: 20, stock: 31, location: 'Rack D-2'  },
  { id: 'P-006', name: 'Stainless Shackle 10mm',          partNo: 'SS-SHACK-10',   category: 'Hardware',    supplier: 'Marine Trade',         unit: 'Each',    cost: '€4.20',  sell: '€7.50',  par: 30, stock: 48, location: 'Bin D-5'   },
  { id: 'P-007', name: 'Shore Power Cable 16A 10m',       partNo: 'SP-16A-10M',    category: 'Electrical',  supplier: 'ElectraMarine',        unit: 'Each',    cost: '€85.00', sell: '€128.00',par: 5,  stock: 3,  location: 'Rack E-1'  },
  { id: 'P-008', name: 'Sunbrella Canvas Charcoal (m²)',  partNo: 'SB-CHAR-M2',    category: 'Canvas',      supplier: 'Canvas Works Supply',  unit: 'Metre²',  cost: '€38.00', sell: '€62.00', par: 20, stock: 11, location: 'Loft'      },
  { id: 'P-009', name: 'Marine Grease 500g',              partNo: 'LUB-MGRSE-500', category: 'Lubricants',  supplier: 'Marine Trade',         unit: 'Tub',     cost: '€8.50',  sell: '€13.00', par: 10, stock: 7,  location: 'Rack A-2'  },
  { id: 'P-010', name: 'Circuit Breaker 32A Carling',     partNo: 'CB-CARL-32A',   category: 'Electrical',  supplier: 'ElectraMarine',        unit: 'Each',    cost: '€22.00', sell: '€38.00', par: 8,  stock: 4,  location: 'Bin E-3'   },
];

// ── MAINTENANCE — ASSETS & DEFECTS ──────────────────────────────────────────

export const ASSETS = [
  { id: 'AS-001', name: 'Travelift A (50T)',     category: 'Crane',          location: 'Main Yard',    make: 'Marine Travelift', model: 'MT-50',       serial: 'MT50-2018-4421', purchased: 'Apr 2018', cost: '€320,000', status: 'operational', lastService: '15 Mar 2026', nextService: '15 Jun 2026', totalMaintCost: '€12,400' },
  { id: 'AS-002', name: 'Travelift B (25T)',     category: 'Crane',          location: 'Main Yard',    make: 'Marine Travelift', model: 'MT-25',       serial: 'MT25-2015-1105', purchased: 'Jan 2015', cost: '€185,000', status: 'due-service', lastService: '2 Feb 2026',  nextService: '2 May 2026',  totalMaintCost: '€8,210'  },
  { id: 'AS-003', name: 'Fuel Pump 1 (Diesel)',  category: 'Fuel System',    location: 'Fuel Dock',    make: 'Piusi',            model: 'ST Box 70',   serial: 'PIUSI-70-3301',  purchased: 'Mar 2021', cost: '€4,800',   status: 'operational', lastService: '1 Apr 2026',  nextService: '1 Jul 2026',  totalMaintCost: '€340'    },
  { id: 'AS-004', name: 'Shore Power Panel A',   category: 'Electrical',     location: 'Pier A Head',  make: 'Eaton',            model: 'ProMarine 32A',serial: 'EAT-PM-0812',    purchased: 'Jun 2019', cost: '€6,200',   status: 'operational', lastService: '10 Jan 2026', nextService: '10 Jul 2026', totalMaintCost: '€480'    },
  { id: 'AS-005', name: 'Shore Power Panel B',   category: 'Electrical',     location: 'Pier A Mid',   make: 'Eaton',            model: 'ProMarine 32A',serial: 'EAT-PM-0813',    purchased: 'Jun 2019', cost: '€6,200',   status: 'under-repair',lastService: '—',           nextService: 'OVERDUE',     totalMaintCost: '€520'    },
  { id: 'AS-006', name: 'Dock Gate — Main',      category: 'Gate / Barrier', location: 'Marina Entrance',make: 'BFT',            model: 'Maxima 8m',   serial: 'BFT-MX-9920',    purchased: 'Feb 2017', cost: '€8,400',   status: 'operational', lastService: '5 Mar 2026',  nextService: '5 Sep 2026',  totalMaintCost: '€1,100'  },
];

export const DEFECTS = [
  { id: 'DEF-001', asset: 'Shore Power Panel B', location: 'Berth A4',     desc: 'Panel B4 circuit breaker tripping intermittently under load. Berth A4 vessel reported total power loss overnight.', severity: 'high',   reporter: 'Dock Team A',  date: '22 Apr 2026 · 07:58', status: 'in-progress', assignedTo: 'K. Patel',     woRef: 'WO-004' },
  { id: 'DEF-002', asset: 'Dock Cleats — Pier B',location: 'Berth B7',     desc: 'Cleat B7-3 working loose from pontoon deck. Movement noted under mooring load. Berth B7 taken out of service pending repair.', severity: 'medium', reporter: 'Dock Team B', date: '21 Apr 2026 · 17:30', status: 'acknowledged', assignedTo: 'R. Blackwood', woRef: null },
  { id: 'DEF-003', asset: 'Travelift B (25T)',    location: 'Main Yard',    desc: 'Hydraulic oil leak detected at starboard sling sheave block. Minor drip — no immediate operational impact but scheduled maintenance overdue.', severity: 'medium', reporter: 'R. Blackwood', date: '20 Apr 2026 · 09:00', status: 'open',         assignedTo: null,           woRef: null },
  { id: 'DEF-004', asset: 'Bathhouse Block C',    location: 'Showers 3/4',  desc: 'Hot water intermittent in showers 3 and 4. Mixing valve suspected. Cold supply pressure normal.', severity: 'low',    reporter: 'S. Moreau',    date: '19 Apr 2026 · 08:30', status: 'open',         assignedTo: null,           woRef: null },
];

// ── BILLING — DEBTORS ────────────────────────────────────────────────────────

export const DEBTORS = [
  { id: 'INV-2043', vessel: 'Saltwater',   owner: 'J. Hartmann', amount: '€330',  due: '23 Apr 2026', daysOverdue: 1,  bucket: '0–7',   status: 'overdue', reminders: 1 },
  { id: 'INV-2042', vessel: 'Seabird III', owner: 'T. Marchetti',amount: '€660',  due: '27 Apr 2026', daysOverdue: 0,  bucket: 'current',status: 'unpaid',  reminders: 0 },
  { id: 'INV-2046', vessel: 'Lady K',      owner: 'A. Schwartz', amount: '€150',  due: '24 Apr 2026', daysOverdue: 0,  bucket: 'current',status: 'pending', reminders: 0 },
];

// ── MEMBERS — SEGMENTS ───────────────────────────────────────────────────────

export const SEGMENTS = [
  { id: 'SEG-01', name: 'Seasonal Berth Holders',      count: 2,  filter: 'type=Seasonal',                    lastUsed: '20 Apr 2026' },
  { id: 'SEG-02', name: 'VIP Members',                 count: 2,  filter: 'tag=VIP',                          lastUsed: '18 Apr 2026' },
  { id: 'SEG-03', name: 'Expiring Insurance (90d)',     count: 3,  filter: 'insurance_expiry<90d',             lastUsed: '22 Apr 2026' },
  { id: 'SEG-04', name: 'Outstanding Debt',            count: 1,  filter: 'tag=Outstanding Debt',             lastUsed: '22 Apr 2026' },
  { id: 'SEG-05', name: 'Transient — Arrived Apr 26',  count: 5,  filter: 'type=Transient&checkin=Apr 2026',  lastUsed: '23 Apr 2026' },
];

// ── ESIGNATURE ───────────────────────────────────────────────────────────────

export const ESIGN_TEMPLATES = [
  { id: 'TPL-01', name: 'Seasonal Slip Rental Agreement',   category: 'Marina Operations', lastUsed: '20 Apr 2026', uses: 14, fields: 8, pages: 3 },
  { id: 'TPL-02', name: 'Transient Dockage Waiver',         category: 'Marina Operations', lastUsed: '23 Apr 2026', uses: 41, fields: 5, pages: 1 },
  { id: 'TPL-03', name: 'Haul-out Consent & Liability Form',category: 'Boatyard',          lastUsed: '19 Apr 2026', uses: 9,  fields: 6, pages: 2 },
  { id: 'TPL-04', name: 'Work Order Authorisation',         category: 'Boatyard',          lastUsed: '22 Apr 2026', uses: 22, fields: 4, pages: 1 },
  { id: 'TPL-05', name: 'Venue Hire Agreement',             category: 'Events',            lastUsed: '15 Apr 2026', uses: 5,  fields: 9, pages: 4 },
  { id: 'TPL-06', name: 'Marina Rules Acceptance',          category: 'Marina Operations', lastUsed: '23 Apr 2026', uses: 58, fields: 2, pages: 2 },
];

export const ENVELOPES = [
  { id: 'ENV-001', template: 'Seasonal Slip Rental Agreement',    recipient: 'H. Clarke',    vessel: 'Morning Tide', sent: '22 Apr 2026', status: 'completed', completedAt: '22 Apr 2026 · 14:35', reminders: 0 },
  { id: 'ENV-002', template: 'Work Order Authorisation',          recipient: 'P. Andersen',  vessel: 'Arctic Fox',   sent: '21 Apr 2026', status: 'pending',   completedAt: null,                   reminders: 1 },
  { id: 'ENV-003', template: 'Transient Dockage Waiver',          recipient: 'B. Rousseau',  vessel: 'Nautilus V',   sent: '23 Apr 2026', status: 'pending',   completedAt: null,                   reminders: 0 },
  { id: 'ENV-004', template: 'Haul-out Consent & Liability Form', recipient: 'M. Walsh',     vessel: 'Sea Sprite',   sent: '20 Apr 2026', status: 'completed', completedAt: '21 Apr 2026 · 09:10', reminders: 0 },
  { id: 'ENV-005', template: 'Work Order Authorisation',          recipient: 'S. Costa',     vessel: 'Dune',         sent: '23 Apr 2026', status: 'pending',   completedAt: null,                   reminders: 0 },
  { id: 'ENV-006', template: 'Marina Rules Acceptance',           recipient: 'T. Marchetti', vessel: 'Seabird III',  sent: '18 Apr 2026', status: 'expired',   completedAt: null,                   reminders: 2 },
  { id: 'ENV-007', template: 'Seasonal Slip Rental Agreement',    recipient: 'A. Schwartz',  vessel: 'Lady K',       sent: '17 Apr 2026', status: 'completed', completedAt: '18 Apr 2026 · 11:22', reminders: 0 },
  { id: 'ENV-008', template: 'Venue Hire Agreement',              recipient: 'Harwich YC',   vessel: '—',            sent: '15 Apr 2026', status: 'completed', completedAt: '16 Apr 2026 · 08:55', reminders: 0 },
];

// ── TOOLS ─────────────────────────────────────────────────────────────────────

export const TOOLS = [
  { id: 'T-001', name: 'Makita Cordless Drill 18V',    category: 'Power Tools',    serial: 'MKT-18V-4401', location: 'Workshop Bay 1', status: 'available',   checkedOut: null,          workOrder: null,     calibDue: null           },
  { id: 'T-002', name: 'Snap-on Torque Wrench 3/8"',   category: 'Hand Tools',     serial: 'SNP-TW38-221', location: 'Workshop Bay 1', status: 'checked-out', checkedOut: 'R. Blackwood', workOrder: 'WO-001', calibDue: '1 Jun 2026'   },
  { id: 'T-003', name: 'Fluke 87V Multimeter',          category: 'Diagnostic',     serial: 'FL-87V-8812',  location: 'Electrical Bay',  status: 'checked-out', checkedOut: 'K. Patel',     workOrder: 'WO-004', calibDue: '15 May 2026'  },
  { id: 'T-004', name: 'Pressure Washer 250 Bar',       category: 'Yard Equipment', serial: 'PW-250-1109',  location: 'Main Yard',       status: 'available',   checkedOut: null,          workOrder: null,     calibDue: null           },
  { id: 'T-005', name: 'Rigging Tension Gauge',         category: 'Diagnostic',     serial: 'RTG-STD-003',  location: 'Workshop Bay 2',  status: 'available',   checkedOut: null,          workOrder: null,     calibDue: '30 Apr 2026'  },
  { id: 'T-006', name: 'Antifoul Spray Gun Kit',        category: 'Painting',       serial: 'SG-KIT-007',   location: 'Paint Store',     status: 'checked-out', checkedOut: 'Yard Team 1',  workOrder: 'WO-001', calibDue: null           },
  { id: 'T-007', name: 'Stihl Angle Grinder 9"',        category: 'Power Tools',    serial: 'STH-AG9-552',  location: 'Workshop Bay 1',  status: 'service-due', checkedOut: null,          workOrder: null,     calibDue: null           },
  { id: 'T-008', name: 'Canvas Staple Gun (Hog Ring)',  category: 'Hand Tools',     serial: 'HR-GUN-019',   location: 'Loft',            status: 'available',   checkedOut: null,          workOrder: null,     calibDue: null           },
  { id: 'T-009', name: 'Bilge Pump Test Kit',           category: 'Diagnostic',     serial: 'BPT-KIT-004',  location: 'Workshop Bay 2',  status: 'available',   checkedOut: null,          workOrder: null,     calibDue: '10 May 2026'  },
  { id: 'T-010', name: 'Shore Power Test Adaptor 32A',  category: 'Electrical',     serial: 'SP-TA-32-001', location: 'Electrical Bay',  status: 'available',   checkedOut: null,          workOrder: null,     calibDue: '1 Jul 2026'   },
];

// ── LAUNCH QUEUE ──────────────────────────────────────────────────────────────

export const LAUNCH_REQUESTS = [
  { id: 'LQ-001', vessel: 'Arctic Fox',   owner: 'P. Andersen', loa: '12m', position: 'A3', equipment: 'Forklift',    requested: '28 Apr · 09:00', status: 'launching',  assignedTo: 'R. Blackwood' },
  { id: 'LQ-002', vessel: 'Winter Gale',  owner: 'M. Walsh',    loa: '14m', position: 'B2', equipment: 'Travelift B', requested: '28 Apr · 10:30', status: 'scheduled',  assignedTo: 'Yard Team 1'  },
  { id: 'LQ-003', vessel: 'Saltwater',    owner: 'J. Hartmann', loa: '10m', position: 'A6', equipment: 'Forklift',    requested: '28 Apr · 11:00', status: 'pending',    assignedTo: null           },
  { id: 'LQ-004', vessel: 'Dune',         owner: 'S. Costa',    loa: '11m', position: 'C1', equipment: 'Forklift',    requested: '28 Apr · 13:00', status: 'pending',    assignedTo: null           },
  { id: 'LQ-005', vessel: 'Morning Tide', owner: 'H. Clarke',   loa: '13m', position: 'B5', equipment: 'Travelift B', requested: '28 Apr · 14:00', status: 'pending',    assignedTo: null           },
  { id: 'LQ-006', vessel: 'Blue Horizon', owner: 'C. Nielsen',  loa: '9m',  position: 'A1', equipment: 'Forklift',    requested: '28 Apr · 15:30', status: 'retrieved',  assignedTo: 'R. Blackwood' },
];

// ── WAIT LIST & FUEL QUEUE ────────────────────────────────────────────────────

export const WAITLIST = [
  { id: 'WL-001', name: 'G. Ferreira', vessel: 'Sunrise II', loa: '12m', type: 'Annual',   applied: '5 Jan 2026',  deposit: '€500', depositStatus: 'held',    position: 1, notes: 'Flexible on pier location' },
  { id: 'WL-002', name: 'K. Oduya',   vessel: 'Pelican',    loa: '10m', type: 'Seasonal', applied: '18 Jan 2026', deposit: '€300', depositStatus: 'held',    position: 2, notes: 'Requires 16A power' },
  { id: 'WL-003', name: 'C. Brennan', vessel: 'Moira Rose', loa: '15m', type: 'Annual',   applied: '2 Feb 2026',  deposit: '€500', depositStatus: 'held',    position: 3, notes: 'Prefers Pier A' },
  { id: 'WL-004', name: 'D. Patel',   vessel: 'Sundancer',  loa: '8m',  type: 'Seasonal', applied: '14 Feb 2026', deposit: '—',    depositStatus: 'pending', position: 4, notes: 'Awaiting deposit payment' },
  { id: 'WL-005', name: 'I. Müller',  vessel: 'Albatross',  loa: '18m', type: 'Annual',   applied: '1 Mar 2026',  deposit: '€500', depositStatus: 'held',    position: 5, notes: 'Superyacht — needs deep draft berth' },
];

export const FUEL_QUEUE = [
  { id: 'FQ-001', vessel: 'Ocean Star',  owner: 'L. Nakamura',  loa: '14m', fuel: 'Diesel',   qty: '~200L', arrived: '08:40', status: 'fuelling', berth: 'FD-1' },
  { id: 'FQ-002', vessel: 'Lady K',      owner: 'A. Schwartz',  loa: '10m', fuel: 'Pump-out', qty: '1×',    arrived: '08:55', status: 'waiting',  berth: null   },
  { id: 'FQ-003', vessel: 'Seabird III', owner: 'T. Marchetti', loa: '12m', fuel: 'Petrol',   qty: '~80L',  arrived: '09:10', status: 'waiting',  berth: null   },
  { id: 'FQ-004', vessel: 'Blue Horizon',owner: 'C. Nielsen',   loa: '9m',  fuel: 'Diesel',   qty: '~120L', arrived: '09:25', status: 'waiting',  berth: null   },
];

// ── RESTAURANT ───────────────────────────────────────────────────────────────

export const REST_TABLES = [
  { id: 'T01', num: 1,  section: 'Main',    capacity: 4, status: 'occupied',  party: 3, seated: '12:30', server: 'A. Chen',  reservation: null },
  { id: 'T02', num: 2,  section: 'Main',    capacity: 2, status: 'occupied',  party: 2, seated: '13:02', server: 'A. Chen',  reservation: null },
  { id: 'T03', num: 3,  section: 'Main',    capacity: 4, status: 'available', party: 0, seated: null,    server: null,       reservation: null },
  { id: 'T04', num: 4,  section: 'Main',    capacity: 6, status: 'reserved',  party: 0, seated: null,    server: 'A. Chen',  reservation: { name: 'B. Rousseau', time: '14:00', party: 5 } },
  { id: 'T05', num: 5,  section: 'Main',    capacity: 4, status: 'cleaning',  party: 0, seated: null,    server: null,       reservation: null },
  { id: 'T06', num: 6,  section: 'Main',    capacity: 2, status: 'available', party: 0, seated: null,    server: null,       reservation: null },
  { id: 'T07', num: 7,  section: 'Terrace', capacity: 4, status: 'occupied',  party: 4, seated: '12:45', server: 'T. Walsh', reservation: null },
  { id: 'T08', num: 8,  section: 'Terrace', capacity: 4, status: 'available', party: 0, seated: null,    server: null,       reservation: null },
  { id: 'T09', num: 9,  section: 'Terrace', capacity: 6, status: 'reserved',  party: 0, seated: null,    server: 'T. Walsh', reservation: { name: 'P. Singh', time: '19:30', party: 4 } },
  { id: 'T10', num: 10, section: 'Terrace', capacity: 4, status: 'available', party: 0, seated: null,    server: null,       reservation: null },
  { id: 'T11', num: 11, section: 'Bar',     capacity: 3, status: 'occupied',  party: 2, seated: '13:15', server: 'A. Chen',  reservation: null },
  { id: 'T12', num: 12, section: 'Bar',     capacity: 3, status: 'available', party: 0, seated: null,    server: null,       reservation: null },
];

export const REST_BOOKINGS = [
  { id: 'RB-01', name: 'B. Rousseau', date: 'Today',    time: '14:00', party: 5, table: 'T04', status: 'confirmed', phone: '+33 6 12 34 56 78', notes: 'Marina guest — berth B5. Window seat.' },
  { id: 'RB-02', name: 'P. Singh',    date: 'Today',    time: '19:30', party: 4, table: 'T09', status: 'confirmed', phone: '+44 7700 900005',    notes: '1 vegan. Terrace requested.' },
  { id: 'RB-03', name: 'L. Franklin', date: 'Today',    time: '20:00', party: 2, table: 'T06', status: 'confirmed', phone: '+44 7700 912345',    notes: 'Anniversary dinner. Champagne requested.' },
  { id: 'RB-04', name: 'C. Hammond',  date: 'Tomorrow', time: '12:30', party: 3, table: 'T01', status: 'confirmed', phone: '+44 7700 900001',    notes: 'Marina guest — berth A1.' },
  { id: 'RB-05', name: 'K. Eriksson', date: 'Tomorrow', time: '19:00', party: 6, table: 'T04', status: 'pending',   phone: '+46 70 123 4567',    notes: 'Arriving Nordic Blue A6. TBC on numbers.' },
];

export const MENU = [
  { id: 'MI-01', section: 'Starters',  name: 'Dressed Brown Crab',       desc: 'Fresh brown and white crab, Marie Rose, cucumber ribbons, toasted sourdough.', price: '€14', allergens: ['Crustaceans', 'Gluten', 'Eggs'],           tags: [],           cost: '€4.80',  prepTime: '8 min'  },
  { id: 'MI-02', section: 'Starters',  name: 'Smoked Mackerel Pâté',     desc: 'Hot smoked mackerel, cream cheese, horseradish, cornichons, rye crispbreads.', price: '€11', allergens: ['Fish', 'Dairy', 'Gluten'],                 tags: ['GF option'],cost: '€3.20',  prepTime: '5 min'  },
  { id: 'MI-03', section: 'Starters',  name: 'Burrata & Heritage Tomato', desc: 'Pugliese burrata, slow-roasted heritage tomatoes, basil oil, sea salt flakes.', price: '€12', allergens: ['Dairy'],                                   tags: ['Veg'],      cost: '€3.60',  prepTime: '5 min'  },
  { id: 'MI-04', section: 'Starters',  name: 'Chowder of the Day',        desc: 'Seasonal seafood chowder, cream, dill, crusty bread roll.', price: '€10', allergens: ['Fish', 'Shellfish', 'Dairy', 'Gluten', 'Celery'], tags: [],           cost: '€2.80',  prepTime: '10 min' },
  { id: 'MI-05', section: 'Mains',     name: 'Catch of the Day',          desc: 'Sustainably sourced day-boat fish, roasted new potatoes, seasonal vegetables, lemon butter sauce.', price: '€26', allergens: ['Fish', 'Dairy'],       tags: ['GF'],       cost: '€9.40',  prepTime: '18 min' },
  { id: 'MI-06', section: 'Mains',     name: 'Lobster Thermidor',         desc: 'Half native lobster, classic Thermidor sauce, frites, dressed salad.', price: '€44', allergens: ['Crustaceans', 'Dairy', 'Gluten', 'Mustard'], tags: [],           cost: '€18.00', prepTime: '20 min' },
  { id: 'MI-07', section: 'Mains',     name: 'Ribeye 28-Day Aged (300g)', desc: 'Dry-aged Hereford ribeye, triple-cooked chips, vine tomatoes, watercress, peppercorn or béarnaise.', price: '€38', allergens: ['Dairy', 'Eggs'],  tags: ['GF'],       cost: '€14.20', prepTime: '22 min' },
  { id: 'MI-08', section: 'Mains',     name: 'Wild Mushroom Risotto',     desc: 'Mixed wild mushrooms, Arborio rice, aged Parmesan, truffle oil, chives.', price: '€22', allergens: ['Dairy'],                                  tags: ['Veg', 'GF'],cost: '€6.40',  prepTime: '20 min' },
  { id: 'MI-09', section: 'Desserts',  name: 'Sticky Toffee Pudding',     desc: 'Warm date pudding, salted caramel toffee sauce, clotted cream ice cream.', price: '€9', allergens: ['Gluten', 'Dairy', 'Eggs', 'Sulphites'],  tags: [],           cost: '€2.10',  prepTime: '8 min'  },
  { id: 'MI-10', section: 'Desserts',  name: 'Chocolate Fondant',         desc: 'Dark chocolate fondant, vanilla pod ice cream, hazelnut praline.', price: '€10', allergens: ['Gluten', 'Dairy', 'Eggs', 'Nuts'],          tags: [],           cost: '€2.60',  prepTime: '12 min' },
  { id: 'MI-11', section: 'Desserts',  name: 'Lemon Posset',              desc: 'Set lemon cream, shortbread, mixed berry compote.', price: '€8', allergens: ['Dairy', 'Gluten'],                               tags: ['Veg'],      cost: '€1.80',  prepTime: '5 min'  },
  { id: 'MI-12', section: 'Drinks',    name: 'House White (Glass)',        desc: 'Muscadet Sèvre et Maine, Loire Valley.', price: '€8',  allergens: ['Sulphites'],                                      tags: ['Veg'],      cost: '€2.80',  prepTime: '—'      },
  { id: 'MI-13', section: 'Drinks',    name: 'House Red (Glass)',          desc: 'Côtes du Rhône, Grenache/Syrah.', price: '€8',         allergens: ['Sulphites'],                                      tags: ['Veg'],      cost: '€2.80',  prepTime: '—'      },
  { id: 'MI-14', section: 'Drinks',    name: 'Local Craft IPA (Pint)',     desc: 'Harwich Brewing Co. "Harbour Hopper" — 5.2% ABV.', price: '€7', allergens: ['Gluten'],                                tags: [],           cost: '€2.40',  prepTime: '—'      },
  { id: 'MI-15', section: 'Drinks',    name: 'Soft Drinks',               desc: 'Still/sparkling water, Coke, Diet Coke, orange juice, elderflower presse.', price: '€4', allergens: [],                tags: ['Veg'],      cost: '€0.80',  prepTime: '—'      },
];

export const REST_ORDERS = [
  { id: 'ORD-01', table: 'T01', covers: 3, placed: '12:38', items: [
    { name: 'Dressed Brown Crab', qty: 2, course: 'Starter', status: 'served'  },
    { name: 'Smoked Mackerel Pâté', qty: 1, course: 'Starter', status: 'served' },
    { name: 'Catch of the Day',   qty: 2, course: 'Main',    status: 'in-prep' },
    { name: 'Ribeye 28-Day',      qty: 1, course: 'Main',    status: 'in-prep' },
  ]},
  { id: 'ORD-02', table: 'T02', covers: 2, placed: '13:05', items: [
    { name: 'Burrata & Heritage Tomato', qty: 1, course: 'Starter', status: 'in-prep' },
    { name: 'Wild Mushroom Risotto',     qty: 1, course: 'Main',    status: 'waiting'  },
    { name: 'Lobster Thermidor',         qty: 1, course: 'Main',    status: 'waiting'  },
  ]},
  { id: 'ORD-03', table: 'T07', covers: 4, placed: '12:48', items: [
    { name: 'Chowder of the Day', qty: 4, course: 'Starter', status: 'served'  },
    { name: 'Catch of the Day',   qty: 2, course: 'Main',    status: 'ready'   },
    { name: 'Ribeye 28-Day',      qty: 1, course: 'Main',    status: 'ready'   },
    { name: 'Wild Mushroom Risotto', qty: 1, course: 'Main', status: 'ready'   },
  ]},
];

// ── EVENTS & VENUE HIRE ──────────────────────────────────────────────────────

export const EVENTS = [
  { id: 'EV-001', name: 'East Coast Spring Regatta', type: 'Regatta',        dates: '10–12 May 2026',  location: 'Pier A/B + Outer Moorings', organiser: 'Harwich YC',     contact: 'T. Davies',   attendance: 140, fleet: 18, status: 'confirmed', revenue: '€4,200', berthsBlocked: 4 },
  { id: 'EV-002', name: 'Marina Summer Market',       type: 'Public Event',   dates: '24 May 2026',     location: 'Marina Grounds / Car Park', organiser: 'HM Events Team', contact: 'M. Hargreaves',attendance: 500, fleet: 0,  status: 'confirmed', revenue: '€3,800', berthsBlocked: 0 },
  { id: 'EV-003', name: 'Rousseau Family Charter',    type: 'Private Party',  dates: '1 Jun 2026',      location: 'Function Room + Terrace',   organiser: 'B. Rousseau',    contact: 'B. Rousseau', attendance: 30,  fleet: 0,  status: 'confirmed', revenue: '€2,400', berthsBlocked: 0 },
  { id: 'EV-004', name: 'Classic Boat Rally 2026',    type: 'Rally / Cruise', dates: '14–15 Jun 2026',  location: 'All Piers',                 organiser: 'Classic Boat Soc.',contact: 'R. Adams',  attendance: 200, fleet: 35, status: 'inquiry',   revenue: 'TBC',    berthsBlocked: 8 },
];

export const VENUES = [
  { id: 'VN-001', name: 'Harborview Function Room', capacitySeated: 60,  capacityStanding: 100, facilities: ['PA System', 'Projector & Screen', 'Catering Kitchen', 'WiFi', 'Air Con'], rateHour: '€120', rateDay: '€800',  status: 'available' },
  { id: 'VN-002', name: 'Dockside Terrace',          capacitySeated: 40,  capacityStanding: 80,  facilities: ['Outdoor BBQ', 'Festoon Lighting', 'Heated Parasols', 'Power Points'],      rateHour: '€80',  rateDay: '€550',  status: 'reserved'  },
  { id: 'VN-003', name: 'Private Dining Room',        capacitySeated: 16,  capacityStanding: 24,  facilities: ['AV Screen', 'Whiteboard', 'WiFi', 'Dedicated Server'],                     rateHour: '€90',  rateDay: '€600',  status: 'available' },
];

export const LISTINGS = [
  { id: 'LS-001', name: 'Celtic Spirit',  type: 'Sailing Yacht',  loa: '12.4m', year: 2012, make: 'Bavaria',   model: 'Cruiser 40',    price: 89500,  daysListed: 42,  status: 'active',      owner: 'R. Collins',  commission: 8,   location: 'Berth C4',      highlights: '4-cabin layout, new sails 2024, Raymarine chartplotter' },
  { id: 'LS-002', name: 'Blue Meridian',  type: 'Motor Yacht',    loa: '10.2m', year: 2018, make: 'Sunseeker', model: 'Predator 34',   price: 164000, daysListed: 18,  status: 'under-offer', owner: 'P. Thornton', commission: 7,   location: 'Berth A2',      highlights: 'Twin Volvo IPS drives, bow thruster, recent full service' },
  { id: 'LS-003', name: 'Osprey II',      type: 'RIB',            loa: '7.5m',  year: 2020, make: 'Ballistic', model: '7.8E',          price: 38000,  daysListed: 65,  status: 'active',      owner: 'K. Murray',   commission: 10,  location: 'Dry Stack A4',  highlights: 'Mercury 200hp, trailer included, low hours' },
  { id: 'LS-004', name: 'Windfall',       type: 'Sailing Yacht',  loa: '14.8m', year: 2008, make: 'Oyster',    model: '47',            price: 248000, daysListed: 91,  status: 'active',      owner: 'F. Abbot',    commission: 6,   location: 'Berth B1',      highlights: 'Blue water cruiser, survey available, recent refit' },
  { id: 'LS-005', name: 'Sea Jade',       type: 'Motor Cruiser',  loa: '9.6m',  year: 2015, make: 'Princess',  model: 'V40',           price: 119000, daysListed: 7,   status: 'active',      owner: 'D. Walsh',    commission: 7.5, location: 'Berth A8',      highlights: 'Single owner, freshwater use only, full service history' },
  { id: 'LS-006', name: 'Arctic Star',    type: 'Sailing Yacht',  loa: '11.2m', year: 2005, make: 'Beneteau', model: 'Oceanis 343',   price: 54000,  daysListed: 120, status: 'sold',        owner: 'H. Linden',   commission: 8,   location: '—',             highlights: 'Sold Apr 2026' },
];

export const LEADS = [
  { id: 'LR-001', name: 'T. Bergström',  contact: '+44 7700 900122',      listing: 'Windfall',      listingId: 'LS-004', budget: '£220–270k', stage: 'viewing-scheduled',  source: 'Website',    created: '18 Apr 2026', lastContact: '22 Apr 2026', notes: 'Looking for blue-water capable yacht, experienced offshore sailor' },
  { id: 'LR-002', name: 'L. Marchetti',  contact: 'l.marchetti@email.it', listing: 'Blue Meridian', listingId: 'LS-002', budget: '£150–170k', stage: 'under-offer',         source: 'Walk-in',    created: '14 Apr 2026', lastContact: '23 Apr 2026', notes: 'Offer submitted at £158k, survey commissioned pending acceptance' },
  { id: 'LR-003', name: 'J. Kowalski',   contact: '+44 7700 900456',      listing: 'Celtic Spirit', listingId: 'LS-001', budget: '£80–95k',   stage: 'contacted',           source: 'Boats.com',  created: '20 Apr 2026', lastContact: '21 Apr 2026', notes: 'First-time yacht buyer, requested spec sheet' },
  { id: 'LR-004', name: 'A. Petrov',     contact: 'a.petrov@corp.ru',     listing: 'Sea Jade',      listingId: 'LS-005', budget: '£110–130k', stage: 'new',                 source: 'Phone',      created: '24 Apr 2026', lastContact: '24 Apr 2026', notes: 'Corporate purchase, needs VAT invoice' },
  { id: 'LR-005', name: 'B. Nakamura',   contact: 'b.nakamura@sail.jp',   listing: 'Osprey II',     listingId: 'LS-003', budget: '£35–42k',   stage: 'viewing-completed',   source: 'Referral',   created: '10 Apr 2026', lastContact: '20 Apr 2026', notes: 'Very interested, considering financing; returning for second viewing' },
  { id: 'LR-006', name: "C. O'Brien",    contact: '+353 87 9001234',      listing: 'Windfall',      listingId: 'LS-004', budget: '£240–260k', stage: 'new',                 source: 'YachtWorld', created: '25 Apr 2026', lastContact: '25 Apr 2026', notes: '' },
];

export const MARINA_SERVICES = [
  { id: 'SVC-01', name: 'Fuel Dock',             icon: '⛽', desc: 'Diesel and petrol available 7 days a week, 08:00–18:00. Pump-out service also available.', price: 'Market rate' },
  { id: 'SVC-02', name: 'Water & Shore Power',   icon: '⚡', desc: '16A and 32A shore power connections at all berths. Fresh water standpipes at pier head.', price: 'Included' },
  { id: 'SVC-03', name: 'WiFi',                  icon: '📶', desc: 'High-speed marina-wide WiFi included with all transient and annual stays.', price: 'Included' },
  { id: 'SVC-04', name: 'Haul-Out & Dry Storage',icon: '🏗️', desc: '50-tonne Travelift with hardstand, covered and open dry storage. Seasonal and short-stay rates available.', price: 'From €85' },
  { id: 'SVC-05', name: 'Laundry',               icon: '🧺', desc: 'Self-service coin-operated laundry facilities in the amenity block, open 07:00–22:00.', price: '€4 / load' },
  { id: 'SVC-06', name: 'Provisions & Chandlery',icon: '🛍️', desc: 'Chandlery, ice, and essential provisions at the marina office. Diesel additives, rope, fenders, and more.', price: 'Market rate' },
];
