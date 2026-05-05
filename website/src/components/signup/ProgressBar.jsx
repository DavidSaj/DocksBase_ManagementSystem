import styles from './ProgressBar.module.css'

const STEP_LABELS = ['Plan', 'Marina', 'Account', 'Payment']

export default function ProgressBar({ step }) {
  return (
    <div className={styles.bar}>
      {STEP_LABELS.map((label, i) => {
        const num = i + 1
        const done = step > num
        const active = step === num
        return (
          <div key={label} className={styles.item}>
            <div className={`${styles.circle} ${done ? styles.done : ''} ${active ? styles.active : ''}`}>
              {done
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                : num}
            </div>
            <span className={`${styles.label} ${active ? styles.labelActive : ''}`}>{label}</span>
            {i < STEP_LABELS.length - 1 && <div className={`${styles.line} ${done ? styles.lineDone : ''}`} />}
          </div>
        )
      })}
    </div>
  )
}
