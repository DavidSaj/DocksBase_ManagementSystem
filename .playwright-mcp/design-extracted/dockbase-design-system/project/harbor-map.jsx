// harbor-map.jsx
// DockBase — Harbor Map Component
// Exports: window.HarborMap

(function () {
  const { useState, useEffect, useRef } = React;

  // ─── Canvas Geometry ────────────────────────────────────────────────────────
  const W = 1100, H = 700, SHORE_Y = 188;

  // Slip / finger dimensions
  const SLIP_W   = 64;  // width of slip pocket (east–west)
  const SLIP_H   = 40;  // height of slip pocket (north–south)
  const FINGER_H = 9;   // thickness of finger dock
  const SLIP_UNIT = SLIP_H + FINGER_H; // 49 px per row
  const GANGWAY_W = 14;
  const PONTOON_W = 14;
  const GANGWAY_H = 60;

  // Pier anchor X values (centre of pontoon)
  const PIER_CX = { A: 200, B: 515, C: 830 };

  // Slips per side (west / east of pontoon)
  const PIER_SIDES = { A: 4, B: 4, C: 3 };

  // Derived: pontoon top Y and bottom Y
  const PONTOON_TOP = SHORE_Y + GANGWAY_H;
  function pontoonH(id) { return PIER_SIDES[id] * SLIP_UNIT + FINGER_H + 12; }

  // ─── Colors ─────────────────────────────────────────────────────────────────
  const WATER_DEEP   = '#0a2e48';
  const WATER_MID    = '#0f3d5c';
  const LAND_FILL    = '#d6cdb8';
  const LAND_SHADOW  = '#bfb7a4';
  const QUAY_COLOR   = '#8a7d68';
  const PIER_FILL    = '#c8b97a';
  const PIER_STROKE  = '#a8994a';
  const FINGER_FILL  = '#d4c888';
  const GANGWAY_FILL = '#c0af72';

  const SLIP_COL = {
    occupied:    { fill: '#c6dcf5', stroke: '#3a7fc8', label: '#0a3a70' },
    available:   { fill: '#c2ecce', stroke: '#38a860', label: '#0a4a20' },
    reserved:    { fill: '#f6e7b0', stroke: '#c89020', label: '#6a4800' },
    maintenance: { fill: '#f5cccc', stroke: '#c04040', label: '#780000' },
  };

  // ─── Buildings Data ─────────────────────────────────────────────────────────
  const BUILDINGS = [
    { label: 'Harbormaster',  sub: 'Office',       x: 22,  y: 22,  w: 128, h: 88,  color: '#ccc4ae', flag: true },
    { label: 'Fuel Station',  sub: null,            x: 195, y: 28,  w: 90,  h: 76,  color: '#ddd4aa', fuel: true },
    { label: 'Chandlery',     sub: '& Marine Shop', x: 404, y: 28,  w: 106, h: 72,  color: '#cec8b8' },
    { label: 'Parking',       sub: '42 spaces',     x: 566, y: 30,  w: 158, h: 68,  color: '#c0bcb0', parking: true },
    { label: 'Boatyard',      sub: '& Travelift',   x: 836, y: 10,  w: 220, h: 158, color: '#b8b0a0', yard: true },
  ];

  // ─── Water Background ────────────────────────────────────────────────────────
  function WaterBg() {
    return (
      <>
        <defs>
          <linearGradient id="hm-waterGrad" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%"   stopColor="#1a4a6a" />
            <stop offset="40%"  stopColor="#0f3a56" />
            <stop offset="100%" stopColor="#081e30" />
          </linearGradient>

          {/* Subtle turbulence texture */}
          <filter id="hm-waterFx" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.012 0.025" numOctaves="4" seed="7" result="turb">
              <animate attributeName="baseFrequency"
                values="0.012 0.025;0.014 0.028;0.012 0.025"
                dur="18s" repeatCount="indefinite" />
            </feTurbulence>
            <feColorMatrix in="turb" type="matrix"
              values="0 0 0 0 0.05  0 0 0 0 0.18  0 0 0 0 0.32  0 0 0 0.18 0"
              result="colorTurb" />
            <feBlend in="SourceGraphic" in2="colorTurb" mode="screen" />
          </filter>

          {/* Sparkle / reflection highlights */}
          <radialGradient id="hm-sparkle" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="rgba(180,220,255,0.55)" />
            <stop offset="100%" stopColor="rgba(180,220,255,0)" />
          </radialGradient>

          <pattern id="hm-wavePattern" x="0" y="0" width="160" height="52" patternUnits="userSpaceOnUse">
            <path d="M0 18 Q40 8 80 18 Q120 28 160 18" stroke="rgba(255,255,255,0.045)" strokeWidth="1.5" fill="none" />
            <path d="M0 32 Q40 22 80 32 Q120 42 160 32" stroke="rgba(255,255,255,0.03)" strokeWidth="1" fill="none" />
          </pattern>
        </defs>

        {/* Base gradient fill */}
        <rect x={0} y={SHORE_Y} width={W} height={H - SHORE_Y}
          fill="url(#hm-waterGrad)" />

        {/* Texture overlay */}
        <rect x={0} y={SHORE_Y} width={W} height={H - SHORE_Y}
          fill="url(#hm-waterGrad)" filter="url(#hm-waterFx)" opacity={0.6} />

        {/* Animated wave lines */}
        <g>
          <rect x={0} y={SHORE_Y} width={W} height={H - SHORE_Y}
            fill="url(#hm-wavePattern)" opacity={1}>
            <animateTransform attributeName="transform" type="translate"
              from="0 0" to="-160 0" dur="14s" repeatCount="indefinite" />
          </rect>
        </g>

        {/* Sparkle reflections */}
        {[[210, 560, 60, 30], [480, 490, 50, 22], [720, 600, 70, 28],
          [150, 430, 40, 18], [870, 520, 55, 24], [560, 350, 45, 20]].map(([x,y,rx,ry], i) => (
          <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry}
            fill="url(#hm-sparkle)" opacity={0.3}>
            <animate attributeName="opacity"
              values="0.18;0.38;0.18" dur={`${5 + i * 1.3}s`}
              repeatCount="indefinite" />
          </ellipse>
        ))}

        {/* Depth lines near shore */}
        <path d={`M 0 ${SHORE_Y + 40} Q 300 ${SHORE_Y + 30} 600 ${SHORE_Y + 42} Q 900 ${SHORE_Y + 34} ${W} ${SHORE_Y + 38}`}
          stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" fill="none" />
        <path d={`M 0 ${SHORE_Y + 80} Q 250 ${SHORE_Y + 70} 550 ${SHORE_Y + 82} Q 850 ${SHORE_Y + 72} ${W} ${SHORE_Y + 76}`}
          stroke="rgba(255,255,255,0.035)" strokeWidth="1" fill="none" />
      </>
    );
  }

  // ─── Land / Shore ────────────────────────────────────────────────────────────
  function LandArea() {
    return (
      <>
        {/* Land fill */}
        <rect x={0} y={0} width={W} height={SHORE_Y} fill={LAND_FILL} />

        {/* Subtle land hatching for texture */}
        <defs>
          <pattern id="hm-landHatch" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="18" stroke="rgba(0,0,0,0.03)" strokeWidth="4" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={W} height={SHORE_Y} fill="url(#hm-landHatch)" />

        {/* Quay shadow strip */}
        <rect x={0} y={SHORE_Y - 10} width={W} height={10} fill={LAND_SHADOW} opacity={0.7} />

        {/* Quay wall edge */}
        <rect x={0} y={SHORE_Y - 3} width={W} height={6}
          fill={QUAY_COLOR} />

        {/* Bollards along quay */}
        {[60, 110, 290, 360, 470, 640, 750, 960, 1040].map((bx, i) => (
          <circle key={i} cx={bx} cy={SHORE_Y} r={5}
            fill="#7a6e5a" stroke="#5a5040" strokeWidth={1.2} />
        ))}

        {/* Slipway / boat ramp (right side) */}
        <polygon
          points={`${W - 68},${SHORE_Y} ${W - 30},${SHORE_Y} ${W - 18},${SHORE_Y + 90} ${W - 80},${SHORE_Y + 90}`}
          fill="#c8c0aa" stroke={QUAY_COLOR} strokeWidth={1.5} />
        <text x={W - 49} y={SHORE_Y + 52} textAnchor="middle"
          fontSize={8.5} fontWeight="600" fill="rgba(0,0,0,0.4)"
          fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">
          RAMP
        </text>

        {/* Navigation channel markers */}
        <line x1={1080} y1={SHORE_Y + 10} x2={1080} y2={H - 20}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" strokeDasharray="8 8" />
        <text x={1088} y={SHORE_Y + 28} fontSize={7.5} fill="rgba(255,255,255,0.25)"
          fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">CHANNEL</text>

        {/* Buoys */}
        {[[1080, SHORE_Y + 60], [1080, SHORE_Y + 180]].map(([bx, by], i) => (
          <g key={i}>
            <circle cx={bx} cy={by} r={6} fill={i % 2 === 0 ? '#22cc66' : '#dd3322'} stroke="white" strokeWidth={1.5} />
            <line x1={bx} y1={by - 6} x2={bx} y2={by - 18} stroke="white" strokeWidth={1.5} />
          </g>
        ))}
      </>
    );
  }

  // ─── Shore Buildings ─────────────────────────────────────────────────────────
  function Building({ b }) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return (
      <g>
        {/* Shadow */}
        <rect x={b.x + 3} y={b.y + 3} width={b.w} height={b.h}
          fill="rgba(0,0,0,0.08)" rx={3} />

        {/* Body */}
        <rect x={b.x} y={b.y} width={b.w} height={b.h}
          fill={b.color} stroke="rgba(0,0,0,0.18)" strokeWidth={1.2} rx={3} />

        {/* Roof line */}
        <rect x={b.x} y={b.y} width={b.w} height={7}
          fill="rgba(0,0,0,0.08)" rx="3 3 0 0" />

        {/* Flag (Harbormaster) */}
        {b.flag && (
          <g>
            <line x1={b.x + b.w - 12} y1={b.y - 22} x2={b.x + b.w - 12} y2={b.y}
              stroke="rgba(0,0,0,0.35)" strokeWidth={1.2} />
            <polygon
              points={`${b.x + b.w - 12},${b.y - 22} ${b.x + b.w + 4},${b.y - 16} ${b.x + b.w - 12},${b.y - 10}`}
              fill="#b8965a" />
          </g>
        )}

        {/* Fuel pumps */}
        {b.fuel && (
          <g>
            {[b.x + 14, b.x + 34, b.x + 54].map((px, i) => (
              <g key={i}>
                <rect x={px} y={b.y + b.h - 22} width={10} height={18}
                  fill="#e8c050" stroke="rgba(0,0,0,0.2)" strokeWidth={1} rx={2} />
                <rect x={px + 2} y={b.y + b.h - 26} width={6} height={6}
                  fill="#cc3030" rx={1} />
              </g>
            ))}
          </g>
        )}

        {/* Parking grid dots */}
        {b.parking && (
          <g opacity={0.18}>
            {[0, 1, 2, 3].flatMap(row =>
              [0, 1, 2, 3, 4].map(col => (
                <rect key={`${row}-${col}`}
                  x={b.x + 10 + col * 26} y={b.y + 20 + row * 12}
                  width={18} height={8} fill="#333" rx={2} />
              ))
            )}
          </g>
        )}

        {/* Travelift tracks (boatyard) */}
        {b.yard && (
          <g>
            <rect x={b.x + 20} y={b.y + 60} width={b.w - 40} height={b.h - 70}
              fill="rgba(0,0,0,0.06)" rx={2} />
            {/* Rails */}
            <line x1={b.x + 30} y1={b.y + 60} x2={b.x + 30} y2={b.y + b.h - 10}
              stroke="rgba(0,0,0,0.2)" strokeWidth={2.5} />
            <line x1={b.x + b.w - 30} y1={b.y + 60} x2={b.x + b.w - 30} y2={b.y + b.h - 10}
              stroke="rgba(0,0,0,0.2)" strokeWidth={2.5} />
            {/* Travelift frame */}
            <rect x={b.x + 22} y={b.y + 75} width={b.w - 44} height={30}
              fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={2} />
            <line x1={b.x + b.w / 2 - 20} y1={b.y + 80} x2={b.x + b.w / 2 + 20} y2={b.y + 80}
              stroke="rgba(0,0,0,0.2)" strokeWidth={2} strokeDasharray="4 3" />
          </g>
        )}

        {/* Label */}
        <text x={cx} y={b.sub ? cy - 5 : cy + 1}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={9.5} fontWeight="700" fill="rgba(0,0,0,0.62)"
          fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.3">
          {b.label.toUpperCase()}
        </text>
        {b.sub && (
          <text x={cx} y={cy + 8}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={7.5} fontWeight="400" fill="rgba(0,0,0,0.38)"
            fontFamily="IBM Plex Sans, sans-serif">
            {b.sub}
          </text>
        )}
      </g>
    );
  }

  // ─── Single Pier ─────────────────────────────────────────────────────────────
  function PierDock({ pierId, slips, slipsPerSide, selectedId, onSelect }) {
    const cx = PIER_CX[pierId];
    const pontoonX = cx - PONTOON_W / 2;
    const ph = pontoonH(pierId);

    // Split slips: first half west, second half east
    const westSlips = slips.slice(0, slipsPerSide);
    const eastSlips = slips.slice(slipsPerSide);

    const fingerYs = Array.from({ length: slipsPerSide + 1 }, (_, i) =>
      PONTOON_TOP + 8 + i * SLIP_UNIT
    );

    function SlipCell({ slip, side }) {
      if (!slip) return null;
      const col = SLIP_COL[slip.status] || SLIP_COL.available;
      const sel = slip.id === selectedId;
      const slipX = side === 'west'
        ? cx - PONTOON_W / 2 - SLIP_W
        : cx + PONTOON_W / 2;
      const idx = side === 'west'
        ? westSlips.indexOf(slip)
        : eastSlips.indexOf(slip);
      const slipY = PONTOON_TOP + 8 + FINGER_H + idx * SLIP_UNIT;

      const vesselText = slip.vessel
        ? (slip.vessel.length > 9 ? slip.vessel.slice(0, 8) + '…' : slip.vessel)
        : '';

      return (
        <g onClick={() => onSelect(slip)} style={{ cursor: 'pointer' }}>
          {sel && (
            <rect x={slipX - 2} y={slipY - 2} width={SLIP_W + 4} height={SLIP_H + 4}
              fill="none" stroke="#b8965a" strokeWidth={2.5} rx={4}
              style={{ filter: 'drop-shadow(0 0 5px rgba(184,150,90,0.7))' }} />
          )}
          <rect x={slipX} y={slipY} width={SLIP_W} height={SLIP_H}
            fill={col.fill} stroke={sel ? '#b8965a' : col.stroke}
            strokeWidth={sel ? 2 : 1.5} rx={2} />
          {/* Slip ID */}
          <text x={slipX + SLIP_W / 2} y={slipY + 13}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={8.5} fontWeight="700" fill={col.label}
            fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.3">
            {slip.id}
          </text>
          {/* Vessel name */}
          {vesselText && (
            <text x={slipX + SLIP_W / 2} y={slipY + 26}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={7} fontWeight="500" fill={col.label}
              fontFamily="IBM Plex Sans, sans-serif" opacity={0.78}>
              {vesselText}
            </text>
          )}
          {/* Length */}
          <text x={slipX + SLIP_W / 2} y={slipY + SLIP_H - 5}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={6.5} fill={col.label}
            fontFamily="IBM Plex Sans, sans-serif" opacity={0.5}>
            {slip.len}
          </text>
        </g>
      );
    }

    return (
      <g>
        {/* Gangway from quay to pontoon */}
        <rect x={cx - GANGWAY_W / 2} y={SHORE_Y - 3} width={GANGWAY_W} height={GANGWAY_H + 6}
          fill={GANGWAY_FILL} stroke={PIER_STROKE} strokeWidth={1.2} />
        {/* Gangway grip lines */}
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t}
            x1={cx - GANGWAY_W / 2 + 2} y1={SHORE_Y + GANGWAY_H * t}
            x2={cx + GANGWAY_W / 2 - 2} y2={SHORE_Y + GANGWAY_H * t}
            stroke={PIER_STROKE} strokeWidth={1} opacity={0.5} />
        ))}

        {/* Pontoon body */}
        <rect x={pontoonX} y={PONTOON_TOP} width={PONTOON_W} height={ph}
          fill={PIER_FILL} stroke={PIER_STROKE} strokeWidth={1.5} rx={2} />

        {/* Pontoon label */}
        <text
          x={cx} y={PONTOON_TOP + ph / 2}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fontWeight="700" fill="#7a6820"
          fontFamily="IBM Plex Sans, sans-serif" letterSpacing="2"
          transform={`rotate(-90, ${cx}, ${PONTOON_TOP + ph / 2})`}>
          PIER {pierId}
        </text>

        {/* Finger docks — west side */}
        {fingerYs.map((fy, i) => (
          <rect key={`fw-${i}`}
            x={cx - PONTOON_W / 2 - SLIP_W} y={fy}
            width={SLIP_W} height={FINGER_H}
            fill={FINGER_FILL} stroke={PIER_STROKE} strokeWidth={1} />
        ))}

        {/* Finger docks — east side */}
        {fingerYs.map((fy, i) => (
          <rect key={`fe-${i}`}
            x={cx + PONTOON_W / 2} y={fy}
            width={SLIP_W} height={FINGER_H}
            fill={FINGER_FILL} stroke={PIER_STROKE} strokeWidth={1} />
        ))}

        {/* West slips */}
        {westSlips.map(slip => (
          <SlipCell key={slip.id} slip={slip} side="west" />
        ))}

        {/* East slips */}
        {eastSlips.map(slip => (
          <SlipCell key={slip.id} slip={slip} side="east" />
        ))}

        {/* End cap / cleat */}
        <rect x={pontoonX - 4} y={PONTOON_TOP + ph - 6} width={PONTOON_W + 8} height={8}
          fill={PIER_FILL} stroke={PIER_STROKE} strokeWidth={1.5} rx={2} />

        {/* Rubber fenders (small bumps on pontoon ends) */}
        {[PONTOON_TOP + ph * 0.3, PONTOON_TOP + ph * 0.7].map((fy, i) => (
          <g key={i}>
            <ellipse cx={pontoonX - 3} cy={fy} rx={3.5} ry={4}
              fill="#6a6050" opacity={0.6} />
            <ellipse cx={pontoonX + PONTOON_W + 3} cy={fy} rx={3.5} ry={4}
              fill="#6a6050" opacity={0.6} />
          </g>
        ))}
      </g>
    );
  }

  // ─── Compass Rose ────────────────────────────────────────────────────────────
  function CompassRose({ x, y, r = 34 }) {
    const pts = (deg, outer, inner) => {
      const rad = (deg - 90) * Math.PI / 180;
      const rOuter = (deg2) => {
        const r2 = (deg2 - 90) * Math.PI / 180;
        return [x + outer * Math.cos(r2), y + outer * Math.sin(r2)];
      };
      const rInner = (deg2) => {
        const r2 = (deg2 - 90) * Math.PI / 180;
        return [x + inner * Math.cos(r2), y + inner * Math.sin(r2)];
      };
      return [rOuter(deg - 10), rOuter(deg + 10), rInner(deg + 5), rInner(deg - 5)];
    };

    const arrow = (deg, len, color) => {
      const rad = (deg - 90) * Math.PI / 180;
      const tip = [x + len * Math.cos(rad), y + len * Math.sin(rad)];
      const base = [x + (len * 0.3) * Math.cos(rad), y + (len * 0.3) * Math.sin(rad)];
      const side1 = [x + 6 * Math.cos(rad + Math.PI / 2), y + 6 * Math.sin(rad + Math.PI / 2)];
      const side2 = [x + 6 * Math.cos(rad - Math.PI / 2), y + 6 * Math.sin(rad - Math.PI / 2)];
      return `M ${tip[0]} ${tip[1]} L ${side1[0]} ${side1[1]} L ${base[0]} ${base[1]} L ${side2[0]} ${side2[1]} Z`;
    };

    const cardLabels = [
      { deg: 0,   label: 'N', dx: 0,    dy: -r - 10 },
      { deg: 90,  label: 'E', dx: r+10, dy: 4 },
      { deg: 180, label: 'S', dx: 0,    dy: r+16 },
      { deg: 270, label: 'W', dx: -r-12,dy: 4 },
    ];

    return (
      <g>
        {/* Outer ring */}
        <circle cx={x} cy={y} r={r + 14} fill="rgba(10,30,50,0.55)" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
        <circle cx={x} cy={y} r={r + 3} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.8} />

        {/* Intercardinal ticks */}
        {[45, 135, 225, 315].map(deg => {
          const rad = (deg - 90) * Math.PI / 180;
          return (
            <line key={deg}
              x1={x + (r - 5) * Math.cos(rad)} y1={y + (r - 5) * Math.sin(rad)}
              x2={x + (r + 2) * Math.cos(rad)} y2={y + (r + 2) * Math.sin(rad)}
              stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} />
          );
        })}

        {/* N/S arrows (dark/light) */}
        <path d={arrow(0,   r, '#ffffff')} fill="rgba(255,255,255,0.9)" />
        <path d={arrow(180, r, '#ffffff')} fill="rgba(255,255,255,0.35)" />
        <path d={arrow(90,  r, '#ffffff')} fill="rgba(255,255,255,0.35)" />
        <path d={arrow(270, r, '#ffffff')} fill="rgba(255,255,255,0.35)" />

        {/* N pointer highlight */}
        <path d={arrow(0, r, '#b8965a')} fill="#b8965a" opacity={0.9} />

        {/* Centre */}
        <circle cx={x} cy={y} r={5} fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />

        {/* Cardinal labels */}
        {cardLabels.map(({ label, dx, dy }) => (
          <text key={label}
            x={x + dx} y={y + dy}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={label === 'N' ? 11 : 9.5}
            fontWeight={label === 'N' ? '700' : '600'}
            fill={label === 'N' ? '#b8965a' : 'rgba(255,255,255,0.65)'}
            fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5">
            {label}
          </text>
        ))}
      </g>
    );
  }

  // ─── Scale Bar ───────────────────────────────────────────────────────────────
  function ScaleBar({ x, y }) {
    return (
      <g>
        <rect x={x} y={y} width={120} height={6} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        <rect x={x} y={y} width={60} height={6} fill="rgba(255,255,255,0.35)" />
        <text x={x} y={y + 16} fontSize={8} fill="rgba(255,255,255,0.5)"
          fontFamily="IBM Plex Sans, sans-serif">0</text>
        <text x={x + 57} y={y + 16} fontSize={8} fill="rgba(255,255,255,0.5)"
          fontFamily="IBM Plex Sans, sans-serif" textAnchor="middle">50m</text>
        <text x={x + 120} y={y + 16} fontSize={8} fill="rgba(255,255,255,0.5)"
          fontFamily="IBM Plex Sans, sans-serif" textAnchor="end">100m</text>
      </g>
    );
  }

  // ─── Depth Labels ────────────────────────────────────────────────────────────
  function DepthLabels() {
    const labels = [
      { x: 90,  y: 560, d: '3.2m' },
      { x: 380, y: 520, d: '3.8m' },
      { x: 650, y: 580, d: '3.5m' },
      { x: 920, y: 540, d: '4.0m' },
      { x: 200, y: 460, d: '2.8m' },
      { x: 500, y: 440, d: '3.1m' },
    ];
    return (
      <g opacity={0.45}>
        {labels.map((l, i) => (
          <text key={i} x={l.x} y={l.y}
            textAnchor="middle" fontSize={8.5}
            fill="rgba(180,220,255,0.7)"
            fontFamily="IBM Plex Sans, sans-serif"
            fontStyle="italic">
            {l.d}
          </text>
        ))}
      </g>
    );
  }

  // ─── Marina Label ─────────────────────────────────────────────────────────────
  function MarinaLabel() {
    return (
      <g>
        <text x={20} y={H - 18}
          fontSize={11} fontWeight="700"
          fill="rgba(255,255,255,0.25)"
          fontFamily="IBM Plex Sans, sans-serif"
          letterSpacing="2">
          HARWICH MARINA · HARBOR MAP
        </text>
        <text x={20} y={H - 6}
          fontSize={8}
          fill="rgba(255,255,255,0.15)"
          fontFamily="IBM Plex Sans, sans-serif"
          letterSpacing="0.5">
          Chart ref. HM-2026 · Not for navigation
        </text>
      </g>
    );
  }

  // ─── Main HarborMap Component ────────────────────────────────────────────────
  function HarborMap({ piers = [], selectedSlip, onSelectSlip }) {
    const [tooltip, setTooltip] = useState(null);
    const svgRef = useRef(null);

    const piersById = {};
    piers.forEach(p => { piersById[p.id] = p; });

    function handleSelect(slip) {
      onSelectSlip && onSelectSlip(slip && slip.id === selectedSlip?.id ? null : slip);
    }

    return (
      <div style={{
        background: '#081e30',
        borderRadius: 10,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 4px 32px rgba(0,0,0,0.3)',
      }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Land */}
          <LandArea />

          {/* Water */}
          <WaterBg />

          {/* Depth soundings */}
          <DepthLabels />

          {/* Buildings on shore */}
          {BUILDINGS.map(b => <Building key={b.label} b={b} />)}

          {/* Piers */}
          {[
            { id: 'A', spSide: PIER_SIDES.A },
            { id: 'B', spSide: PIER_SIDES.B },
            { id: 'C', spSide: PIER_SIDES.C },
          ].map(({ id, spSide }) => {
            const pier = piersById[id];
            if (!pier) return null;
            return (
              <PierDock
                key={id}
                pierId={id}
                slips={pier.slips}
                slipsPerSide={spSide}
                selectedId={selectedSlip?.id}
                onSelect={handleSelect}
              />
            );
          })}

          {/* Outer breakwater */}
          <g>
            <polyline
              points={`1062,${SHORE_Y} 1072,${SHORE_Y + 120} 1068,${SHORE_Y + 260} 1075,${SHORE_Y + 400}`}
              fill="none" stroke="#6a7a5a" strokeWidth={8} strokeLinecap="round" />
            <polyline
              points={`1062,${SHORE_Y} 1072,${SHORE_Y + 120} 1068,${SHORE_Y + 260} 1075,${SHORE_Y + 400}`}
              fill="none" stroke="#8a9a7a" strokeWidth={4} strokeLinecap="round" opacity={0.5} />
            <text x={1044} y={SHORE_Y + 150}
              textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.25)"
              fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.5"
              transform={`rotate(-90, 1044, ${SHORE_Y + 150})`}>
              BREAKWATER
            </text>
          </g>

          {/* Compass */}
          <CompassRose x={1042} y={H - 68} r={30} />

          {/* Scale bar */}
          <ScaleBar x={20} y={H - 52} />

          {/* Marina label */}
          <MarinaLabel />
        </svg>
      </div>
    );
  }

  // Export
  Object.assign(window, { HarborMap });
})();
