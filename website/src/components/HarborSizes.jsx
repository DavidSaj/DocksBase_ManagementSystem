import styles from './HarborSizes.module.css'

function CheckIcon() {
  return (
    <span className={styles.check}>
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="2,6 5,9 10,3"/>
      </svg>
    </span>
  )
}

const small = [
  'Free trial included',
  'Berths, bookings & vessels',
  'Weather & tide dashboard',
  'eSign & member comms',
  '1 staff account included',
  'Setup in under 4 hours',
]

const large = [
  'All 14 modules unlocked',
  'Multi-site management',
  'Unlimited staff & roles',
  'REST API & custom integrations',
  'Dedicated onboarding manager',
  'SLA & 24/7 phone support',
]

export default function HarborSizes() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>For every harbor</div>
          <h2 className={styles.title}>Whether you run a family marina<br />or a commercial port.</h2>
          <p className={styles.sub}>DocksBase scales with you — from 20 berths to 2,000, from one site to a national fleet.</p>
        </div>
        <div className={styles.cards}>
          <div className={styles.card}>
            <div className={styles.cardEyebrow}>Small Marina</div>
            <div className={styles.cardTitle}>20 – 100 berths</div>
            <p className={styles.cardSub}>Get your operation digital in an afternoon. Core tools, no complexity, free to start.</p>
            <ul className={styles.list}>
              {small.map(item => (
                <li key={item}><CheckIcon />{item}</li>
              ))}
            </ul>
            <a href="/signup" className={`${styles.btn} ${styles.btnOutline}`}>Get started free →</a>
          </div>
          <div className={`${styles.card} ${styles.cardFeatured}`}>
            <div className={styles.cardEyebrow}>Large Port / Group</div>
            <div className={styles.cardTitle}>300+ berths · multi-site</div>
            <p className={styles.cardSub}>The full platform — every module, every integration, dedicated support from day one.</p>
            <ul className={styles.list}>
              {large.map(item => (
                <li key={item}><CheckIcon />{item}</li>
              ))}
            </ul>
            <a href="#" className={`${styles.btn} ${styles.btnPrimary}`}>Talk to sales →</a>
          </div>
        </div>
      </div>
    </section>
  )
}
