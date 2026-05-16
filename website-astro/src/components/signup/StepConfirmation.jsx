import { getSignupStrings } from '../../i18n/signup-strings'
import styles from './StepConfirmation.module.css'

export default function StepConfirmation({ t }) {
  const tr = t || getSignupStrings('en')
  return (
    <div className={styles.wrap}>
      <div className={styles.icon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
      </div>
      <h2 className={styles.title}>{tr.stepConfirmation.title}</h2>
      <p className={styles.body}>{tr.stepConfirmation.body}</p>
      <p className={styles.note}>{tr.stepConfirmation.note}</p>
    </div>
  )
}
