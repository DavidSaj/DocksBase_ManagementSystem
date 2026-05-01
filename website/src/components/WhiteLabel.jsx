import styles from './WhiteLabel.module.css'
import { useLang } from '../context/LanguageContext'

export default function WhiteLabel() {
  const { t } = useLang()
  const tr = t.whiteLabel

  return (
    <section className={styles.section}>
      <div className={styles.inner}>

        {/* ── Left: copy ── */}
        <div className={styles.left}>
          <div className={styles.eyebrow}>{tr.eyebrow}</div>
          <h2 className={styles.title}>{tr.title}</h2>
          <p className={styles.body}>{tr.body}</p>

          <ul className={styles.checklist}>
            {tr.checklist.map((item, i) => (
              <li key={i} className={styles.checkItem}>
                <svg className={styles.checkIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {/* DNS flow */}
          <div className={styles.flow}>
            {tr.flowSteps.map((step, i) => (
              <div key={i} className={styles.flowRow}>
                <div className={styles.flowStep}>
                  <div className={styles.flowDot}>{i + 1}</div>
                  <span className={styles.flowText}>{step}</span>
                </div>
                {i < tr.flowSteps.length - 1 && (
                  <svg className={styles.flowArrow} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                )}
              </div>
            ))}
          </div>

          <a href="#" className={styles.cta}>{tr.cta}</a>
        </div>

        {/* ── Right: browser mockup ── */}
        <div className={styles.right}>
          <div className={styles.browser}>

            {/* Chrome bar */}
            <div className={styles.chrome}>
              <div className={styles.dots}>
                <span className={styles.dot} style={{ background: '#ff5f56' }} />
                <span className={styles.dot} style={{ background: '#ffbd2e' }} />
                <span className={styles.dot} style={{ background: '#27c93f' }} />
              </div>
              <div className={styles.urlBar}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span className={styles.urlText}>reservations.theirmarina.com</span>
              </div>
            </div>

            {/* Simulated marina website */}
            <div className={styles.site}>

              {/* Marina nav */}
              <div className={styles.siteNav}>
                <div className={styles.siteLogo}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                  <span>Harbour View Marina</span>
                </div>
                <div className={styles.siteLinks}>
                  <span>Berths</span><span>Facilities</span><span>Contact</span>
                </div>
              </div>

              {/* Booking hero */}
              <div className={styles.siteHero}>
                <div className={styles.siteHeroText}>
                  <p className={styles.siteEyebrow}>Online Reservations</p>
                  <h3 className={styles.siteHeadline}>Book a Berth</h3>
                  <p className={styles.siteSub}>Check real-time availability and reserve your spot.</p>
                </div>
              </div>

              {/* Booking form */}
              <div className={styles.siteForm}>
                <div className={styles.formRow}>
                  <div className={styles.formField}>
                    <label>Arrival</label>
                    <div className={styles.formInput}>12 Aug 2026</div>
                  </div>
                  <div className={styles.formField}>
                    <label>Departure</label>
                    <div className={styles.formInput}>15 Aug 2026</div>
                  </div>
                  <div className={styles.formField}>
                    <label>Vessel length</label>
                    <div className={styles.formInput}>10 m</div>
                  </div>
                </div>
                <button className={styles.formBtn}>Check availability →</button>
              </div>

              {/* Powered-by badge */}
              <div className={styles.poweredBy}>{tr.poweredBy}</div>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}
