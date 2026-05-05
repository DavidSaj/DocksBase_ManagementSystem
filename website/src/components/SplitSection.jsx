import { useEffect, useRef } from 'react'
import styles from './SplitSection.module.css'

function CheckIcon() {
  return (
    <div className={styles.checkIcon}>
      <svg viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5">
        <polyline points="2,6 5,9 10,3"/>
      </svg>
    </div>
  )
}

export default function SplitSection({ eyebrow, title, body, checklist, cta, image, alt, reverse, cream }) {
  const layoutRef = useRef(null)

  useEffect(() => {
    const el = layoutRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.querySelector(`.${styles.imageWrap}`)?.classList.add(styles.imageVisible)
          el.querySelector(`.${styles.text}`)?.classList.add(styles.textVisible)
          obs.unobserve(el)
        }
      },
      { threshold: 0.12 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section className={`${styles.section} ${cream ? styles.cream : ''}`} id="about">
      <div className={styles.inner}>
        <div className={`${styles.layout} ${reverse ? styles.reverse : ''}`} ref={layoutRef}>
          <div className={styles.imageWrap}>
            <img src={image} alt={alt} loading="lazy" className={styles.img} />
            <div className={styles.imgOverlay} />
          </div>
          <div className={styles.text}>
            <div className={styles.eyebrow}>{eyebrow}</div>
            <h3 className={styles.title}>{title}</h3>
            <p className={styles.body}>{body}</p>
            <ul className={styles.list}>
              {checklist.map(item => (
                <li key={item}><CheckIcon />{item}</li>
              ))}
            </ul>
            <a href="#" className={styles.btnText}>{cta} →</a>
          </div>
        </div>
      </div>
    </section>
  )
}
