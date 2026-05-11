import { motion } from 'framer-motion';

const NAVY  = '#0c1f3d';
const GOLD  = '#c9a84c';
const CREAM = '#faf8f5';

// Generates precise rectangular-toothed gear path
function gearPath(cx, cy, outerR, innerR, numTeeth, toothRatio = 0.46) {
  const step = (2 * Math.PI) / numTeeth;
  const p = (r, a) =>
    `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`;
  let d = '';
  for (let i = 0; i < numTeeth; i++) {
    const base   = i * step - Math.PI / 2;
    const gap    = (1 - toothRatio) / 2;
    const tStart = base + step * gap;
    const tEnd   = base + step * (1 - gap);
    if (i === 0) d += `M ${p(innerR, base)} `;
    d += `A ${innerR} ${innerR} 0 0 1 ${p(innerR, tStart)} `;
    d += `L ${p(outerR, tStart)} `;
    d += `A ${outerR} ${outerR} 0 0 1 ${p(outerR, tEnd)} `;
    d += `L ${p(innerR, tEnd)} `;
  }
  return d + 'Z';
}

const GEAR = gearPath(50, 50, 46, 40, 24, 0.46);

const r = (deg) => deg * Math.PI / 180;
const pt = (angle_deg, radius, cx = 50, cy = 50) =>
  `${(cx + radius * Math.sin(r(angle_deg))).toFixed(2)},${(cy - radius * Math.cos(r(angle_deg))).toFixed(2)}`;

const STAR =
  `M ${pt(0,   28)}` +
  `L ${pt(22.5, 4)}` +
  `L ${pt(45,  11)}` +
  `L ${pt(67.5, 4)}` +
  `L ${pt(90,  20)}` +
  `L ${pt(112.5,4)}` +
  `L ${pt(135, 11)}` +
  `L ${pt(157.5,4)}` +
  `L ${pt(180, 22)}` +
  `L ${pt(202.5,4)}` +
  `L ${pt(225, 11)}` +
  `L ${pt(247.5,4)}` +
  `L ${pt(270, 20)}` +
  `L ${pt(292.5,4)}` +
  `L ${pt(315, 11)}` +
  `L ${pt(337.5,4)}` +
  'Z';

const NORTH_ARM =
  `M ${pt(0,   28)}` +
  `L ${pt(22.5, 4)}` +
  `L ${pt(337.5,4)}` +
  'Z';

const SPIN_K = [40, 751, 697, 742, 709, 732, 713, 724, 716, 722, 719, 720];
const SPIN_T = [0, 0.44, 0.56, 0.65, 0.73, 0.80, 0.86, 0.90, 0.94, 0.96, 0.98, 1.0];

// Tick positions for nautical chart lines
const TICKS_TOP    = [180, 360, 540, 720, 900, 1080, 1260];
const TICKS_MID    = [270, 540, 810, 1080];
const TICKS_LOWER  = [360, 720, 1080];
const DOCK_PILINGS = [85, 165, 245, 325];

