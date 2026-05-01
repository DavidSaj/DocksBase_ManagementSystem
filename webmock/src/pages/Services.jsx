import { MARINA_SERVICES } from '@shared/mock.js';
import { Link } from 'react-router-dom';

export default function Services() {
  return (
    <main>
      <div style={{ background: 'var(--navy2)', padding: '60px 40px 40px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div className="section-label">Marina Bay 94</div>
          <h1 className="section-title" style={{ marginBottom: 6 }}>Marina services.</h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', maxWidth: 500 }}>
            Everything your vessel needs, in one place. All services available to transient and annual berth holders.
          </p>
        </div>
      </div>

      <div className="site-section">
        <div className="services-grid">
          {MARINA_SERVICES.map(s => (
            <div key={s.id} className="service-card">
              <div className="service-card-icon">{s.icon}</div>
              <div className="service-card-name">{s.name}</div>
              <div className="service-card-desc">{s.desc}</div>
              <div className="service-card-price">{s.price}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 48, padding: '28px 32px', background: 'rgba(184,150,90,0.07)', border: '1px solid rgba(184,150,90,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--cream)', marginBottom: 4 }}>Ready to book a berth?</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Check real-time availability and reserve instantly.</div>
          </div>
          <Link to="/book" className="btn-gold">Check Availability</Link>
        </div>
      </div>
    </main>
  );
}
