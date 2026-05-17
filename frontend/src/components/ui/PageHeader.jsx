import ScreenInfo from './ScreenInfo.jsx';

/**
 * Canonical marina-admin page header.
 *
 * Pattern (matches the Financial Accounting screen):
 *   - Title: 22px / 700, navy
 *   - Optional inline "?" ScreenInfo button next to the title
 *   - Optional one-line subtitle: 13px / 0.45 alpha
 *   - 20px bottom margin so the next block (tabs / cards) breathes
 *
 * Use either:
 *   <PageHeader title="Members" infoBody={SCREEN_INFO.members} subtitle="…" />
 *
 * Or pass children to inject custom right-aligned action(s):
 *   <PageHeader title="Reservations" subtitle="…" infoBody={SCREEN_INFO.reservations}>
 *     <button className="btn btn-primary">New Booking</button>
 *   </PageHeader>
 */
export default function PageHeader({
  title,
  subtitle,
  infoTitle,
  infoBody,
  children,
  style,
}) {
  return (
    <div style={{ marginBottom: 20, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <div style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--navy, #1a2d4a)',
          letterSpacing: '-0.2px',
          lineHeight: 1.2,
        }}>
          {title}
        </div>
        {infoBody && (
          <ScreenInfo title={infoTitle || title} body={infoBody} />
        )}
        {children && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {children}
          </div>
        )}
      </div>
      {subtitle && (
        <div style={{
          fontSize: 13,
          color: 'rgba(0,0,0,0.45)',
          marginTop: 2,
          lineHeight: 1.4,
        }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
