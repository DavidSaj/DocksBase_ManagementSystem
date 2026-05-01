import { useState } from 'react'
import styles from './Features.module.css'
import AnchorDivider from './AnchorDivider'

const TABS = [
  {
    label: 'Operations',
    modules: [
      {
        title: 'Overview Dashboard',
        desc: 'Live stat cards, activity log, weather widget, urgent alerts, and pending bookings — your entire harbor at a glance every morning.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
      },
      {
        title: 'Marina Map',
        desc: 'Interactive top-down SVG harbor map with animated water, color-coded slip status, and click-to-detail vessel info. Real-time, always accurate.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.657 16.657L13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
      },
      {
        title: 'Reservations',
        desc: 'Transient, seasonal, pending, overdue, wait list, and fuel dock — 7 tabs covering every booking type with one-click confirm and side detail panels.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
      },
      {
        title: 'Vessels',
        desc: 'Full vessel registry with AIS tracker, certificate expiry monitoring, owner contacts, specs, and arrival/departure logs. Find any vessel in seconds.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
      },
      {
        title: 'Documents & eSign',
        desc: 'Manage document templates, send signature envelopes, track completion, and mass-send forms to member segments — paperwork handled from your desk.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
      },
    ],
  },
  {
    label: 'Yard & Crew',
    modules: [
      {
        title: 'Boatyard',
        desc: '8 tabs: haul-out schedule, launch queue, dry storage map, work orders, parts & inventory, tools, contractors, facility log. Full yard visibility.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
      },
      {
        title: 'Maintenance',
        desc: 'Staff task checklists, incident reporting, asset register with service dates, and defect log with severity tracking and work order escalation.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
      },
      {
        title: 'Staff',
        desc: 'Staff register, rota planning, time tracking, and skills matrix. Assign crew to jobs and get full accountability over who did what and when.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
      },
    ],
  },
  {
    label: 'Finance',
    modules: [
      {
        title: 'Billing',
        desc: '5 tabs: invoices with chase actions, utility meter billing, fuel dock POS, aged debtors buckets, and batch billing exports in CSV/PDF/XLSX.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
      },
      {
        title: 'Reports',
        desc: 'Revenue analytics, occupancy trends, and yard throughput charts. Exportable summaries for end-of-month reporting and board presentations.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
      },
    ],
  },
  {
    label: 'People',
    modules: [
      {
        title: 'Members',
        desc: 'Member and owner registry with full detail panels, document vault, communications blast (email/SMS), and segment builder for targeted outreach.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
      },
      {
        title: 'Document Vault',
        desc: 'Per-owner registration documents, insurance certificates, and lease agreements — all tracked, all accessible. Expiry alerts before they become problems.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
      },
      {
        title: 'Communications',
        desc: 'Send emails and SMS to individual owners or entire member segments. Built-in segment filters so the right message reaches the right people.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
      },
    ],
  },
  {
    label: 'Hospitality',
    modules: [
      {
        title: 'Restaurant',
        desc: 'Menu management, table reservations, and a kitchen display system — for marinas running an on-site café, bar, or full restaurant.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>,
      },
      {
        title: 'Events',
        desc: 'Venue hire, event scheduling, and booking management. Turn your marina into a destination with regatta days, open days, and private hire.',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
      },
    ],
  },
]

export default function Features() {
  const [activeTab, setActiveTab] = useState(0)
  const modules = TABS[activeTab].modules

  return (
    <section className={styles.section} id="features">
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>The full platform</div>
          <h2 className={styles.title}>14 modules. One platform.</h2>
          <p className={styles.sub}>Every tool a harbor needs — built in, not bolted on.</p>
        </div>
        <AnchorDivider style={{ marginTop: 48 }} />
        <div className={styles.tabs}>
          {TABS.map((tab, i) => (
            <button
              key={tab.label}
              className={`${styles.tab} ${i === activeTab ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(i)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.grid}>
          {modules.map(m => (
            <div className={styles.card} key={m.title}>
              <div className={styles.icon}>{m.icon}</div>
              <div className={styles.cardTitle}>{m.title}</div>
              <p className={styles.desc}>{m.desc}</p>
            </div>
          ))}
        </div>
        <p className={styles.allModules}>
          <span className={styles.badge}>14 modules included</span> — Operations · Yard & Crew · Finance · People · Hospitality
        </p>
      </div>
    </section>
  )
}
