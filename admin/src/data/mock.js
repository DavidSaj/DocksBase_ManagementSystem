export const PLANS = [
  { id: 'starter',      name: 'Starter',      price: 149, berthLimit: 50,   color: 'badge-gray',   desc: 'Single marina · up to 50 berths · core modules' },
  { id: 'professional', name: 'Professional', price: 349, berthLimit: null, color: 'badge-blue',   desc: 'Single marina · unlimited berths · all modules' },
  { id: 'enterprise',   name: 'Enterprise',   price: 899, berthLimit: null, color: 'badge-gold',   desc: 'Multi-marina · group reporting · dedicated support' },
];

export const MARINAS = [
  {
    id: 'M001', name: 'Harwich Marina',          location: 'Harwich, Essex, UK',
    plan: 'professional', status: 'active',   berths: 180, mrr: 349,
    joined: '2024-03-15', lastActive: '2026-04-27', nextRenewal: '2026-05-15',
    admin: 'M. Hargreaves', email: 'info@harwichmarina.co.uk',
    trial: false, users: 6, activeBookings: 22,
  },
  {
    id: 'M002', name: 'Marina Bay 94',            location: 'Trieste, Italy',
    plan: 'professional', status: 'active',   berths: 240, mrr: 349,
    joined: '2024-07-22', lastActive: '2026-04-26', nextRenewal: '2026-07-22',
    admin: 'R. Savastano', email: 'admin@marinabay94.it',
    trial: false, users: 8, activeBookings: 34,
  },
  {
    id: 'M003', name: 'Port Vauban',              location: 'Antibes, France',
    plan: 'enterprise',   status: 'active',   berths: 1650, mrr: 899,
    joined: '2024-01-10', lastActive: '2026-04-27', nextRenewal: '2027-01-10',
    admin: 'J.-L. Moreau', email: 'admin@port-vauban.fr',
    trial: false, users: 24, activeBookings: 210,
  },
  {
    id: 'M004', name: 'Scheveningen Marina',      location: 'The Hague, Netherlands',
    plan: 'starter',      status: 'active',   berths: 45, mrr: 149,
    joined: '2025-09-04', lastActive: '2026-04-25', nextRenewal: '2026-09-04',
    admin: 'K. van Dijk', email: 'admin@scheveningenmarina.nl',
    trial: false, users: 3, activeBookings: 7,
  },
  {
    id: 'M005', name: 'Palma de Mallorca Marina', location: 'Palma, Spain',
    plan: 'enterprise',   status: 'active',   berths: 620, mrr: 899,
    joined: '2024-11-30', lastActive: '2026-04-27', nextRenewal: '2026-11-30',
    admin: 'C. Ferrer', email: 'admin@palmamarina.es',
    trial: false, users: 14, activeBookings: 88,
  },
  {
    id: 'M006', name: 'Hamble Point Marina',      location: 'Southampton, UK',
    plan: 'professional', status: 'active',   berths: 310, mrr: 349,
    joined: '2025-02-18', lastActive: '2026-04-24', nextRenewal: '2026-05-18',
    admin: 'S. Whitfield', email: 'admin@hamblepoint.co.uk',
    trial: false, users: 9, activeBookings: 41,
  },
  {
    id: 'M007', name: 'Gothenburg City Marina',   location: 'Gothenburg, Sweden',
    plan: 'starter',      status: 'trial',    berths: 38, mrr: 0,
    joined: '2026-04-10', lastActive: '2026-04-26', nextRenewal: null,
    admin: 'E. Lindqvist', email: 'admin@gbgmarina.se',
    trial: true, trialEnds: '2026-05-10', users: 2, activeBookings: 4,
  },
  {
    id: 'M008', name: 'Lisbon Marina',            location: 'Lisbon, Portugal',
    plan: 'professional', status: 'trial',    berths: 190, mrr: 0,
    joined: '2026-04-18', lastActive: '2026-04-25', nextRenewal: null,
    admin: 'P. Rodrigues', email: 'admin@lisbonmarina.pt',
    trial: true, trialEnds: '2026-05-18', users: 4, activeBookings: 9,
  },
  {
    id: 'M009', name: 'Cobb Quay Marina',         location: 'Poole, Dorset, UK',
    plan: 'starter',      status: 'suspended', berths: 42, mrr: 149,
    joined: '2025-06-12', lastActive: '2026-03-15', nextRenewal: '2026-06-12',
    admin: 'D. Cobb', email: 'admin@cobbquay.co.uk',
    trial: false, suspendReason: 'Payment overdue — 47 days', users: 2, activeBookings: 0,
  },
  {
    id: 'M010', name: 'Marina de Lagos',          location: 'Lagos, Portugal',
    plan: 'professional', status: 'active',   berths: 460, mrr: 349,
    joined: '2025-05-07', lastActive: '2026-04-23', nextRenewal: '2026-05-07',
    admin: 'F. Costa', email: 'admin@marinalagos.pt',
    trial: false, users: 7, activeBookings: 53,
  },
];

export const PAYMENTS = [
  { id: 'PAY-2641', marina: 'M003', name: 'Port Vauban',              amount: 899, date: '2026-04-10', status: 'paid',    method: 'Card' },
  { id: 'PAY-2640', marina: 'M005', name: 'Palma de Mallorca Marina', amount: 899, date: '2026-04-30', status: 'due',     method: 'Card' },
  { id: 'PAY-2639', marina: 'M002', name: 'Marina Bay 94',            amount: 349, date: '2026-04-22', status: 'paid',    method: 'Card' },
  { id: 'PAY-2638', marina: 'M006', name: 'Hamble Point Marina',      amount: 349, date: '2026-04-18', status: 'paid',    method: 'Card' },
  { id: 'PAY-2637', marina: 'M001', name: 'Harwich Marina',           amount: 349, date: '2026-04-15', status: 'paid',    method: 'Card' },
  { id: 'PAY-2636', marina: 'M010', name: 'Marina de Lagos',          amount: 349, date: '2026-04-07', status: 'paid',    method: 'Card' },
  { id: 'PAY-2635', marina: 'M004', name: 'Scheveningen Marina',      amount: 149, date: '2026-04-04', status: 'paid',    method: 'Card' },
  { id: 'PAY-2634', marina: 'M009', name: 'Cobb Quay Marina',         amount: 149, date: '2026-03-12', status: 'overdue', method: 'Card' },
];

export const MRR_HISTORY = [
  { month: 'Nov', mrr: 2244 },
  { month: 'Dec', mrr: 2593 },
  { month: 'Jan', mrr: 2942 },
  { month: 'Feb', mrr: 3143 },
  { month: 'Mar', mrr: 3143 },
  { month: 'Apr', mrr: 3492 },
];
