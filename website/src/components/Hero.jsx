import styles from './Hero.module.css'
import { useLang } from '../context/LanguageContext'

export default function Hero() {
  const { t } = useLang()
  const h = t.hero


  return (
    <section className={styles.hero}>
      <div className={styles.bgOuter}>
        <div className={styles.bgInner} />
      </div>
      <div className={styles.overlay} />
      <div className={styles.content}>
        <div className={styles.eyebrow}>{h.eyebrow}</div>
        <h1 className={styles.title}>
          <span className={styles.word1}>{h.title1}</span>{' '}
          <em className={styles.wordEm}>{h.titleEm}</em>
          <br />
          <span className={styles.word2}>{h.title2}</span>
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
