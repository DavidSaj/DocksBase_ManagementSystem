import StepConfirmation from './StepConfirmation'
import { LANGUAGES } from '../../i18n/strings'
import { getSignupStrings } from '../../i18n/signup-strings'
import styles from './SignupPage.module.css'

function LanguageSwitcher({ lang, label }) {
  function onChange(e) {
    const next = e.target.value
    if (typeof window === 'undefined') return
    const search = window.location.search || ''
    window.location.assign(`/${next}/signup/success${search}`)
  }
  return (
    <label className={styles.langSwitch} aria-label={label}>
      <svg
        className={styles.langIcon}
        width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 0 20a15.3 15.3 0 0 1 0-20z" />
      </svg>
      <select className={styles.langSelect} value={lang} onChange={onChange}>
        {LANGUAGES.map(l => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  )
}

export default function SignupSuccessPage({ lang = 'en' }) {
  const t = getSignupStrings(lang)
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.logo}>DocksBase</div>
            <LanguageSwitcher lang={lang} label={t.header.languageLabel} />
          </div>
        </div>
        <StepConfirmation t={t} />
      </div>
    </div>
  )
}
