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

// 8-pointed compass rose
// Tips:   N(r=28), NE(r=11), E(r=20), SE(r=11), S(r=22), SW(r=11), W(r=20), NW(r=11)
// Valleys at 22.5° intervals, r=4
const r = (deg) => deg * Math.PI / 180;
const pt = (angle_deg, radius, cx = 50, cy = 50) =>
  `${(cx + radius * Math.sin(r(angle_deg))).toFixed(2)},${(cy - radius * Math.cos(r(angle_deg))).toFixed(2)}`;

const STAR =
  `M ${pt(0,   28)}` +   // N tip
  `L ${pt(22.5, 4)}` +   // valley N→NE
  `L ${pt(45,  11)}` +   // NE tip
  `L ${pt(67.5, 4)}` +   // valley NE→E
  `L ${pt(90,  20)}` +   // E tip
  `L ${pt(112.5,4)}` +   // valley E→SE
  `L ${pt(135, 11)}` +   // SE tip
  `L ${pt(157.5,4)}` +   // valley SE→S
  `L ${pt(180, 22)}` +   // S tip
  `L ${pt(202.5,4)}` +   // valley S→SW
  `L ${pt(225, 11)}` +   // SW tip
  `L ${pt(247.5,4)}` +   // valley SW→W
  `L ${pt(270, 20)}` +   // W tip
  `L ${pt(292.5,4)}` +   // valley W→NW
  `L ${pt(315, 11)}` +   // NW tip
  `L ${pt(337.5,4)}` +   // valley NW→N
  'Z';

// North arm only — filled gold
const NORTH_ARM =
  `M ${pt(0,   28)}` +
  `L ${pt(22.5, 4)}` +
  `L ${pt(337.5,4)}` +
  'Z';

// Spin and wobble into north: 720 = 0 mod 360
const SPIN_K = [40, 748, 706, 728, 714, 720];
const SPIN_T = [0,  0.50, 0.67, 0.80, 0.91, 1.0];

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

          {/* Inner ring — white, fine */}
          <circle cx="50" cy="50" r="36.5"
            stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.5" fill="none" />

          {/* Compass rose — spins and wobbles into north */}
          <motion.g
            style={{ transformOrigin: '50px 50px' }}
            initial={{ rotate: 40 }}
            animate={{ rotate: SPIN_K }}
            transition={{ times: SPIN_T, duration: 2.8, delay: 0.5, ease: 'easeOut' }}
          >
            {/* Full 8-point star — white outline */}
            <path d={STAR}
              fill="none"
              stroke={CREAM}
              strokeWidth="0.75"
              strokeOpacity="0.9"
              strokeLinejoin="round" />

            {/* North arm — gold filled */}
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

      {/* Wordmark */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        style={{ display: 'flex', alignItems: 'baseline', marginBottom: 10 }}
      >
        <span style={{
          fontFamily: 'var(--font-brand, Georgia, serif)',
          fontWeight: 700, fontSize: 32,
          letterSpacing: '7px', textTransform: 'uppercase', color: CREAM,
        }}>DOCKS</span>
        <span style={{
          fontFamily: 'var(--font-brand, Georgia, serif)',
          fontWeight: 300, fontSize: 32,
          letterSpacing: '7px', color: GOLD,
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
