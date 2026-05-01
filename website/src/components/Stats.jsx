import styles from './Stats.module.css'

const stats = [
  { num: '18', suffix: '', desc: 'Operational modules built and ready to use' },
  { num: '30', suffix: '-day', desc: 'Free trial — no credit card required' },
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
