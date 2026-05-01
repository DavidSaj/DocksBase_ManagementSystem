import styles from './CTA.module.css'

export default function CTA() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.anchorDivider}>
          <div className={styles.line} />
          <svg width="22" height="26" viewBox="0 0 24 28" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
            <circle cx="12" cy="4" r="3"/><line x1="12" y1="7" x2="12" y2="26"/>
            <line x1="4" y1="13" x2="20" y2="13"/>
            <path d="M4 13 Q2 20 6 24"/><path d="M20 13 Q22 20 18 24"/>
            <path d="M6 24 Q12 27 18 24"/>
          </svg>
          <div className={styles.line} />
        </div>
        <h2 className={styles.title}>
          Ready to modernize<br /><em>your harbor?</em>
        </h2>
        <p className={styles.sub}>Start free. Get your berths, bookings, and billing running in one afternoon. Upgrade anytime as your operation grows.</p>
        <div className={styles.actions}>
          <a href="#" className={`${styles.btn} ${styles.btnPrimary}`}>Get DocksBase free →</a>
          <a href="#" className={`${styles.btn} ${styles.btnSecondary}`}>Book a demo</a>
        </div>
        <p className={styles.note}>Free for up to 50 berths. Then from €49/month. Cancel anytime.</p>
      </div>
    </section>
  )
}
