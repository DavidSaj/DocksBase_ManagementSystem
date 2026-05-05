import { useEffect, useRef } from 'react'
import styles from './ProductSection.module.css'

export default function ProductSection() {
  const layoutRef = useRef(null)

  useEffect(() => {
    const el = layoutRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.querySelector(`.${styles.text}`)?.classList.add(styles.textVisible)
          setTimeout(() => el.querySelector(`.${styles.screenshot}`)?.classList.add(styles.shotVisible), 150)
          obs.unobserve(el)
        }
      },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section className={styles.section} id="product">
      <div className={styles.inner}>
        <div className={styles.layout} ref={layoutRef}>
          <div className={styles.text}>
            <div className={styles.eyebrow}>Live Platform</div>
            <h2 className={styles.title}>Built for the dock. Ready on day one.</h2>
            <p className={styles.sub}>
              No training weeks. No consultants. Onboard your harbor in under 4 hours and have your full operation visible from one screen — berths, arrivals, payments, and alerts, all live.
            </p>
            <div style={{ marginTop: 32, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className={styles.demoBtn}>Try the live demo</button>
            </div>
          </div>
          <div className={styles.screenshot}>
            <img
              src="/images/app-overview.png"
              alt="DocksBase — Overview dashboard showing berths, arrivals, weather and urgent panel"
              className={styles.img}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
