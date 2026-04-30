import { useState, useRef } from 'react';

// ── Canvas Geometry ──────────────────────────────────────────────────────────
const W = 1100, H = 700, SHORE_Y = 188;
const SLIP_W    = 64;
const SLIP_H    = 40;
const FINGER_H  = 9;
const SLIP_UNIT = SLIP_H + FINGER_H;
const GANGWAY_W = 22;
const PONTOON_W = 20;
const GANGWAY_H = 76;
const PIER_CX   = { A: 200, B: 515, C: 830 };
const PIER_SIDES = { A: 4, B: 4, C: 3 };
const PONTOON_TOP = SHORE_Y + GANGWAY_H;
const SLIP_PAD_PONTOON = 4; // gap between slip box and pontoon face
const SLIP_PAD_EDGE    = 2; // gap on open-water side and top/bottom

function pontoonH(id) { return PIER_SIDES[id] * SLIP_UNIT + FINGER_H + 12; }

// ── Colors ────────────────────────────────────────────────────────────────────
const LAND_FILL    = '#d6cdb8';
const LAND_SHADOW  = '#bfb7a4';
const QUAY_COLOR   = '#8a7d68';
const PIER_FILL    = '#c8b97a';
const PIER_STROKE  = '#a8994a';
const FINGER_FILL  = '#d4c888';
const GANGWAY_FILL = '#c0af72';

const SLIP_COL = {
  occupied:    { fill: '#c6dcf5', stroke: '#3a7fc8', label: '#0a3a70', glow: '#3a7fc8' },
  available:   { fill: '#c2ecce', stroke: '#38a860', label: '#0a4a20', glow: '#38a860' },
  reserved:    { fill: '#f6e7b0', stroke: '#c89020', label: '#6a4800', glow: '#c89020' },
  maintenance: { fill: '#f5cccc', stroke: '#c04040', label: '#780000', glow: '#c04040' },
};

const BUILDINGS = [
  { label: 'Harbormaster', sub: 'Office',        x: 22,  y: 22,  w: 130, h: 90,  color: '#ccc4ae', flag: true },
  { label: 'Fuel Station', sub: null,             x: 198, y: 28,  w: 92,  h: 78,  color: '#ddd4aa', fuel: true },
  { label: 'Chandlery',    sub: '& Marine Shop',  x: 406, y: 28,  w: 108, h: 74,  color: '#cec8b8' },
  { label: 'Parking',      sub: '42 spaces',      x: 568, y: 30,  w: 160, h: 70,  color: '#c0bcb0', parking: true },
  { label: 'Boatyard',     sub: '& Travelift',    x: 836, y: 10,  w: 222, h: 162, color: '#b8b0a0', yard: true },
];

