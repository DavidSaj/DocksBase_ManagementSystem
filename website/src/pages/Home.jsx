import { Link } from 'react-router-dom';
import { MARINA_SERVICES } from '@shared/mock.js';

export default function Home() {
  const preview = MARINA_SERVICES.slice(0, 4);

  return (
    <main>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(155deg, var(--navy) 55%, #1a3d52 100%)' }}>
        <div className="hero">
          <div className="hero-eyebrow">Marina Bay 94 · Full-Service Marina</div>
          <h1 className="hero-title">Your berth awaits<br />on the Adriatic.</h1>
          <p className="hero-sub">
            240 berths across 4 piers. Transient stays, seasonal berths, haul-out, and
            everything your vessel needs — bookable instantly, online.
          </p>
          <div className="hero-stats">
            <div>
              <div className="hero-stat-val">240</div>
              <div className="hero-stat-label">Total berths</div>
            </div>
            <div>
              <div className="hero-stat-val">4</div>
              <div className="hero-stat-label">Piers</div>
            </div>
            <div>
              <div className="hero-stat-val">Open</div>
              <div className="hero-stat-label">Year-round</div>
            </div>
          </div>
          <div className="hero-ctas">
            <Link to="/book" className="btn-gold">Check Availability</Link>
            <Link to="/services" className="btn-outline">Our Services</Link>
          </div>
        </div>
      </div>

      {/* Services preview */}
      <div className="site-section">
        <div className="section-label">What we offer</div>
        <h2 className="section-title">Everything onboard.</h2>
        <p className="section-sub">A full-service marina, from fuel to haul-out.</p>
        <div className="services-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          {preview.map(s => (
            <div key={s.id} className="service-card">
              <div className="service-card-icon">{s.icon}</div>
              <div className="service-card-name">{s.name}</div>
              <div className="service-card-desc">{s.desc}</div>
              <div className="service-card-price">{s.price}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24 }}>
          <Link to="/services" className="btn-outline">View all services →</Link>
        </div>
      </div>

      {/* How it works */}
      <div className="site-section" style={{ paddingTop: 0 }}>
        <div className="section-label">Instant booking</div>
        <h2 className="section-title">Three steps to your berth.</h2>
        <p className="section-sub" style={{ marginBottom: 28 }}>Real-time availability, no back-and-forth.</p>
        <div className="how-steps">
          <div className="how-step">
            <div className="how-step-num">01</div>
            <div className="how-step-title">Search availability</div>
            <div className="how-step-desc">Enter your arrival date, departure date, and vessel dimensions to see matching berths.</div>
          </div>
          <div className="how-step">
            <div className="how-step-num">02</div>
            <div className="how-step-title">Select your berth</div>
            <div className="how-step-desc">Browse available berths by pier, size, amenities, and price. View the pier layout before choosing.</div>
          </div>
          <div className="how-step">
            <div className="how-step-num">03</div>
            <div className="how-step-title">Confirm instantly</div>
            <div className="how-step-desc">Enter vessel and skipper details. Your booking is confirmed immediately with a reference number.</div>
          </div>
        </div>
      </div>
    </main>
  );
}
