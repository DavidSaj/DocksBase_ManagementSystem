import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div>
            <div className={styles.brandLogo}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#62aef0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
                <path d="M5 12 Q3 18 7 20"/><path d="M19 12 Q21 18 17 20"/>
                <path d="M7 20 Q12 23 17 20"/>
              </svg>
              <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.18)', flexShrink: 0, margin: '0 2px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 3 }}>
                <span style={{ fontFamily: "'Jost',sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase', color: '#fff' }}>DOCKS</span>
                <span style={{ fontFamily: "'Jost',sans-serif", fontWeight: 300, fontSize: 12, letterSpacing: '3px', color: '#c9a84c' }}>Base</span>
              </div>
            </div>
            <p className={styles.tagline}>The complete service management platform for modern harbors and marinas.</p>
          </div>
          <div>
            <div className={styles.colTitle}>Product</div>
            <ul className={styles.links}>
              {['Features','Pricing','Changelog','Roadmap','API Docs'].map(l => <li key={l}><a href="#">{l}</a></li>)}
            </ul>
          </div>
          <div>
            <div className={styles.colTitle}>Company</div>
            <ul className={styles.links}>
              {['About','Blog','Careers','Press','Contact'].map(l => <li key={l}><a href="#">{l}</a></li>)}
            </ul>
          </div>
          <div>
            <div className={styles.colTitle}>Support</div>
            <ul className={styles.links}>
              {['Help Center','Onboarding','Status','Security','GDPR'].map(l => <li key={l}><a href="#">{l}</a></li>)}
            </ul>
          </div>
        </div>
        <div className={styles.bottom}>
          <span className={styles.copy}>© 2026 DocksBase. All rights reserved.</span>
          <div className={styles.legal}>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
