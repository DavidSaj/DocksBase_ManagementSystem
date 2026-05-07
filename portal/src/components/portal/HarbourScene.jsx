import { motion } from 'framer-motion';

const CREAM = '#f5f0e6';
const GOLD  = '#b8965a';
const PILINGS = [72, 136, 200, 264];

export function HarbourScene({ opacity = 1 }) {
  return (
    <svg
      style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 180, pointerEvents: 'none', opacity }}
      viewBox="0 0 1440 180"
      preserveAspectRatio="xMidYMax slice"
      fill="none"
    >
      {/* Horizon */}
      <line x1="0" y1="108" x2="1440" y2="108" stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.15" />
      <rect x="0" y="108" width="1440" height="72" fill={CREAM} fillOpacity="0.015" />

      {/* Waves */}
      <path d="M 0,118 C 240,111 480,125 720,118 C 960,111 1200,125 1440,118"
        stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.10" />
      <path d="M 0,136 C 200,126 450,146 720,136 C 990,126 1240,146 1440,136"
        stroke={CREAM} strokeWidth="1.0" strokeOpacity="0.11" />
      <path d="M -20,158 C 180,146 410,170 680,158 C 950,146 1180,170 1440,158"
        stroke={CREAM} strokeWidth="1.1" strokeOpacity="0.09" />

      {/* Gold water glints */}
      <line x1="480"  y1="124" x2="514"  y2="124" stroke={GOLD} strokeWidth="0.8" strokeOpacity="0.18" />
      <line x1="492"  y1="130" x2="506"  y2="130" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.11" />
      <line x1="760"  y1="141" x2="796"  y2="141" stroke={GOLD} strokeWidth="0.7" strokeOpacity="0.14" />
      <line x1="1080" y1="130" x2="1112" y2="130" stroke={GOLD} strokeWidth="0.7" strokeOpacity="0.14" />
      <line x1="1220" y1="152" x2="1250" y2="152" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.10" />

      {/* Dock */}
      <rect x="0" y="96" width="310" height="12" fill={CREAM} fillOpacity="0.05" />
      <line x1="0" y1="96"  x2="310" y2="96"  stroke={CREAM} strokeWidth="1.6" strokeOpacity="0.20" />
      <line x1="0" y1="108" x2="310" y2="108" stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.13" />
      <line x1="0" y1="100" x2="310" y2="100" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.07" />
      <line x1="0" y1="104" x2="310" y2="104" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.06" />
      {PILINGS.map(x => (
        <rect key={x} x={x - 3} y="108" width="7" height="52" rx="2" fill={CREAM} fillOpacity="0.12" />
      ))}
      {PILINGS.slice(0, -1).map((x, i) => {
        const nx = PILINGS[i + 1];
        return (
          <g key={x}>
            <line x1={x}  y1="110" x2={nx} y2="142" stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.07" />
            <line x1={nx} y1="110" x2={x}  y2="142" stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.07" />
          </g>
        );
      })}
      {PILINGS.map(x => (
        <rect key={x} x={x - 5} y="89" width="10" height="7" rx="1.5" fill={CREAM} fillOpacity="0.16" />
      ))}

      {/* Main sailboat */}
      <motion.g
        animate={{ y: [0, -5, 1, -3, 0] }}
        transition={{ duration: 5.4, repeat: Infinity, ease: 'easeInOut', times: [0, 0.28, 0.52, 0.74, 1] }}
      >
        <path d="M 780,108 L 783,116 Q 836,121 896,115 L 900,108 L 892,102 L 781,102 Z"
          fill={CREAM} fillOpacity="0.16" stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.20" />
        <path d="M 812,102 L 864,102 L 864,96 Q 848,93 834,93 Q 818,93 812,95 Z"
          fill={CREAM} fillOpacity="0.12" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.14" />
        <line x1="836" y1="102" x2="836" y2="18" stroke={CREAM} strokeWidth="1.3" strokeOpacity="0.22" />
        <path d="M 836,18 L 836,102 L 900,110 Z"
          fill={CREAM} fillOpacity="0.11" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.15" />
        <path d="M 836,18 L 898,107 L 836,102 Z"
          fill={CREAM} fillOpacity="0.07" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.11" />
        <line x1="836" y1="102" x2="900" y2="110" stroke={CREAM} strokeWidth="0.8" strokeOpacity="0.14" />
      </motion.g>

      {/* Mid-distance sailboat */}
      <motion.g
        animate={{ y: [0, -3, 0.8, -2, 0] }}
        transition={{ duration: 7.0, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
        opacity="0.65"
      >
        <path d="M 540,106 L 541,112 Q 568,116 600,112 L 602,106 L 598,103 L 542,103 Z"
          fill={CREAM} fillOpacity="0.13" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.16" />
        <line x1="564" y1="103" x2="564" y2="72" stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.17" />
        <path d="M 564,72 L 564,103 L 601,108 Z"
          fill={CREAM} fillOpacity="0.07" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.11" />
      </motion.g>

      {/* Far sailboat */}
      <motion.g
        animate={{ y: [0, -2, 0.5, -1.5, 0] }}
        transition={{ duration: 8.2, repeat: Infinity, ease: 'easeInOut', delay: 3.2 }}
        opacity="0.40"
      >
        <path d="M 1160,107 L 1161,112 Q 1182,115 1208,112 L 1210,107 L 1206,104 L 1162,104 Z"
          fill={CREAM} fillOpacity="0.10" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.13" />
        <line x1="1178" y1="104" x2="1178" y2="80" stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.14" />
        <path d="M 1178,80 L 1178,104 L 1208,108 Z"
          fill={CREAM} fillOpacity="0.06" stroke={CREAM} strokeWidth="0.3" strokeOpacity="0.09" />
      </motion.g>
    </svg>
  );
}

export function WaveLines() {
  return (
    <svg
      viewBox="0 0 880 160"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      fill="none"
    >
      <path d="M 0,20 C 110,13 220,27 330,20 C 440,13 550,27 660,20 C 770,13 880,27 880,20"
        stroke="#0c1f3d" strokeWidth="1.2" strokeOpacity="0.07" />
      <path d="M 0,55 C 90,48 200,62 330,55 C 460,48 580,62 700,55 C 800,48 880,62 880,55"
        stroke="#0c1f3d" strokeWidth="1.0" strokeOpacity="0.055" />
      <path d="M 0,92 C 120,86 250,98 400,92 C 550,86 680,98 820,92 C 855,89 880,93 880,92"
        stroke="#b8965a" strokeWidth="0.9" strokeOpacity="0.09" />
      <path d="M 0,128 C 140,122 290,134 440,128 C 590,122 740,134 880,128"
        stroke="#0c1f3d" strokeWidth="0.8" strokeOpacity="0.05" />
    </svg>
  );
}
