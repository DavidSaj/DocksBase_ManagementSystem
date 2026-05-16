export const PLANS = [
  {
    key:          'starter',
    name:         'Starter',
    monthlyPrice: 149,
    currency:     'EUR',
    stripePriceId: import.meta.env.PUBLIC_STRIPE_PRICE_STARTER,
    tagline:      'For small marinas getting started',
    features: [
      'Up to 100 berths',
      'Reservations & berth map',
      'Invoicing & billing',
      'Boater portal',
    ],
  },
  {
    key:          'professional',
    name:         'Professional',
    monthlyPrice: 349,
    currency:     'EUR',
    stripePriceId: import.meta.env.PUBLIC_STRIPE_PRICE_PROFESSIONAL,
    tagline:      'For growing marinas',
    badge:        'Most popular',
    features: [
      'Unlimited berths',
      'Everything in Starter',
      'Boatyard & work orders',
      'Staff rota & mobile app',
      'Reports & analytics',
    ],
  },
]
