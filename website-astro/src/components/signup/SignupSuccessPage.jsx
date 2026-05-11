import StepConfirmation from './StepConfirmation'
import styles from './SignupPage.module.css'

export default function SignupSuccessPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.logo}>DocksBase</div>
        </div>
        <StepConfirmation />
      </div>
    </div>
  )
}