// ── Water Background ──────────────────────────────────────────────────────────
function WaterBg() {
  return (
    <>
      <defs>
        <linearGradient id="hm-waterGrad" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%"   stopColor="#1a4a6a" />
          <stop offset="40%"  stopColor="#0f3a56" />
          <stop offset="100%" stopColor="#081e30" />
        </linearGradient>
        <filter id="hm-waterFx" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="turbulence" baseFrequency="0.012 0.025" numOctaves="4" seed="7" result="turb">
            <animate attributeName="baseFrequency" values="0.012 0.025;0.014 0.028;0.012 0.025" dur="18s" repeatCount="indefinite" />
          </feTurbulence>
          <feColorMatrix in="turb" type="matrix" values="0 0 0 0 0.05  0 0 0 0 0.18  0 0 0 0 0.32  0 0 0 0.18 0" result="colorTurb" />
          <feBlend in="SourceGraphic" in2="colorTurb" mode="screen" />
        </filter>
        <radialGradient id="hm-sparkle" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(180,220,255,0.55)" />
          <stop offset="100%" stopColor="rgba(180,220,255,0)" />
        </radialGradient>
        <pattern id="hm-wavePattern" x="0" y="0" width="160" height="52" patternUnits="userSpaceOnUse">
          <path d="M0 18 Q40 8 80 18 Q120 28 160 18" stroke="rgba(255,255,255,0.045)" strokeWidth="1.5" fill="none" />
          <path d="M0 32 Q40 22 80 32 Q120 42 160 32" stroke="rgba(255,255,255,0.03)" strokeWidth="1" fill="none" />
        </pattern>
      </defs>
      <rect x={0} y={SHORE_Y} width={W} height={H - SHORE_Y} fill="url(#hm-waterGrad)" />
      <rect x={0} y={SHORE_Y} width={W} height={H - SHORE_Y} fill="url(#hm-waterGrad)" filter="url(#hm-waterFx)" opacity={0.6} />
      <g>
        <rect x={0} y={SHORE_Y} width={W} height={H - SHORE_Y} fill="url(#hm-wavePattern)" opacity={1}>
          <animateTransform attributeName="transform" type="translate" from="0 0" to="-160 0" dur="14s" repeatCount="indefinite" />
        </rect>
      </g>
      {[[210,560,60,30],[480,490,50,22],[720,600,70,28],[150,430,40,18],[870,520,55,24],[560,350,45,20]].map(([x,y,rx,ry],i) => (
        <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill="url(#hm-sparkle)" opacity={0.3}>
          <animate attributeName="opacity" values="0.18;0.38;0.18" dur={`${5+i*1.3}s`} repeatCount="indefinite" />
        </ellipse>
      ))}
      <path d={`M 0 ${SHORE_Y+40} Q 300 ${SHORE_Y+30} 600 ${SHORE_Y+42} Q 900 ${SHORE_Y+34} ${W} ${SHORE_Y+38}`} stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" fill="none" />
      <path d={`M 0 ${SHORE_Y+80} Q 250 ${SHORE_Y+70} 550 ${SHORE_Y+82} Q 850 ${SHORE_Y+72} ${W} ${SHORE_Y+76}`} stroke="rgba(255,255,255,0.035)" strokeWidth="1" fill="none" />
    </>
  );
}

// ── Land / Shore ──────────────────────────────────────────────────────────────
function LandArea() {
  return (
    <>
      <rect x={0} y={0} width={W} height={SHORE_Y} fill={LAND_FILL} />
      <defs>
        <pattern id="hm-landHatch" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="18" stroke="rgba(0,0,0,0.03)" strokeWidth="4" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={SHORE_Y} fill="url(#hm-landHatch)" />
      <rect x={0} y={SHORE_Y-10} width={W} height={10} fill={LAND_SHADOW} opacity={0.7} />
      <rect x={0} y={SHORE_Y-3} width={W} height={6} fill={QUAY_COLOR} />
      {[60,110,290,360,470,640,750,960,1040].map((bx,i) => (
        <circle key={i} cx={bx} cy={SHORE_Y} r={5} fill="#7a6e5a" stroke="#5a5040" strokeWidth={1.2} />
      ))}
      <polygon points={`${W-68},${SHORE_Y} ${W-30},${SHORE_Y} ${W-18},${SHORE_Y+90} ${W-80},${SHORE_Y+90}`} fill="#c8c0aa" stroke={QUAY_COLOR} strokeWidth={1.5} />
      <text x={W-49} y={SHORE_Y+52} textAnchor="middle" fontSize={8.5} fontWeight="600" fill="rgba(0,0,0,0.4)" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">RAMP</text>
      <line x1={1080} y1={SHORE_Y+10} x2={1080} y2={H-20} stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" strokeDasharray="8 8" />
      <text x={1088} y={SHORE_Y+28} fontSize={7.5} fill="rgba(255,255,255,0.25)" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">CHANNEL</text>
      {[[1080,SHORE_Y+60],[1080,SHORE_Y+180]].map(([bx,by],i) => (
        <g key={i}>
          <circle cx={bx} cy={by} r={6} fill={i%2===0?'#22cc66':'#dd3322'} stroke="white" strokeWidth={1.5} />
          <line x1={bx} y1={by-6} x2={bx} y2={by-18} stroke="white" strokeWidth={1.5} />
        </g>
      ))}
    </>
  );
}

