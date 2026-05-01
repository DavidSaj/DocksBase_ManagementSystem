import styles from './Hero.module.css'
import { useLang } from '../context/LanguageContext'

export default function Hero() {
  const { t } = useLang()
  const h = t.hero

  return (
    <section className={styles.hero}>
      <div className={styles.bg} />
      <div className={styles.overlay} />
      <div className={styles.content}>
        <div className={styles.eyebrow}>{h.eyebrow}</div>
        <h1 className={styles.title}>
          {h.title1} <em>{h.titleEm}</em><br />{h.title2}
        </h1>
        <p className={styles.sub}>{h.sub}</p>
        <div className={styles.actions}>
          <a href="#" className={`${styles.btn} ${styles.btnPrimary}`}>
            {h.cta1}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
          <a href="#features" className={`${styles.btn} ${styles.btnGhost}`}>{h.cta2}</a>
        </div>
      </div>
      <div className={styles.scroll}>
        <div className={styles.scrollLine} />
        <span className={styles.scrollText}>Scroll</span>
      </div>
    </section>
  )
}
