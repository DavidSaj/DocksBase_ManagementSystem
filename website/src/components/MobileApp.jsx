import styles from './MobileApp.module.css'

const features = [
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    label: 'Check & manage reservations',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
    label: 'Log maintenance & incidents',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    label: 'Approve crane & haul-out requests',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    label: 'Issue invoices from the dock',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    label: 'View member & vessel details',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    label: 'Receive push alerts instantly',
  },
]

const phoneRows = [
  { label: 'Reservations', value: '12 active', dot: 'green' },
  { label: 'Pending crane req.', value: '3', dot: 'gold' },
  { label: 'Maintenance tasks', value: '7 open', dot: 'red' },
  { label: 'Invoices today', value: '€2,840', dot: 'green' },
]

export default function MobileApp() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>

        {/* Left: phone mockup */}
        <div className={styles.left}>
          <div className={styles.phone}>
            <div className={styles.phoneTop}>
              <div className={styles.phoneSpeaker} />
            </div>
            <div className={styles.phoneScreen}>
              <div className={styles.screenHeader}>
                <div className={styles.screenTitle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4b07a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/>
                    <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
                  </svg>
                  <span>DocksBase</span>
                </div>
                <div className={styles.screenBadge}>Live</div>
              </div>
              <div className={styles.screenGreeting}>Good morning, David</div>
              <div className={styles.screenSub}>Harbor Master · Harbour View</div>
              <div className={styles.screenCards}>
                {phoneRows.map(r => (
                  <div className={styles.screenCard} key={r.label}>
                    <span className={styles.screenCardLabel}>{r.label}</span>
                    <div className={styles.screenCardRight}>
                      <span className={styles.screenCardValue}>{r.value}</span>
                      <span className={`${styles.dot} ${styles['dot_' + r.dot]}`} />
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.screenActions}>
                <button className={styles.screenBtn}>New arrival</button>
                <button className={styles.screenBtnGhost}>Work orders</button>
              </div>
            </div>
            <div className={styles.phoneBottom}>
              <div className={styles.phoneBar} />
            </div>
          </div>
        </div>

        {/* Right: copy */}
        <div className={styles.right}>
          <div className={styles.eyebrow}>Mobile-first</div>
          <h2 className={styles.title}>Your whole harbor.<br />In your pocket.</h2>
          <p className={styles.body}>
            DocksBase is a full PWA — no app store download needed. Open it on any phone or tablet and get the complete platform. Staff at the dock, harbor masters on the water, managers at home — everyone has everything.
          </p>
          <ul className={styles.features}>
            {features.map((f, i) => (
              <li key={i} className={styles.feature}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
          <div className={styles.note}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 6l11 11L23 6"/><path d="M1 1l22 22"/>
            </svg>
            Works offline — syncs automatically when back online
          </div>
        </div>

      </div>
    </section>
  )
}
