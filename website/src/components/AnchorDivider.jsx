import styles from './AnchorDivider.module.css'

export default function AnchorDivider({ style }) {
  return (
    <div className={styles.divider} style={style}>
      <div className={styles.line} />
      <svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
        <circle cx="12" cy="4" r="3"/><line x1="12" y1="7" x2="12" y2="26"/>
        <line x1="4" y1="13" x2="20" y2="13"/>
        <path d="M4 13 Q2 20 6 24"/><path d="M20 13 Q22 20 18 24"/>
        <path d="M6 24 Q12 27 18 24"/>
      </svg>
      <div className={styles.line} />
    </div>
  )
}
