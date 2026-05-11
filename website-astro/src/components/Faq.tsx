import { useState } from 'react'
import styles from './Faq.module.css'

const QUESTIONS = [
  {
    q: 'Do I need to replace my current software to use DocksBase?',
    a: "No. DocksBase is designed to work alongside your existing systems. Keep using your current booking tools, accounting software, or any other platforms you rely on — DocksBase plugs in and handles what's missing. If you prefer a clean break, it also runs as a complete standalone system from day one.",
  },
  {
    q: 'How long does setup take?',
    a: "Most harbors are fully operational within 4 hours. You import your existing berths, vessels, and customer data, walk through a short setup guide, and you're live. No consultants, no training weeks, no on-site visits required.",
  },
  {
    q: 'Can I choose how berths get assigned — manually or automatically?',
    a: 'Both modes are available and you can switch anytime. Manual mode lets your harbourmaster assign every berth directly from the grid. Algorithmic mode automatically selects the most efficient available berth based on vessel size, draft, and length of stay. You can override any automated assignment instantly.',
  },
  {
    q: 'Does DocksBase sync with other booking platforms we already use?',
    a: 'Yes. DocksBase syncs incoming reservations from third-party booking platforms automatically so your berth availability stays consistent across all channels. You control which platform takes priority and which bookings get auto-confirmed.',
  },
  {
    q: 'Can boaters book online directly through us?',
    a: 'Every plan includes a boater-facing online booking portal. Boaters can search availability, request berths, and pay by card. With the white-label option you can publish it under your own domain — reservations.yourmarina.com — and boaters never see the DocksBase name.',
  },
  {
    q: 'What size harbor is DocksBase designed for?',
    a: "DocksBase scales from small private marinas with 20 berths to large commercial harbors with 500+. Pricing and active modules adjust to your operation size — there's no bloated enterprise tier you need to grow into.",
  },
  {
    q: 'Is it cloud-based? Do staff need to install anything?',
    a: "Fully cloud-based. Your team logs in from any browser on any device — desktop, tablet, or phone. There's also a native mobile app for dock staff who need to log walk-in arrivals or check berth status from the pier without going back to an office.",
  },
  {
    q: 'Where is our data stored? Is DocksBase GDPR compliant?',
    a: 'All data is stored in EU data centers. DocksBase is fully GDPR-compliant, with role-based access controls, encrypted storage at rest and in transit, and detailed audit logs so you always know who accessed what and when.',
  },
  {
    q: 'What if we want to leave?',
    a: 'You can export all your data — berths, vessels, customer records, reservations, invoices — as CSV or PDF at any time. No lock-in, no exit fees, no hoops to jump through.',
  },
  {
    q: 'Is there support when we get stuck?',
    a: 'Every plan includes email support and a full onboarding guide. Higher-tier plans include live chat and a dedicated onboarding call with our team. We also read every message sent through the feature request form and reply within 2 business days.',
  },
]

function Item({ q, a }) {
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

export default function Faq() {
  return (
    <section className={styles.section} id="faq">
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>FAQ</div>
          <h2 className={styles.title}>Common questions, straight answers.</h2>
          <p className={styles.sub}>Everything harbor managers ask before getting started.</p>
        </div>
        <div className={styles.list}>
          {QUESTIONS.map(item => <Item key={item.q} {...item} />)}
        </div>
      </div>
    </section>
  )
}
