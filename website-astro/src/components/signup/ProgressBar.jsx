import styles from './ProgressBar.module.css'

const DEFAULT_LABELS = ['Plan', 'Marina', 'Account', 'Payment']

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function ProgressBar({ step, t, labels }) {
  const stepLabels = labels || t?.progress?.steps || DEFAULT_LABELS
  return (
    <div className={styles.bar}>
      {stepLabels.map((label, i) => {
        const num = i + 1
        const done = step > num
        const active = step === num
        const future = step < num
        return (
          <div key={label} className={styles.stepGroup}>
            <div className={styles.stepCol}>
              <div className={[
                styles.circle,
                done   ? styles.done   : '',
                active ? styles.active : '',
                future ? styles.future : '',
              ].join(' ')}>
                {done ? <Check /> : <span className={styles.num}>{num}</span>}
              </div>
              <span className={[
                styles.label,
                active ? styles.labelActive : '',
                done   ? styles.labelDone   : '',
              ].join(' ')}>{label}</span>
            </div>
            {i < stepLabels.length - 1 && (
              <div className={`${styles.connector} ${done ? styles.connectorDone : ''}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