function BackgroundScene() {
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      {/* ── NAUTICAL CHART LINES — top ── */}
      {/* Three horizontal parallels with bearing tick marks */}
      <line x1="0" y1="58"  x2="1440" y2="58"  stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.11" />
      <line x1="0" y1="124" x2="1440" y2="124" stroke={CREAM} strokeWidth="0.55" strokeOpacity="0.08" />
      <line x1="0" y1="184" x2="1440" y2="184" stroke={CREAM} strokeWidth="0.55" strokeOpacity="0.06" />

      {TICKS_TOP.map(x => (
        <line key={x} x1={x} y1="53"  x2={x} y2="63"  stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.12" />
      ))}
      {TICKS_MID.map(x => (
        <line key={x} x1={x} y1="120" x2={x} y2="128" stroke={CREAM} strokeWidth="0.55" strokeOpacity="0.09" />
      ))}
      {TICKS_LOWER.map(x => (
        <line key={x} x1={x} y1="181" x2={x} y2="187" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.07" />
      ))}

      {/* Diagonal bearing lines from top corners toward horizon — nautical chart style */}
      <line x1="0"    y1="0" x2="460"  y2="595" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.07" />
      <line x1="1440" y1="0" x2="980"  y2="595" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.07" />
      {/* Second inner diagonals */}
      <line x1="0"    y1="0" x2="260"  y2="595" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.04" />
      <line x1="1440" y1="0" x2="1180" y2="595" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.04" />

      {/* ── HORIZON ── */}
      <line x1="0" y1="595" x2="1440" y2="595"
        stroke={CREAM} strokeWidth="1.0" strokeOpacity="0.18" />

      {/* Subtle water tint */}
      <rect x="0" y="595" width="1440" height="305" fill={CREAM} fillOpacity="0.018" />

      {/* ── WAVES ── */}
      <path d="M 0,609 C 240,602 480,616 720,609 C 960,602 1200,616 1440,609"
        stroke={CREAM} strokeWidth="1.0" strokeOpacity="0.10" />
      <path d="M 0,654 C 200,643 450,665 720,654 C 990,643 1240,665 1440,654"
        stroke={CREAM} strokeWidth="1.1" strokeOpacity="0.12" />
      <path d="M -20,724 C 180,710 410,738 660,724 C 910,710 1140,738 1380,724 C 1410,720 1460,724 1460,724"
        stroke={CREAM} strokeWidth="1.3" strokeOpacity="0.11" />

      {/* ── GOLD WATER GLINTS ── */}
      <line x1="510"  y1="635" x2="548"  y2="635" stroke={GOLD} strokeWidth="0.8" strokeOpacity="0.17" />
      <line x1="521"  y1="642" x2="537"  y2="642" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.11" />
      <line x1="710"  y1="664" x2="752"  y2="664" stroke={GOLD} strokeWidth="0.7" strokeOpacity="0.13" />
      <line x1="1060" y1="647" x2="1098" y2="647" stroke={GOLD} strokeWidth="0.7" strokeOpacity="0.14" />
      <line x1="1180" y1="676" x2="1214" y2="676" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.10" />

      {/* ── DOCK — left edge, extends into scene ── */}
      {/* Deck surface fill */}
      <rect x="0" y="582" width="360" height="13" fill={CREAM} fillOpacity="0.06" />
      {/* Top rail */}
      <line x1="0" y1="582" x2="360" y2="582"
        stroke={CREAM} strokeWidth="1.8" strokeOpacity="0.22" />
      {/* Waterline rail */}
      <line x1="0" y1="595" x2="360" y2="595"
        stroke={CREAM} strokeWidth="1.0" strokeOpacity="0.16" />
      {/* Deck planks */}
      <line x1="0" y1="586" x2="360" y2="586" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.08" />
      <line x1="0" y1="590" x2="360" y2="590" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.07" />

      {/* Pilings — going down into water */}
      {DOCK_PILINGS.map(x => (
        <rect key={x} x={x - 3} y="595" width="7" height="90" rx="2"
          fill={CREAM} fillOpacity="0.13" />
      ))}

      {/* Cross-bracing between pilings */}
      {DOCK_PILINGS.slice(0, -1).map((x, i) => {
        const nx = DOCK_PILINGS[i + 1];
        return (
          <g key={x}>
            <line x1={x}  y1="597" x2={nx} y2="648" stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.08" />
            <line x1={nx} y1="597" x2={x}  y2="648" stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.08" />
          </g>
        );
      })}

      {/* Bollard caps on top of each piling */}
      {DOCK_PILINGS.map(x => (
        <rect key={x} x={x - 5} y="575" width="10" height="7" rx="1.5"
          fill={CREAM} fillOpacity="0.17" />
      ))}

      {/* ── MAIN BOAT — center-right ── */}
      <motion.g
        animate={{ y: [0, -4, 1, -3, 0] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.28, 0.52, 0.74, 1] }}
      >
        {/* Hull */}
        <path d="M 762,595 L 765,604 Q 824,609 888,603 L 893,595 L 886,589 L 764,589 Z"
          fill={CREAM} fillOpacity="0.18" stroke={CREAM} strokeWidth="0.8" strokeOpacity="0.22" />
        {/* Cabin */}
        <path d="M 796,589 L 854,589 L 854,583 Q 838,580 824,580 Q 808,580 796,582 Z"
          fill={CREAM} fillOpacity="0.14" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.15" />
        {/* Mast */}
        <line x1="826" y1="589" x2="826" y2="494"
          stroke={CREAM} strokeWidth="1.5" strokeOpacity="0.24" />
        {/* Main sail */}
        <path d="M 826,494 L 826,589 L 896,597 Z"
          fill={CREAM} fillOpacity="0.13" stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.17" />
        {/* Jib */}
        <path d="M 826,494 L 893,594 L 826,589 Z"
          fill={CREAM} fillOpacity="0.09" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.13" />
        {/* Boom */}
        <line x1="826" y1="589" x2="896" y2="597"
          stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.16" />
      </motion.g>

      {/* ── DISTANT BOAT — mid-left ── */}
      <motion.g
        animate={{ y: [0, -2.5, 0.8, -2, 0] }}
        transition={{ duration: 6.8, repeat: Infinity, ease: 'easeInOut', delay: 1.6 }}
        opacity="0.72"
      >
        <path d="M 528,593 L 529,599 Q 558,603 592,599 L 594,593 L 590,590 L 530,590 Z"
          fill={CREAM} fillOpacity="0.14" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.17" />
        <line x1="554" y1="590" x2="554" y2="556"
          stroke={CREAM} strokeWidth="1.0" strokeOpacity="0.18" />
        <path d="M 554,556 L 554,590 L 593,595 Z"
          fill={CREAM} fillOpacity="0.08" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.12" />
        <path d="M 554,556 L 592,591 L 554,590 Z"
          fill={CREAM} fillOpacity="0.06" />
      </motion.g>
    </svg>
  );
}

