import styles from './Quote.module.css'

export default function Quote() {
  return (
    <section className={styles.section}>
      <div className={styles.bg} />
      <div className={styles.inner}>
        <div className={styles.mark}>"</div>
        <p className={styles.text}>
          Before DocksBase we were running a busy 300-berth marina off a spreadsheet and a whiteboard. Within a week of switching, we had full visibility of every berth, every booking, every outstanding payment. It changed how we work.
        </p>
        <div className={styles.attr}>Capt. M. Hargreaves</div>
        <div className={styles.role}>Harbor Master, Harwich Marina</div>
      </div>
    </section>
  )
}
