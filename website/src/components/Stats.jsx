import { useEffect, useRef } from 'react'
import styles from './Stats.module.css'

const stats = [
  { num: '18', suffix: '', desc: 'Operational modules built and ready to use' },
  { num: '30', suffix: '-day', desc: 'Free trial — get started today' },
  { num: '99', suffix: '.9%', desc: 'Platform uptime — even in peak season' },
  { num: '4', suffix: 'hrs', desc: 'Average onboarding time for new harbors' },
]

export default function Stats() {
  const gridRef = useRef(null)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.querySelectorAll(`.${styles.item}`).forEach((item, i) =>
            setTimeout(() => item.classList.add(styles.itemVisible), i * 100)
          )
          obs.unobserve(el)
        }
      },
      { threshold: 0.2 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section className={styles.section}>
      <div className={styles.grid} ref={gridRef}>
        {stats.map(s => (
          <div className={styles.item} key={s.desc}>
            <div className={styles.num}>{s.num}<span>{s.suffix}</span></div>
            <div className={styles.desc}>{s.desc}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