// ── Shore Buildings ───────────────────────────────────────────────────────────
function Building({ b }) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return (
    <g>
      {/* Drop shadow */}
      <rect x={b.x+6} y={b.y+6} width={b.w} height={b.h} fill="rgba(0,0,0,0.16)" rx={5} />
      {/* Body */}
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.color} stroke="rgba(0,0,0,0.22)" strokeWidth={1.5} rx={4} />
      {/* Roof band */}
      <rect x={b.x+1} y={b.y+1} width={b.w-2} height={13} fill="rgba(0,0,0,0.12)" rx={3} />
      {/* Roof ridge */}
      <line x1={b.x+12} y1={b.y+1.5} x2={b.x+b.w-12} y2={b.y+1.5} stroke="rgba(0,0,0,0.14)" strokeWidth={1.5} />
      {/* Highlight */}
      <rect x={b.x+1} y={b.y+1} width={b.w-2} height={Math.floor(b.h*0.42)} fill="rgba(255,255,255,0.09)" rx={3} style={{ pointerEvents: 'none' }} />

      {/* ── Harbormaster: windows + flag ── */}
      {b.flag && <>
        {[b.x+12, b.x+34, b.x+58].map((wx, i) => (
          <g key={i}>
            <rect x={wx} y={b.y+22} width={15} height={17} fill="rgba(150,200,255,0.5)" stroke="rgba(0,0,0,0.18)" strokeWidth={1} rx={1} />
            <line x1={wx+7} y1={b.y+22} x2={wx+7} y2={b.y+39} stroke="rgba(0,0,0,0.16)" strokeWidth={0.8} />
            <line x1={wx} y1={b.y+30} x2={wx+15} y2={b.y+30} stroke="rgba(0,0,0,0.16)" strokeWidth={0.8} />
          </g>
        ))}
        <rect x={cx-5} y={b.y+b.h-20} width={11} height={18} fill="rgba(0,0,0,0.24)" rx={1} />
        <line x1={b.x+b.w-10} y1={b.y-30} x2={b.x+b.w-10} y2={b.y+2} stroke="#8a7a62" strokeWidth={1.5} />
        <polygon points={`${b.x+b.w-10},${b.y-29} ${b.x+b.w+9},${b.y-22} ${b.x+b.w-10},${b.y-14}`} fill="#b8965a" />
        <circle cx={b.x+b.w-10} cy={b.y-30} r={2} fill="#c0a060" />
      </>}

      {/* ── Fuel Station: drop icon ── */}
      {b.fuel && (() => {
        const sz = Math.min(b.w * 0.44, b.h * 0.52, 30);
        const sc = sz / 24;
        return (
          <g transform={`translate(${cx - sz/2},${b.y + 14}) scale(${sc})`} style={{ pointerEvents: 'none' }}>
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"
              fill="rgba(0,0,0,0.1)" stroke="rgba(0,0,0,0.22)"
              strokeWidth={1.8/sc} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })()}

      {/* ── Parking: grid lines + P marker ── */}
      {b.parking && <>
        <text x={b.x+10} y={b.y+24} fontSize={18} fontWeight="900" fill="rgba(255,255,255,0.35)" fontFamily="IBM Plex Sans, sans-serif">P</text>
        {[0,1,2,3].flatMap(row => [0,1,2,3,4].map(col => (
          <rect key={`${row}-${col}`} x={b.x+36+col*22} y={b.y+18+row*12} width={14} height={9} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.8} rx={1} />
        )))}
        <polygon points={`${b.x+b.w/2-5},${b.y+b.h-7} ${b.x+b.w/2+5},${b.y+b.h-7} ${b.x+b.w/2},${b.y+b.h-2}`} fill="rgba(255,255,255,0.2)" />
      </>}

      {/* ── Boatyard: package / storage icon ── */}
      {b.yard && (() => {
        const sz = Math.min(b.w * 0.32, b.h * 0.35, 42);
        const sc = sz / 24;
        return (
          <g transform={`translate(${cx - sz/2},${b.y + 22}) scale(${sc})`} style={{ pointerEvents: 'none' }}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
              fill="rgba(0,0,0,0.08)" stroke="rgba(0,0,0,0.22)"
              strokeWidth={1.8/sc} strokeLinejoin="round" />
            <line x1="3.27" y1="6.96" x2="12" y2="12.01" stroke="rgba(0,0,0,0.22)" strokeWidth={1.8/sc} />
            <line x1="12" y1="22.08" x2="12" y2="12" stroke="rgba(0,0,0,0.22)" strokeWidth={1.8/sc} />
          </g>
        );
      })()}

      {/* ── Default (Chandlery): storefront windows ── */}
      {!b.flag && !b.fuel && !b.parking && !b.yard && <>
        {[b.x+10, b.x+32, b.x+54, b.x+76].filter(wx => wx + 15 < b.x + b.w - 4).map((wx, i) => (
          <g key={i}>
            <rect x={wx} y={b.y+20} width={15} height={18} fill="rgba(150,200,255,0.42)" stroke="rgba(0,0,0,0.14)" strokeWidth={1} rx={1} />
            <line x1={wx+7} y1={b.y+20} x2={wx+7} y2={b.y+38} stroke="rgba(0,0,0,0.13)" strokeWidth={0.7} />
          </g>
        ))}
        <rect x={cx-5} y={b.y+b.h-20} width={11} height={18} fill="rgba(0,0,0,0.2)" rx={1} />
      </>}

      {/* Label */}
      <text x={cx} y={(b.fuel || b.yard) ? b.y + b.h - 11 : (b.sub ? cy-5 : cy+2)} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fontWeight="700" fill="rgba(0,0,0,0.65)" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.3">
        {b.label.toUpperCase()}
      </text>
      {b.sub && !b.fuel && !b.yard && (
        <text x={cx} y={cy+8} textAnchor="middle" dominantBaseline="middle" fontSize={7.5} fontWeight="400" fill="rgba(0,0,0,0.38)" fontFamily="IBM Plex Sans, sans-serif">
          {b.sub}
        </text>
      )}
    </g>
  );
}

