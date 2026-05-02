export default function MapBuilderBerthPanel({ berths, placedBerthIds, onBerthDragStart }) {
  // Sort: unplaced first, placed (greyed) at bottom
  const sorted = [...berths].sort((a, b) => {
    const aP = placedBerthIds.has(a.id) ? 1 : 0
    const bP = placedBerthIds.has(b.id) ? 1 : 0
    return aP - bP
  })

  return (
    <div style={{
      width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#0c1f3d', borderLeft: '1px solid #1e3a5f', overflowY: 'auto',
    }}>
      <div style={{ padding: '10px 12px', fontSize: 11, letterSpacing: '1px', color: '#b8965a', borderBottom: '1px solid #1e3a5f', fontWeight: 700 }}>
        UNPLACED BERTHS
      </div>
      <div style={{ padding: '5px 8px 4px', fontSize: 10, color: '#5a7a9a' }}>
        Drag onto map ↓
      </div>

      {sorted.map(berth => {
        const placed = placedBerthIds.has(berth.id)
        return (
          <div
            key={berth.id}
            draggable={!placed}
            onDragStart={placed ? undefined : e => onBerthDragStart(e, berth)}
            style={{
              margin: '3px 8px',
              padding: '6px 8px',
              background: placed ? 'transparent' : '#1e3a5f',
              border: `1px solid ${placed ? '#2a3a4a' : '#2a5a7a'}`,
              borderRadius: 4,
              fontSize: 11,
              color: placed ? '#3a5a6a' : '#c8d8e8',
              cursor: placed ? 'default' : 'grab',
              userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span>{berth.code} · {berth.length_m}m</span>
            {placed && <span style={{ fontSize: 9, color: '#3a8a5a' }}>✓</span>}
          </div>
        )
      })}

      {berths.length === 0 && (
        <div style={{ padding: '20px 12px', fontSize: 11, color: '#3a5a6a', textAlign: 'center' }}>
          No berths defined yet
        </div>
      )}
    </div>
  )
}
