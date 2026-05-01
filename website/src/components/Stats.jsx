import styles from './Stats.module.css'

const stats = [
  { num: '200', suffix: '+', desc: 'Marinas and ports actively using DocksBase' },
  { num: '48', suffix: 'k', desc: 'Vessel arrivals managed every month' },
  { num: '99', suffix: '.9%', desc: 'Platform uptime — even in peak season' },
  { num: '4', suffix: 'hrs', desc: 'Average onboarding time for new harbors' },
]

export default function Stats() {
  return (
    <section className={styles.section}>
      <div className={styles.grid}>
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
