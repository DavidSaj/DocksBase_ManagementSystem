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
    name: 'Buoy',
    desc: 'For small marinas and private docks getting started with digital management.',
    price: 'Free',
    berths: 'Up to 50 berths',
    features: [
      'Berths, bookings & arrivals',
      'Vessel registry (up to 100 vessels)',
      'Weather & tide dashboard',
      'Basic invoicing & payments',
      'Documents & eSign (5 templates)',
      '1 staff account',
    ],
    cta: 'Get started free',
    featured: false,
  },
  {
    tier: 'Most Popular',
    name: 'Harbor',
    desc: 'The full platform — all 14 modules for active marinas that want total operational control.',
    price: '€49',
    per: '/ month',
    berths: 'Up to 300 berths',
    features: [
      'All Buoy features',
      'Boatyard — haul-out, dry storage, work orders',
      'Full billing — utility meters, fuel dock POS, aged debtors',
      'Maintenance — tasks, incidents, asset register',
      'Staff rota, time tracking & skills matrix',
      'Members, segments & bulk communications',
      'Restaurant & Events modules',
      'Up to 25 staff accounts',
      'Priority email support',
    ],
    cta: 'Start free trial',
    featured: true,
  },
  {
    tier: 'Enterprise',
    name: 'Port',
    desc: 'For large commercial ports, marina groups, and multi-site operators.',
    price: 'Custom',
    berths: 'Unlimited berths & sites',
    features: [
      'Everything in Harbor',
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
                <div className={`${styles.amount} ${plan.name === 'Port' ? styles.amountSmall : ''}`}>{plan.price}</div>
                {plan.per && <div className={styles.per}>{plan.per}</div>}
              </div>
              <div className={styles.berths}>{plan.berths}</div>
              <ul className={styles.features}>
                {plan.features.map(f => (
                  <li key={f}><Check featured={plan.featured} />{f}</li>
                ))}
              </ul>
              <a href="#" className={`${styles.btn} ${plan.featured ? styles.btnFeatured : styles.btnOutline}`}>
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
        <p className={styles.note}>All plans include a 14-day free trial. No credit card required.</p>
      </div>
    </section>
  )
}
