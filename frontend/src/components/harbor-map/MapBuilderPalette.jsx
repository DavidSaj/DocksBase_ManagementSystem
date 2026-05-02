import { PREFABS, CATEGORIES } from './mapBuilderPrefabs.js'
import { GRID } from './mapBuilderUtils.js'

function PrefabCard({ prefab, onDragStart }) {
  const pw = Math.min(prefab.w * GRID, 36)
  const ph = Math.min(prefab.h * GRID, 22)
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, prefab)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', cursor: 'grab', borderRadius: 4,
        userSelect: 'none',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{
        width: pw, height: ph, flexShrink: 0,
        background: prefab.bg, border: `1.5px solid ${prefab.border}`,
        borderRadius: 2,
        clipPath: prefab.clip,
      }} />
      <span style={{ fontSize: 11, color: '#c8c0b0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {prefab.label}
      </span>
    </div>
  )
}

export default function MapBuilderPalette({
  customPrefabs,      // [{ id, name, kind, fill?, stroke? }]
  selectedIds,        // Set<string>
  drawMode,           // boolean
  onPrefabDragStart,  // (e, prefab) — HTML5 dragstart
  onStartDraw,        // () => void
  onGroupToPrefab,    // () => void
}) {
  return (
    <div style={{
      width: 160, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#0c1f3d', borderRight: '1px solid #1e3a5f', overflowY: 'auto',
      fontSize: 12,
    }}>
      <div style={{ padding: '10px 12px', fontSize: 11, letterSpacing: '1px', color: '#b8965a', borderBottom: '1px solid #1e3a5f', fontWeight: 700 }}>
        PREFABS
      </div>

      {CATEGORIES.map(cat => (
        <div key={cat}>
          <div style={{ padding: '7px 10px 3px', fontSize: 10, color: '#5a7a9a', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
            {cat}
          </div>
          {PREFABS.filter(p => p.cat === cat).map(p => (
            <PrefabCard key={p.type} prefab={p} onDragStart={onPrefabDragStart} />
          ))}
        </div>
      ))}

      {customPrefabs.length > 0 && (
        <div>
          <div style={{ padding: '7px 10px 3px', fontSize: 10, color: '#5a7a9a', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
            Custom
          </div>
          {customPrefabs.map(cp => (
            <PrefabCard
              key={cp.id}
              prefab={{ type: cp.id, label: cp.name, w: 3, h: 3, bg: cp.fill ?? '#557799', border: cp.stroke ?? '#7799bb' }}
              onDragStart={onPrefabDragStart}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 'auto', borderTop: '1px solid #1e3a5f' }}>
        <button
          onClick={onStartDraw}
          disabled={drawMode}
          style={{
            width: '100%', padding: '10px 12px', background: 'none', border: 'none',
            color: drawMode ? '#3a5a7a' : '#b8965a', fontSize: 11, textAlign: 'left',
            cursor: drawMode ? 'default' : 'pointer', fontWeight: 600,
          }}
        >
          + Draw Custom
        </button>
        <button
          onClick={onGroupToPrefab}
          disabled={selectedIds.size < 2}
          style={{
            width: '100%', padding: '6px 12px 10px', background: 'none', border: 'none',
            color: selectedIds.size < 2 ? '#3a5a7a' : '#b8965a', fontSize: 11, textAlign: 'left',
            cursor: selectedIds.size < 2 ? 'default' : 'pointer', fontWeight: 600,
          }}
        >
          ⊞ Group → Prefab
        </button>
      </div>
    </div>
  )
}