// ── Single Pier ───────────────────────────────────────────────────────────────
function PierDock({ pierId, slips, slipsPerSide, selectedId, onSelect }) {
  const cx = PIER_CX[pierId];
  const pontoonX = cx - PONTOON_W / 2;
  const ph = pontoonH(pierId);
  const westSlips = slips.slice(0, slipsPerSide);
  const eastSlips = slips.slice(slipsPerSide);
  const fingerYs = Array.from({ length: slipsPerSide + 1 }, (_, i) => PONTOON_TOP + 8 + i * SLIP_UNIT);

  function SlipCell({ slip, side }) {
    if (!slip) return null;
    const col = SLIP_COL[slip.status] || SLIP_COL.available;
    const isSel = slip.id === selectedId;

    const idx = side === 'west' ? westSlips.indexOf(slip) : eastSlips.indexOf(slip);
    const baseY = PONTOON_TOP + 8 + FINGER_H + idx * SLIP_UNIT;

    // west: pontoon is on RIGHT side → gap on right, edge gap on left
    // east: pontoon is on LEFT side → gap on left, edge gap on right
    const rx = side === 'west'
      ? cx - PONTOON_W/2 - SLIP_W + SLIP_PAD_EDGE
      : cx + PONTOON_W/2 + SLIP_PAD_PONTOON;
    const rw = SLIP_W - SLIP_PAD_EDGE - SLIP_PAD_PONTOON;
    const ry = baseY + SLIP_PAD_EDGE;
    const rh = SLIP_H - SLIP_PAD_EDGE * 2;
    const textX = rx + rw / 2;
    const vesselText = slip.vessel ? (slip.vessel.length > 9 ? slip.vessel.slice(0,8)+'…' : slip.vessel) : '';

    return (
      <g onClick={() => onSelect(slip)} style={{ cursor: 'pointer' }}>
        {isSel && (
          <rect x={rx-3} y={ry-3} width={rw+6} height={rh+6} fill="none" stroke="#b8965a" strokeWidth={2.5} rx={5}
                style={{ filter: 'drop-shadow(0 0 6px rgba(184,150,90,0.85))' }} />
        )}
        <rect
          x={rx} y={ry} width={rw} height={rh}
          fill={col.fill} stroke={isSel ? '#b8965a' : col.stroke}
          strokeWidth={1.5} rx={3}
          style={{ filter: `drop-shadow(0 0 ${isSel ? 7 : 3.5}px ${col.glow}99)` }}
        />
        {/* Gloss overlay */}
        <rect x={rx+1} y={ry+1} width={rw-2} height={Math.floor(rh*0.45)} fill="rgba(255,255,255,0.18)" rx={2} style={{ pointerEvents: 'none' }} />
        <text x={textX} y={ry+12} textAnchor="middle" dominantBaseline="middle" fontSize={8.5} fontWeight="700" fill={col.label} fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.3">{slip.id}</text>
        {vesselText && <text x={textX} y={ry+23} textAnchor="middle" dominantBaseline="middle" fontSize={7} fontWeight="500" fill={col.label} fontFamily="IBM Plex Sans, sans-serif" opacity={0.78}>{vesselText}</text>}
        <text x={textX} y={ry+rh-4} textAnchor="middle" dominantBaseline="middle" fontSize={6.5} fill={col.label} fontFamily="IBM Plex Sans, sans-serif" opacity={0.5}>{slip.len}</text>
      </g>
    );
  }

  return (
    <g>
      {/* Gangway from shore */}
      <rect x={cx-GANGWAY_W/2} y={SHORE_Y-3} width={GANGWAY_W} height={GANGWAY_H+6} fill={GANGWAY_FILL} stroke={PIER_STROKE} strokeWidth={1.5} />
      {[0.25,0.5,0.75].map(t => (
        <line key={t} x1={cx-GANGWAY_W/2+3} y1={SHORE_Y+GANGWAY_H*t} x2={cx+GANGWAY_W/2-3} y2={SHORE_Y+GANGWAY_H*t} stroke={PIER_STROKE} strokeWidth={1.2} opacity={0.45} />
      ))}
      {/* Main pontoon spine */}
      <rect x={pontoonX} y={PONTOON_TOP} width={PONTOON_W} height={ph} fill={PIER_FILL} stroke={PIER_STROKE} strokeWidth={1.5} rx={2} />
      <text x={cx} y={PONTOON_TOP+ph/2} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight="700" fill="#7a6820" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="2" transform={`rotate(-90, ${cx}, ${PONTOON_TOP+ph/2})`}>PIER {pierId}</text>
      {/* Finger piers */}
      {fingerYs.map((fy,i) => (
        <rect key={`fw-${i}`} x={cx-PONTOON_W/2-SLIP_W} y={fy} width={SLIP_W} height={FINGER_H} fill={FINGER_FILL} stroke={PIER_STROKE} strokeWidth={1} />
      ))}
      {fingerYs.map((fy,i) => (
        <rect key={`fe-${i}`} x={cx+PONTOON_W/2} y={fy} width={SLIP_W} height={FINGER_H} fill={FINGER_FILL} stroke={PIER_STROKE} strokeWidth={1} />
      ))}
      {/* Slip cells */}
      {westSlips.map(slip => <SlipCell key={slip.id} slip={slip} side="west" />)}
      {eastSlips.map(slip => <SlipCell key={slip.id} slip={slip} side="east" />)}
      {/* End cap */}
      <rect x={pontoonX-5} y={PONTOON_TOP+ph-7} width={PONTOON_W+10} height={9} fill={PIER_FILL} stroke={PIER_STROKE} strokeWidth={1.5} rx={2} />
      {/* Fenders */}
      {[PONTOON_TOP+ph*0.3, PONTOON_TOP+ph*0.7].map((fy,i) => (
        <g key={i}>
          <ellipse cx={pontoonX-4} cy={fy} rx={4} ry={5} fill="#6a6050" opacity={0.65} />
          <ellipse cx={pontoonX+PONTOON_W+4} cy={fy} rx={4} ry={5} fill="#6a6050" opacity={0.65} />
        </g>
      ))}
    </g>
  );
}

