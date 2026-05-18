/* React primitives that map to the .db-* classes in styles/components.css.
   Use these in portal/ and field/ to keep the visual language consistent. */

export function Card({ children, light, className = '', ...rest }) {
  return (
    <div className={`${light ? 'db-card-light' : 'db-card'} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardRow({ label, value, dot, light, ...rest }) {
  return (
    <Card light={light} {...rest}>
      <div className="db-card-row">
        <span className={light ? 'db-label-light' : 'db-label'}>{label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className={light ? 'db-value-light' : 'db-value'}>{value}</span>
          {dot && <StatusDot variant={dot} />}
        </span>
      </div>
    </Card>
  );
}

export function StatusDot({ variant = 'green' }) {
  return <span className={`db-dot db-dot-${variant}`} aria-hidden="true" />;
}

export function Button({ children, variant = 'primary', light = false, block = false, ...rest }) {
  const variantClass =
    variant === 'primary'
      ? 'db-btn-primary'
      : light
        ? 'db-btn-ghost-light'
        : 'db-btn-ghost';
  return (
    <button
      className={`db-btn ${variantClass} ${block ? 'db-btn-block' : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonRow({ children }) {
  return <div className="db-btn-row">{children}</div>;
}

export function Eyebrow({ children, teal = false }) {
  return (
    <div className={`db-eyebrow ${teal ? 'db-eyebrow-teal' : ''}`}>{children}</div>
  );
}

export function Greeting({ children, light = false }) {
  return (
    <h1 className={`db-greeting ${light ? 'db-greeting-light' : ''}`}>{children}</h1>
  );
}

export function Title({ children, light = false }) {
  return (
    <h2 className={`db-title ${light ? 'db-title-light' : ''}`}>{children}</h2>
  );
}

export function Sub({ children, light = false }) {
  return (
    <div className={`db-sub ${light ? 'db-sub-light' : ''}`}>{children}</div>
  );
}

export function Body({ children, light = false }) {
  return (
    <p className={`db-body ${light ? 'db-body-light' : ''}`}>{children}</p>
  );
}

export function Badge({ children, variant = 'live' }) {
  return <span className={`db-badge db-badge-${variant}`}>{children}</span>;
}

export function BrandMark({ light = false }) {
  return (
    <span className={`db-brand ${light ? 'db-brand-light' : ''}`}>
      <span className="db-brand-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="3" />
          <line x1="12" y1="8" x2="12" y2="22" />
          <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
        </svg>
      </span>
      <span>DocksBase</span>
    </span>
  );
}
