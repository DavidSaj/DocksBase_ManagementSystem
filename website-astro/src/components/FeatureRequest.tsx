import { useState } from 'react'
import styles from './FeatureRequest.module.css'
import type { Strings } from '../i18n/strings'

interface Props { t: Strings }

export default function FeatureRequest({ t }: Props) {
  const tr = t.featureRequest
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setSent(true)
  }

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.eyebrow}>{tr.eyebrow}</div>
          <h2 className={styles.title}>{tr.title}</h2>
          <p className={styles.sub}>{tr.sub}</p>
        </div>
        <div className={styles.right}>
          {sent ? (
            <div className={styles.success}>
              <div className={styles.successIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className={styles.successText}>{tr.success}</p>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <textarea
                className={styles.textarea}
                rows={5}
                placeholder={tr.placeholder}
                value={value}
                onChange={e => setValue(e.target.value)}
              />
              <div className={styles.formFooter}>
                <p className={styles.note}>{tr.note}</p>
                <button type="submit" className={styles.btn} disabled={!value.trim()}>
                  {tr.btn}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