// ── Compass Rose ──────────────────────────────────────────────────────────────
function CompassRose({ x, y, r = 34 }) {
  const arrow = (deg, len) => {
    const rad = (deg - 90) * Math.PI / 180;
    const tip = [x + len * Math.cos(rad), y + len * Math.sin(rad)];
    const side1 = [x + 6 * Math.cos(rad + Math.PI/2), y + 6 * Math.sin(rad + Math.PI/2)];
    const side2 = [x + 6 * Math.cos(rad - Math.PI/2), y + 6 * Math.sin(rad - Math.PI/2)];
    const base = [x + (len*0.3) * Math.cos(rad), y + (len*0.3) * Math.sin(rad)];
    return `M ${tip[0]} ${tip[1]} L ${side1[0]} ${side1[1]} L ${base[0]} ${base[1]} L ${side2[0]} ${side2[1]} Z`;
  };
  const cardLabels = [
    { deg: 0,   label: 'N', dx: 0,      dy: -r-10 },
    { deg: 90,  label: 'E', dx: r+10,   dy: 4 },
    { deg: 180, label: 'S', dx: 0,      dy: r+16 },
    { deg: 270, label: 'W', dx: -r-12,  dy: 4 },
  ];
  return (
    <g>
      <circle cx={x} cy={y} r={r+14} fill="rgba(10,30,50,0.55)" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      <circle cx={x} cy={y} r={r+3} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.8} />
      {[45,135,225,315].map(deg => {
        const rad = (deg-90)*Math.PI/180;
        return <line key={deg} x1={x+(r-5)*Math.cos(rad)} y1={y+(r-5)*Math.sin(rad)} x2={x+(r+2)*Math.cos(rad)} y2={y+(r+2)*Math.sin(rad)} stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} />;
      })}
      <path d={arrow(0,   r)} fill="rgba(255,255,255,0.9)" />
      <path d={arrow(180, r)} fill="rgba(255,255,255,0.35)" />
      <path d={arrow(90,  r)} fill="rgba(255,255,255,0.35)" />
      <path d={arrow(270, r)} fill="rgba(255,255,255,0.35)" />
      <path d={arrow(0,   r)} fill="#b8965a" opacity={0.9} />
      <circle cx={x} cy={y} r={5} fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
      {cardLabels.map(({ label, dx, dy }) => (
        <text key={label} x={x+dx} y={y+dy} textAnchor="middle" dominantBaseline="middle"
          fontSize={label==='N'?11:9.5} fontWeight={label==='N'?'700':'600'}
          fill={label==='N'?'#b8965a':'rgba(255,255,255,0.65)'}
          fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">
          {label}
        </text>
      ))}
    </g>
  );
}

