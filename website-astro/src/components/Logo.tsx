export default function Logo({ size = 26 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 42.2,10.8 L 46.9,10.1 L 47.7,4.1 L 52.3,4.1 L 53.1,10.1 A 40 40 0 0 1 57.8,10.8 L 62.4,12.0 L 65.4,6.7 L 69.7,8.5 L 68.2,14.4 A 40 40 0 0 1 72.2,16.7 L 76.0,19.6 L 80.8,15.9 L 84.1,19.2 L 80.4,24.0 A 40 40 0 0 1 83.3,27.8 L 85.6,31.8 L 91.5,30.3 L 93.3,34.6 L 88.0,37.6 A 40 40 0 0 1 89.2,42.2 L 89.9,46.9 L 95.9,47.7 L 95.9,52.3 L 89.9,53.1 A 40 40 0 0 1 89.2,57.8 L 88.0,62.4 L 93.3,65.4 L 91.5,69.7 L 85.6,68.2 A 40 40 0 0 1 83.3,72.2 L 80.4,76.0 L 84.1,80.8 L 80.8,84.1 L 76.0,80.4 A 40 40 0 0 1 72.2,83.3 L 68.2,85.6 L 69.7,91.5 L 65.4,93.3 L 62.4,88.0 A 40 40 0 0 1 57.8,89.2 L 53.1,89.9 L 52.3,95.9 L 47.7,95.9 L 46.9,89.9 A 40 40 0 0 1 42.2,89.2 L 37.6,88.0 L 34.6,93.3 L 30.3,91.5 L 31.8,85.6 A 40 40 0 0 1 27.8,83.3 L 24.0,80.4 L 19.2,84.1 L 15.9,80.8 L 19.6,76.0 A 40 40 0 0 1 16.7,72.2 L 14.4,68.2 L 8.5,69.7 L 6.7,65.4 L 12.0,62.4 A 40 40 0 0 1 10.8,57.8 L 10.1,53.1 L 4.1,52.3 L 4.1,47.7 L 10.1,46.9 A 40 40 0 0 1 10.8,42.2 L 12.0,37.6 L 6.7,34.6 L 8.5,30.3 L 14.4,31.8 A 40 40 0 0 1 16.7,27.8 L 19.6,24.0 L 15.9,19.2 L 19.2,15.9 L 24.0,19.6 A 40 40 0 0 1 27.8,16.7 L 31.8,14.4 L 30.3,8.5 L 34.6,6.7 L 37.6,12.0 A 40 40 0 0 1 42.2,10.8 Z"
          stroke="rgba(255,255,255,0.92)" strokeWidth="3" fill="none" strokeLinejoin="round"/>
        <circle cx="50" cy="50" r="36" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none"/>
        <path d="M 50.0,22.0 L 54.5,50.0 L 50.0,46.0 L 45.5,50.0 Z" fill="#b8965a" stroke="#b8965a" strokeWidth="1" strokeLinejoin="round"/>
        <path d="M 50.0,78.0 L 45.5,50.0 L 50.0,54.0 L 54.5,50.0 Z" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M 69.0,50.0 L 50.0,53.5 L 53.0,50.0 L 50.0,46.5 Z" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M 31.0,50.0 L 50.0,46.5 L 47.0,50.0 L 50.0,53.5 Z" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
        <circle cx="50" cy="50" r="3.5" fill="#b8965a"/>
      </svg>
      <div style={{ width: 1, height: 34, background: 'rgba(255,255,255,0.18)', flexShrink: 0, margin: '0 2px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 4 }}>
        <span style={{ fontFamily: "'Jost',sans-serif", fontWeight: 600, fontSize: 13, letterSpacing: '3.5px', textTransform: 'uppercase', color: '#fff' }}>DOCKS</span>
        <span style={{ fontFamily: "'Jost',sans-serif", fontWeight: 300, fontSize: 13, letterSpacing: '3.5px', color: '#c9a84c' }}>Base</span>
      </div>
    </div>
  )
}
