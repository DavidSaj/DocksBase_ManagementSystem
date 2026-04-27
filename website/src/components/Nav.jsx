import { Link, useLocation } from 'react-router-dom';

export default function Nav() {
  const { pathname } = useLocation();
  return (
    <nav className="site-nav">
      <Link to="/" className="site-nav-brand">
        <div className="site-nav-logo">M</div>
        <span className="site-nav-name">Marina Bay 94</span>
      </Link>
      <div className="site-nav-links">
        <Link to="/services" className={`site-nav-link${pathname === '/services' ? ' active' : ''}`}>Services</Link>
        <Link to="/book" className={`site-nav-link${pathname === '/book' ? ' active' : ''}`}>Availability</Link>
        <Link to="/book" className="btn-gold">Book Now</Link>
      </div>
    </nav>
  );
}
