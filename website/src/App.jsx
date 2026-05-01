import './index.css'
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
import Pricing from './components/Pricing'
import FeatureRequest from './components/FeatureRequest'
import CTA from './components/CTA'
import Footer from './components/Footer'

function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      <TrustBar />
      <Features />
      <Stats />
      <ProductSection />

      <SplitSection
        eyebrow="Berths & Reservations"
        title="Live occupancy. Zero clipboards."
        body="See every berth across every pier in real time. Take walk-in arrivals at the dock or advance bookings online — and generate invoices the moment a vessel departs."
        checklist={[
          'Real-time berth grid across all piers',
          'Walk-in arrivals and advance online bookings',
          'Auto-invoices on check-out',
          'Wait list management with deposit tracking',
          'Fuel dock queue and POS built in',
        ]}
        cta="Explore reservations"
        image="/images/marina-aerial-close.jpg"
        alt="Aerial view of marina piers with boats"
      />

      <SplitSection
        eyebrow="Boatyard & Maintenance"
        title="Crane schedules to work orders — fully coordinated."
        body="Run your full boatyard from one screen. Haul-outs, launches, dry storage, work orders, parts inventory, tools, and contractors — every job tracked, every technician accountable."
        checklist={[
          'Haul-out & launch queue with weather hold',
          'Dry storage map with visual lane layout',
          'Work orders with parts, costs, and status',
          'Asset register with overdue service alerts',
          'Defect log with work order escalation',
        ]}
        cta="Explore boatyard"
        image="/images/marina-sailboats.jpg"
        alt="Sailboats moored in calm harbor"
        reverse
        cream
      />

      <SplitSection
        eyebrow="Billing & Finance"
        title="From berth fee to aged debtor — one place."
        body="Automated invoices, utility meter billing, fuel dock POS, and a full aged debtor chase workflow. Export everything to CSV, PDF, or XLSX — or push straight to your accounts system."
        checklist={[
          'Automated invoices on vessel departure',
          'Utility meter readings with estimated charges',
          'Fuel dock point-of-sale with receipt printing',
          'Aged debtor buckets with one-click chase',
          'Batch billing and end-of-day Z-reports',
        ]}
        cta="Explore billing"
        image="/images/marina-dock-boats.jpg"
        alt="Classic wooden boats at a dock"
      />

      <WhiteLabel />
      <HarborSizes />
      <Quote />
      <Pricing />
      <FeatureRequest />
      <CTA />
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
