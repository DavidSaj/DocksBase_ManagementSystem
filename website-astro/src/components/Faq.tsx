import { useState } from 'react'
import styles from './Faq.module.css'
import type { Strings } from '../i18n/strings'

function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`${styles.item} ${open ? styles.open : ''}`}>
      <button className={styles.question} onClick={() => setOpen(o => !o)}>
        <span>{q}</span>
        <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6l4 4 4-4"/>
        </svg>
      </button>
      {open && <div className={styles.answer}><p>{a}</p></div>}
    </div>
  )
}

interface FaqProps { t: Strings }

export default function Faq({ t }: FaqProps) {
  return (
    <section className={styles.section} id="faq">
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>{t.faq.eyebrow}</div>
          <h2 className={styles.title}>{t.faq.title}</h2>
          <p className={styles.sub}>{t.faq.sub}</p>
        </div>
        <div className={styles.list}>
          {t.faq.items.map(item => <Item key={item.q} {...item} />)}
        </div>
      </div>
    </section>
  )
}