export default function WelcomeScreen({ name, onDone }) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.025 }}
      transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
      onClick={onDone}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: NAVY,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 50% 40% at 50% 46%, rgba(201,168,76,0.07) 0%, transparent 68%)',
      }} />

      <BackgroundScene />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.34, 1.25, 0.64, 1] }}
        style={{ marginBottom: 40 }}
      >
        <svg width="152" height="152" viewBox="0 0 100 100" fill="none">
          <defs>
            <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.0" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* Gear — white, rotates slowly */}
          <motion.path
            d={GEAR}
            stroke={CREAM}
            strokeWidth="0.9"
            strokeOpacity="0.88"
            fill="none"
            strokeLinejoin="round"
            style={{ transformOrigin: '50px 50px' }}
            animate={{ rotate: 75 }}
            transition={{ duration: 3.8, ease: [0.25, 0.1, 0.25, 1] }}
          />

          {/* Inner ring */}
          <circle cx="50" cy="50" r="36.5"
            stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.5" fill="none" />

          {/* Compass rose */}
          <motion.g
            style={{ transformOrigin: '50px 50px' }}
            initial={{ rotate: 40 }}
            animate={{ rotate: SPIN_K }}
            transition={{ times: SPIN_T, duration: 2.8, delay: 0.5, ease: 'easeOut' }}
          >
            <path d={STAR}
              fill="none"
              stroke={CREAM}
              strokeWidth="0.75"
              strokeOpacity="0.9"
              strokeLinejoin="round" />
            <path d={NORTH_ARM}
              fill={GOLD}
              stroke={GOLD}
              strokeWidth="0.4"
              strokeLinejoin="round"
              filter="url(#glow)" />
          </motion.g>

          {/* Centre pivot */}
          <circle cx="50" cy="50" r="2.2"
            fill={NAVY} stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.7" />
          <circle cx="50" cy="50" r="0.8" fill={GOLD} />
        </svg>
      </motion.div>

      {/* Wordmark — stacked, matches sidebar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, marginBottom: 10 }}
      >
        <span style={{
          fontFamily: 'var(--font-brand, Georgia, serif)',
          fontWeight: 600, fontSize: 28,
          letterSpacing: '6px', textTransform: 'uppercase', color: '#ffffff',
        }}>DOCKS</span>
        <span style={{
          fontFamily: 'var(--font-brand, Georgia, serif)',
          fontWeight: 300, fontSize: 28,
          letterSpacing: '6px', color: GOLD,
        }}>Base</span>
      </motion.div>

      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.0, duration: 0.7 }}
        style={{ fontSize: 12, color: 'rgba(250,248,245,0.35)', letterSpacing: '0.8px' }}
      >
        {name ? `Welcome, ${name}.` : 'Welcome aboard.'}
      </motion.div>

      {/* Click hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.2 }}
        transition={{ delay: 2.5, duration: 0.6 }}
        style={{
          position: 'absolute', bottom: 32,
          fontSize: 10, color: CREAM,
          letterSpacing: '2px', textTransform: 'uppercase',
        }}
      >
        Click to continue
      </motion.div>
    </motion.div>
  );
}
