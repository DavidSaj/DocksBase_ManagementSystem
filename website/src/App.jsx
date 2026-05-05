import './index.css'
import { useRef, useEffect } from 'react'
import { LanguageProvider } from './context/LanguageContext'
import Nav from './components/Nav'
import Hero from './components/Hero'
import TrustBar from './components/TrustBar'
import Features from './components/Features'
import Stats from './components/Stats'
import ProductSection from './components/ProductSection'
import SplitSection from './components/SplitSection'
import WhiteLabel from './components/WhiteLabel'
import HarborSizes from './components/HarborSizes'
import Quote from './components/Quote'
import MobileApp from './components/MobileApp'
import Pricing from './components/Pricing'
import Faq from './components/Faq'
import FeatureRequest from './components/FeatureRequest'
import CTA from './components/CTA'
import Footer from './components/Footer'

function ScrollReveal({ children, delay = 0 }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add('sr-in'); obs.unobserve(el) } },
      { threshold: 0.08 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className="sr" style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  )
}

function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      <Features />
      <Stats />
      <ProductSection />

      <SplitSection
          eyebrow="Built to Integrate"
          title="Fits your marina. Works with what you have."
          body="DocksBase is designed to slot into your existing operation — not replace it. Keep the tools your team already relies on and add DocksBase alongside them. Or run it fully standalone. Either way, you're up and running without disrupting a single season."
          checklist={[
            'No rip-and-replace — works alongside existing systems',
            'Connects with booking platforms and third-party apps',
            'Import your existing berth, vessel, and customer data',
            'Gradual rollout by department or pier at your pace',
            'Full standalone capability when you need it',
          ]}
          cta="See how it fits"
          image="/images/marina-aerial-close.jpg"
          alt="Aerial view of marina piers with boats"
        />
      <SplitSection
          eyebrow="Your Rules. Your Workflow."
          title="Manual control or smart algorithms — you decide."
          body="Some harbourmasters want full control over every berth assignment. Others want the system to handle it automatically. DocksBase supports both — switch between manual allocation and algorithmic optimisation at any time, for any pier."
          checklist={[
            'Manual mode: assign every berth yourself with full visibility',
            'Algorithmic mode: auto-assign by vessel size, draft, and stay length',
            'Sync incoming bookings from other booking platforms automatically',
            'Override algorithmic suggestions at any time',
            'Set rules per pier, per season, or per vessel type',
          ]}
          cta="Explore allocation modes"
          image="/images/marina-sailboats.jpg"
          alt="Sailboats moored in calm harbor"
          reverse
          cream
        />
      <SplitSection
          eyebrow="Complete Marina Platform"
          title="From arrival to invoice — every operation covered."
          body="DocksBase covers your full operation: live berth occupancy across all piers, a coordinated boatyard with crane schedules and work orders, and automated billing from berth fee to aged debtor. One system, one login, one source of truth."
          checklist={[
            'Real-time berth grid with walk-in and online bookings',
            'Haul-out queue, dry storage map, and work orders',
            'Automated invoices, utility billing, and fuel dock POS',
            'Aged debtor tracking with one-click chase workflow',
            'Export to CSV, PDF, XLSX or push to your accounts system',
          ]}
          cta="See the full platform"
          image="/images/marina-dock-boats.jpg"
          alt="Classic wooden boats at a dock"
        />

      <ScrollReveal><WhiteLabel /></ScrollReveal>
      <MobileApp />
      {/* <HarborSizes /> */}
      {/* <Quote /> */}
      <ScrollReveal><Pricing /></ScrollReveal>
      <ScrollReveal><Faq /></ScrollReveal>
      <ScrollReveal><FeatureRequest /></ScrollReveal>
      <ScrollReveal><CTA /></ScrollReveal>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <LandingPage />
    </LanguageProvider>
  )
}
