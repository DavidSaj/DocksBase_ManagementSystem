import styles from './Pricing.module.css'

function Check({ featured }) {
  return (
    <div className={`${styles.check} ${featured ? styles.checkFeatured : ''}`}>
      <svg viewBox="0 0 12 12" fill="none" stroke={featured ? '#d4b07a' : '#0c1f3d'} strokeWidth="2.5">
        <polyline points="2,6 5,9 10,3"/>
      </svg>
    </div>
  )
}

const plans = [
  {
    tier: 'Starter',
    name: 'Starter',
    desc: 'Core tools for small marinas getting started with digital management.',
    price: '€149',
    per: '/ month',
    berths: 'Up to 50 berths',
    features: [
      'Berths, bookings & arrivals',
      'Vessel registry',
      'Reservations & booking engine',
      'Basic billing & invoicing',
      'Documents & eSign',
      'Member portal',
      '3 staff accounts',
    ],
    cta: 'Start free trial',
    featured: false,
  },
  {
    tier: 'Most Popular',
    name: 'Professional',
    desc: 'The full platform — all 18 modules for active marinas that want total operational control.',
    price: '€349',
    per: '/ month',
    berths: 'Unlimited berths',
    features: [
      'Everything in Starter',
      'Boatyard — haul-out, dry storage, work orders',
      'Full billing — utility meters, fuel dock POS, aged debtors',
      'Maintenance — tasks, incidents, asset register',
      'Staff rota, time tracking & certifications',
      'Members, segments & bulk communications',
      'Mobile field app & offline mode',
      'Restaurant & Events modules',
      'Up to 25 staff accounts',
      'Priority email support',
    ],
    cta: 'Start free trial',
    featured: true,
  },
  {
    tier: 'Enterprise',
    name: 'Enterprise',
    desc: 'For large commercial ports, marina groups, and multi-site operators.',
    price: '€899',
    per: '/ month',
    berths: 'Unlimited berths & sites',
    features: [
      'Everything in Professional',
      'Multi-site management dashboard',
      'REST API & custom integrations',
      'Unlimited staff accounts & roles',
      'Dedicated onboarding manager',
      '24/7 phone & email support',
      'SLA & uptime guarantee',
    ],
    cta: 'Contact sales',
    featured: false,
  },
]

export default function Pricing() {
  return (
    <section className={styles.section} id="pricing">
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>Pricing</div>
          <h2 className={styles.title}>Simple pricing for every harbor.</h2>
          <p className={styles.sub}>Start free. Scale as you grow. No surprise fees.</p>
        </div>
        <div className={styles.grid}>
          {plans.map(plan => (
            <div key={plan.name} className={`${styles.card} ${plan.featured ? styles.featured : ''}`}>
              <div className={styles.tier}>{plan.tier}</div>
              <div className={styles.name}>{plan.name}</div>
              <div className={styles.desc}>{plan.desc}</div>
              <div className={styles.priceRow}>
                <div className={styles.amount}>{plan.price}</div>
                {plan.per && <div className={styles.per}>{plan.per}</div>}
              </div>
              <div className={styles.berths}>{plan.berths}</div>
              <ul className={styles.features}>
                {plan.features.map(f => (
                  <li key={f}><Check featured={plan.featured} />{f}</li>
                ))}
              </ul>
              <a href="/signup" className={`${styles.btn} ${plan.featured ? styles.btnFeatured : styles.btnOutline}`}>
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
        <p className={styles.note}>All plans include a 30-day free trial. No credit card required.</p>
      </div>
    </section>
  )
}
