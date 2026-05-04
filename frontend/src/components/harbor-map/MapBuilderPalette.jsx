import { PREFABS, CATEGORIES } from './mapBuilderPrefabs.js'

const PW = 48  // preview width px
const PH = 30  // preview height px

// ── Building icons — design-system style (stroke-based, 20×20) ──────────────

function BuildingIcon({ type, color = 'rgba(0,0,0,0.55)' }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const icons = {
    office: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <path {...s} d="M3,18 L3,7 L10,3 L17,7 L17,18 Z" />
        <path {...s} d="M8,18 L8,12 L12,12 L12,18" />
        <path {...s} d="M10,3 L10,2" />
      </svg>
    ),
    'fuel-stn': (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <rect {...s} x={3} y={5} width={9} height={13} rx={1} />
        <path {...s} d="M12,8 L15,8 C16,8 16,9 16,10 L16,13 C16,14 17,14 17,13 L17,8" />
        <path {...s} d="M5,5 L5,3 L10,3 L10,5" />
        <line {...s} x1={3} y1={10} x2={12} y2={10} />
      </svg>
    ),
    parking: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <rect {...s} x={2.5} y={2.5} width={15} height={15} rx={3} />
        <path {...s} d="M7.5,6 L7.5,14 M7.5,6 L11,6 C13,6 13.5,7.5 13.5,9 C13.5,10.5 13,12 11,12 L7.5,12" />
      </svg>
    ),
    boatyard: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <path {...s} d="M3,13 Q5,16 10,17 Q15,16 17,13 L14,9 L6,9 Z" />
        <line {...s} x1={10} y1={3} x2={10} y2={9} />
        <path {...s} d="M10,3 L14,7 L10,7" />
        <line {...s} x1={2} y1={18} x2={18} y2={18} />
      </svg>
    ),
    chandlery: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <path {...s} d="M6,8 L14,8 L15.5,17 L4.5,17 Z" />
        <path {...s} d="M7.5,8 C7.5,4.5 12.5,4.5 12.5,8" />
        <line {...s} x1={9} y1={11} x2={11} y2={11} />
      </svg>
    ),
    restaurant: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <line {...s} x1={7} y1={3} x2={7} y2={17} />
        <path {...s} d="M5,3 L5,8 Q7,9 9,8 L9,3" />
        <line {...s} x1={13} y1={3} x2={13} y2={17} />
        <path {...s} d="M11,3 L11,10 Q13,11 15,10" />
      </svg>
    ),
    toilets: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <circle {...s} cx={7} cy={5} r={2} />
        <path {...s} d="M4,9 L4,14 M10,9 L10,14 M4,9 Q7,8 10,9 M4,14 L4,18 M10,14 L10,18 M4,14 L10,14" />
        <circle {...s} cx={15} cy={5} r={2} />
        <path {...s} d="M13,9 L13,18 M17,9 L17,18 M13,9 Q15,8 17,9 M13,14 L17,14" />
      </svg>
    ),
    security: (
      <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
        <path {...s} d="M10,2 L17,5 L17,11 C17,15 10,18 10,18 C10,18 3,15 3,11 L3,5 Z" />
        <path {...s} d="M7,10 L9.5,12.5 L13,8" />
      </svg>
    ),
  }
  return icons[type] ?? null
}

// ── SVG icons for the build buttons ──────────────────────────────────────────

function ComboDockIcon({ color = 'currentColor' }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg width={16} height={14} viewBox="0 0 16 14" style={{ flexShrink: 0 }}>
      <rect {...s} x={1} y={1} width={14} height={2.5} rx={0.5} />
      <rect {...s} x={2} y={4.5} width={2} height={8} rx={0.5} />
      <rect {...s} x={7} y={4.5} width={2} height={8} rx={0.5} />
      <rect {...s} x={12} y={4.5} width={2} height={8} rx={0.5} />
    </svg>
  )
}

function FingerPierIcon({ color = 'currentColor' }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <rect {...s} x={5} y={1} width={4} height={12} rx={0.5} />
      <line {...s} x1={1} y1={4} x2={5} y2={4} />
      <line {...s} x1={1} y1={7} x2={5} y2={7} />
      <line {...s} x1={1} y1={10} x2={5} y2={10} />
      <line {...s} x1={9} y1={4} x2={13} y2={4} />
      <line {...s} x1={9} y1={7} x2={13} y2={7} />
      <line {...s} x1={9} y1={10} x2={13} y2={10} />
    </svg>
  )
}

// ── Prefab card ───────────────────────────────────────────────────────────────

const PIER_TYPES = new Set(['pier-v', 'pier-h', 'parallel-wall'])

