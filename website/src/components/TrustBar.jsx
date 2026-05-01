import styles from './TrustBar.module.css'

const marinas = ['Harwich Marina', 'Port Vauban', 'Gibraltar Yacht Marina', 'Zea Marina', 'Royal Harbour', 'Palma de Mallorca']

export default function TrustBar() {
  return (
    <div className={styles.bar}>
      <span className={styles.label}>Trusted by 200+ marinas worldwide</span>
      <div className={styles.names}>
        {marinas.map((name, i) => (
          <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
            <span className={styles.name}>{name}</span>
            {i < marinas.length - 1 && <span className={styles.dot} />}
          </span>
        ))}
      </div>
    </div>
  )
}
