import { useEffect } from 'react'
import styles from './AboutModal.module.css'

export default function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        <div className={styles.badge}>ETH Zurich · Student Project</div>

        <h2 className={styles.title}>We're DocksBase.</h2>
        <p className={styles.lead}>
          A student group from ETH Zurich building the harbor management software we always wished existed.
        </p>

        <div className={styles.divider} />

        <div className={styles.body}>
          <p>
            DocksBase started as a semester project after one of our team members spent a summer working at a 200-berth marina and watched the harbor master run the whole operation from a whiteboard and three spreadsheets.
          </p>
          <p>
            We're a small team of engineers, designers, and maritime enthusiasts. Our goal is simple: give every harbor — from a 20-berth family marina to a 2,000-berth commercial port — the same quality of operational tooling that modern businesses take for granted.
          </p>
          <p>
            DocksBase is cloud-based, built from scratch, and covers the full operation in one platform. No integrations required. No consultants needed.
          </p>
        </div>

        <div className={styles.team}>
          <div className={styles.teamLabel}>Built at</div>
          <div className={styles.ethBadge}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
            ETH Zürich — Department of Computer Science
          </div>
        </div>

        <div className={styles.actions}>
          <a href="#" className={styles.btnPrimary}>Get in touch</a>
          <button className={styles.btnGhost} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