// ── Scale Bar ─────────────────────────────────────────────────────────────────
function ScaleBar({ x, y }) {
  return (
    <g>
      <rect x={x} y={y} width={120} height={6} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
      <rect x={x} y={y} width={60} height={6} fill="rgba(255,255,255,0.35)" />
      <text x={x} y={y+16} fontSize={8} fill="rgba(255,255,255,0.5)" fontFamily="IBM Plex Sans, sans-serif">0</text>
      <text x={x+57} y={y+16} fontSize={8} fill="rgba(255,255,255,0.5)" fontFamily="IBM Plex Sans, sans-serif" textAnchor="middle">50m</text>
      <text x={x+120} y={y+16} fontSize={8} fill="rgba(255,255,255,0.5)" fontFamily="IBM Plex Sans, sans-serif" textAnchor="end">100m</text>
    </g>
  );
}

// ── Depth Labels ──────────────────────────────────────────────────────────────
function DepthLabels() {
  const labels = [
    { x: 90,  y: 560, d: '3.2m' }, { x: 380, y: 520, d: '3.8m' },
    { x: 650, y: 580, d: '3.5m' }, { x: 920, y: 540, d: '4.0m' },
    { x: 200, y: 460, d: '2.8m' }, { x: 500, y: 440, d: '3.1m' },
  ];
  return (
    <g opacity={0.45}>
      {labels.map((l,i) => (
        <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize={8.5} fill="rgba(180,220,255,0.7)" fontFamily="IBM Plex Sans, sans-serif" fontStyle="italic">{l.d}</text>
      ))}
    </g>
  );
}

