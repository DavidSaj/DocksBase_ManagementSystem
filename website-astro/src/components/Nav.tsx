import { useState, useEffect, useRef } from 'react'
import styles from './Nav.module.css'
import Logo from './Logo'
import AboutModal from './AboutModal'
import { LANGUAGES, type LangCode, type Strings } from '../i18n/strings'

interface Props {
  lang: LangCode
  t: Strings
}

const ABOUT_ITEMS = [
  { key: 'aboutUs',       icon: '⚓', internal: true },
  { key: 'faq',           icon: '?', href: '#faq' },
  { key: 'documentation', icon: '↗', href: 'https://docs.docksbase.io', external: true },
  { key: 'status',        icon: '●', href: 'https://status.docksbase.io', external: true },
] as const

export default function Nav({ lang, t }: Props) {
  const [scrolled, setScrolled]     = useState(false)
  const [menuOpen, setMenuOpen]     = useState(false)
  const [aboutOpen, setAboutOpen]   = useState(false)
  const [langOpen, setLangOpen]     = useState(false)
  const [aboutModal, setAboutModal] = useState(false)
  const aboutRef                    = useRef<HTMLDivElement>(null)
  const langRef                     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (aboutRef.current && !aboutRef.current.contains(e.target as Node)) setAboutOpen(false)
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleAboutItem = (item: typeof ABOUT_ITEMS[number]) => {
    setAboutOpen(false)
    if (item.internal) { setAboutModal(true); return }
    if (item.external) { window.open(item.href, '_blank', 'noopener'); return }
    window.location.href = item.href
  }

  return (
    <>
      <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
        <a href={`/${lang}/`} className={styles.logo}><Logo /></a>

        <div className={styles.links}>
          <a href="#features" className={styles.link}>{t.nav.features}</a>
          <a href="#product"  className={styles.link}>{t.nav.product}</a>
          <a href="#pricing"  className={styles.link}>{t.nav.pricing}</a>

          <div className={styles.aboutWrap} ref={aboutRef}>
            <button
              className={`${styles.link} ${styles.aboutTrigger} ${aboutOpen ? styles.aboutTriggerOpen : ''}`}
              onClick={() => setAboutOpen(o => !o)}
            >
              {t.nav.about}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3.5l3 3 3-3"/>
              </svg>
            </button>
            {aboutOpen && (
              <div className={styles.dropdown}>
                {ABOUT_ITEMS.map(item => (
                  <button
                    key={item.key}
                    className={`${styles.dropItem} ${item.external ? styles.dropExternal : ''}`}
                    onClick={() => handleAboutItem(item)}
                  >
                    <span className={styles.dropIcon}>{item.icon}</span>
                    <span className={styles.dropLabel}>{t.nav.aboutItems[item.key]}</span>
                    {item.external && (
                      <svg className={styles.extIcon} width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 10L10 2M5 2h5v5"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.langWrap} ref={langRef}>
            <button
              className={`${styles.langTrigger} ${langOpen ? styles.langTriggerOpen : ''}`}
              onClick={() => setLangOpen(o => !o)}
            >
              {LANGUAGES.find(l => l.code === lang)?.label ?? 'EN'}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3.5l3 3 3-3"/>
              </svg>
            </button>
            {langOpen && (
              <div className={styles.langDropdown}>
                {LANGUAGES.map(l => (
                  <a
                    key={l.code}
                    href={`/${l.code}/`}
                    className={`${styles.langDropItem} ${lang === l.code ? styles.langDropActive : ''}`}
                    onClick={() => setLangOpen(false)}
                  >
                    <span className={styles.langCode}>{l.label}</span>
                    <span className={styles.langName}>{l.name}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <button className={styles.ghost}>{t.nav.signIn}</button>
          <a href="/signup/" className={styles.cta}>{t.nav.getStarted}</a>
        </div>

        <button
          className={`${styles.hamburger} ${menuOpen ? styles.open : ''}`}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      <div className={`${styles.mobileMenu} ${menuOpen ? styles.menuOpen : ''}`}>
        <a href="#features" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>{t.nav.features}</a>
        <a href="#product"  className={styles.mobileLink} onClick={() => setMenuOpen(false)}>{t.nav.product}</a>
        <a href="#pricing"  className={styles.mobileLink} onClick={() => setMenuOpen(false)}>{t.nav.pricing}</a>
        <div className={styles.mobileAbout}>
          <span className={styles.mobileSectionLabel}>{t.nav.about}</span>
          {ABOUT_ITEMS.map(item => (
            <button
              key={item.key}
              className={styles.mobileSub}
              onClick={() => { setMenuOpen(false); handleAboutItem(item) }}
            >
              {t.nav.aboutItems[item.key]}
              {item.external && ' ↗'}
            </button>
          ))}
        </div>
        <div className={styles.mobileActions}>
          <div className={styles.mobileLangRow}>
            {LANGUAGES.map(l => (
              <a
                key={l.code}
                href={`/${l.code}/`}
                className={`${styles.mobileLangBtn} ${lang === l.code ? styles.mobileLangActive : ''}`}
              >{l.label}</a>
            ))}
          </div>
          <button className={styles.ghost} style={{ width: '100%', padding: '12px' }}>{t.nav.signIn}</button>
          <a href="/signup/" className={styles.cta} style={{ width: '100%', padding: '12px', display: 'block', textAlign: 'center' }}>{t.nav.getStarted}</a>
        </div>
      </div>

      {aboutModal && <AboutModal onClose={() => setAboutModal(false)} />}
    </>
  )
}