function PrefabPreview({ prefab }) {
  if (prefab.compound) {
    const scale = Math.min(PW / prefab.w, PH / prefab.h)
    const totalW = prefab.w * scale
    const totalH = prefab.h * scale
    const offX = (PW - totalW) / 2
    const offY = (PH - totalH) / 2
    return (
      <svg width={PW} height={PH} style={{ flexShrink: 0 }}>
        {prefab.components.map((c, i) => {
          const cw = c.canvas_w * scale
          const ch = c.canvas_h * scale
          const cx = offX + c.ox * scale
          const cy = offY + c.oy * scale
          return <rect key={i} x={cx - cw / 2} y={cy - ch / 2} width={cw} height={ch} fill={prefab.bg} stroke={prefab.border} strokeWidth={0.8} rx={1} />
        })}
      </svg>
    )
  }

  const scale = Math.min(PW / Math.max(prefab.w, 0.5), PH / Math.max(prefab.h, 0.5))
  const sw = prefab.w * scale
  const sh = prefab.h * scale
  const x0 = (PW - sw) / 2
  const y0 = (PH - sh) / 2
  const isPier = PIER_TYPES.has(prefab.type)
  const isV = prefab.type === 'pier-v'
  const ticks = []
  if (isPier) {
    const SLOTS = 4
    const tickLen = 4
    if (isV) {
      for (let i = 1; i <= SLOTS; i++) {
        const ty = y0 + (i / (SLOTS + 1)) * sh
        ticks.push(
          <line key={`L${i}`} x1={x0 - tickLen} y1={ty} x2={x0} y2={ty} stroke={prefab.border} strokeWidth={0.75} />,
          <line key={`R${i}`} x1={x0 + sw} y1={ty} x2={x0 + sw + tickLen} y2={ty} stroke={prefab.border} strokeWidth={0.75} />,
        )
      }
    } else {
      for (let i = 1; i <= SLOTS; i++) {
        const tx = x0 + (i / (SLOTS + 1)) * sw
        ticks.push(
          <line key={`T${i}`} x1={tx} y1={y0 - tickLen} x2={tx} y2={y0} stroke={prefab.border} strokeWidth={0.75} />,
          <line key={`B${i}`} x1={tx} y1={y0 + sh} x2={tx} y2={y0 + sh + tickLen} stroke={prefab.border} strokeWidth={0.75} />,
        )
      }
    }
  }
  return (
    <svg width={PW} height={PH} style={{ flexShrink: 0 }}>
      {ticks}
      <rect x={x0} y={y0} width={sw} height={sh} fill={prefab.bg} stroke={prefab.border} strokeWidth={1} rx={1} />
    </svg>
  )
}

const BUILDING_TYPES = new Set(['office', 'fuel-stn', 'parking', 'boatyard', 'chandlery', 'restaurant', 'toilets', 'security'])

function PrefabCard({ prefab, onDragStart }) {
  const isBuilding = BUILDING_TYPES.has(prefab.type)
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, prefab)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', cursor: 'grab', borderRadius: 4, userSelect: 'none' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {isBuilding ? (
        <div style={{
          width: PW, height: PH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: prefab.bg, borderRadius: 4, border: `1px solid ${prefab.border}`,
        }}>
          <BuildingIcon type={prefab.type} color={prefab.border} />
        </div>
      ) : (
        <PrefabPreview prefab={prefab} />
      )}
      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {prefab.label}
      </span>
    </div>
  )
}

// ── Main palette ──────────────────────────────────────────────────────────────

export default function MapBuilderPalette({
  customPrefabs,
  selectedIds,
  drawMode,
  onPrefabDragStart,
  onBuildComboDock,
  onBuildFingerPier,
  onDeleteCustomPrefab,
}) {
  return (
    <div style={{
      width: 190, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--white)', borderRight: 'var(--border)', overflowY: 'auto', fontSize: 12,
    }}>
      <div style={{ padding: '10px 12px', fontSize: 11, letterSpacing: '1px', color: 'var(--gold)', borderBottom: 'var(--border)', fontWeight: 700 }}>
        PREFABS
      </div>

      {/* Build dock buttons */}
      <div style={{ padding: '8px 8px 6px', display: 'flex', flexDirection: 'column', gap: 5, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <button
          onClick={onBuildComboDock}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 11, fontWeight: 600, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid rgba(26,58,92,0.3)',
            background: 'linear-gradient(135deg, #1a3a5c 0%, #1e4a78 100%)',
            color: '#fff', textAlign: 'left', width: '100%', letterSpacing: '0.2px',
            boxShadow: '0 1px 3px rgba(26,58,92,0.25)',
          }}
        >
          <ComboDockIcon color="#b8c8e0" />
          Combo Dock…
        </button>
        <button
          onClick={onBuildFingerPier}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 11, fontWeight: 600, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid rgba(38,110,125,0.35)',
            background: 'linear-gradient(135deg, #1e6a7a 0%, #27879a 100%)',
            color: '#fff', textAlign: 'left', width: '100%', letterSpacing: '0.2px',
            boxShadow: '0 1px 3px rgba(30,106,122,0.25)',
          }}
        >
          <FingerPierIcon color="#a0d0dc" />
          Finger Pier…
        </button>
      </div>

      {customPrefabs?.length > 0 && (
        <div>
          <div style={{ padding: '7px 10px 3px', fontSize: 10, color: 'var(--gold,#b8965a)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
            Custom
          </div>
          {customPrefabs.map(cp => (
            <div key={cp.type} style={{ display: 'flex', alignItems: 'center', paddingRight: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PrefabCard prefab={cp} onDragStart={onPrefabDragStart} />
              </div>
              <button
                onClick={() => onDeleteCustomPrefab?.(cp.type)}
                title="Delete prefab"
                style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: 3,
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 11, color: 'rgba(0,0,0,0.35)', lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(192,57,43,0.12)'; e.currentTarget.style.color = '#c0392b' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(0,0,0,0.35)' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {CATEGORIES.map(cat => (
        <div key={cat}>
          <div style={{ padding: '7px 10px 3px', fontSize: 10, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
            {cat}
          </div>
          {PREFABS.filter(p => p.cat === cat).map(p => (
            <PrefabCard key={p.type} prefab={p} onDragStart={onPrefabDragStart} />
          ))}
        </div>
      ))}
    </div>
  )
}