// ── Marina Label ──────────────────────────────────────────────────────────────
function MarinaLabel() {
  return (
    <g>
      <text x={20} y={H-18} fontSize={11} fontWeight="700" fill="rgba(255,255,255,0.25)" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="2">HARWICH MARINA · HARBOR MAP</text>
      <text x={20} y={H-6} fontSize={8} fill="rgba(255,255,255,0.15)" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">Chart ref. HM-2026 · Not for navigation</text>
    </g>
  );
}

// ── Main HarborMap Component ──────────────────────────────────────────────────
export default function HarborMap({ piers = [], selectedSlip, onSelectSlip }) {
  const svgRef = useRef(null);
  const piersById = {};
  piers.forEach(p => { piersById[p.id] = p; });

  function handleSelect(slip) {
    onSelectSlip && onSelectSlip(slip && slip.id === selectedSlip?.id ? null : slip);
  }

  return (
    <div style={{ background: '#081e30', borderRadius: 10, overflow: 'hidden', position: 'relative', boxShadow: '0 4px 32px rgba(0,0,0,0.3)' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <LandArea />
        <WaterBg />
        <DepthLabels />
        {BUILDINGS.map(b => <Building key={b.label} b={b} />)}
        {[
          { id: 'A', spSide: PIER_SIDES.A },
          { id: 'B', spSide: PIER_SIDES.B },
          { id: 'C', spSide: PIER_SIDES.C },
        ].map(({ id, spSide }) => {
          const pier = piersById[id];
          if (!pier) return null;
          return <PierDock key={id} pierId={id} slips={pier.slips} slipsPerSide={spSide} selectedId={selectedSlip?.id} onSelect={handleSelect} />;
        })}
        <g>
          <polyline points={`1062,${SHORE_Y} 1072,${SHORE_Y+120} 1068,${SHORE_Y+260} 1075,${SHORE_Y+400}`} fill="none" stroke="#6a7a5a" strokeWidth={8} strokeLinecap="round" />
          <polyline points={`1062,${SHORE_Y} 1072,${SHORE_Y+120} 1068,${SHORE_Y+260} 1075,${SHORE_Y+400}`} fill="none" stroke="#8a9a7a" strokeWidth={4} strokeLinecap="round" opacity={0.5} />
          <text x={1044} y={SHORE_Y+150} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.25)" fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5" transform={`rotate(-90, 1044, ${SHORE_Y+150})`}>BREAKWATER</text>
        </g>
        <CompassRose x={1042} y={H-68} r={30} />
        <ScaleBar x={20} y={H-52} />
        <MarinaLabel />
      </svg>
    </div>
  );
}
