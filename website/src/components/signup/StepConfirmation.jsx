import styles from './StepConfirmation.module.css'

export default function StepConfirmation() {
  return (
    <div className={styles.wrap}>
      <div className={styles.icon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
      </div>
      <h2 className={styles.title}>Check your inbox</h2>
      <p className={styles.body}>
        We've sent a verification email to your address. Click the link inside to activate your account and access DocksBase.
      </p>
      <p className={styles.note}>Didn't get it? Check your spam folder. It may take a minute or two.</p>
    </div>
  )
}
