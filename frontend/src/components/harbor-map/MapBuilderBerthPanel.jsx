export default function MapBuilderBerthPanel({ berths, placedBerthIds, onBerthDragStart }) {
  const sorted = [...berths].sort((a, b) => {
    const aP = placedBerthIds.has(a.id) ? 1 : 0
    const bP = placedBerthIds.has(b.id) ? 1 : 0
    return aP - bP
  })

  return (
    <div style={{
      width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--white)', borderLeft: 'var(--border)', overflowY: 'auto',
    }}>
      <div style={{ padding: '10px 12px', fontSize: 11, letterSpacing: '1px', color: 'var(--gold)', borderBottom: 'var(--border)', fontWeight: 700 }}>
        BERTHS
      </div>
      <div style={{ padding: '5px 8px 4px', fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
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
              background: placed ? 'transparent' : '#e8f2ff',
              border: `1px solid ${placed ? 'rgba(0,0,0,0.08)' : '#b0cff5'}`,
              borderRadius: 4,
              fontSize: 11,
              color: placed ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.7)',
              cursor: placed ? 'default' : 'grab',
              userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span>{berth.code} · {berth.length_m}m</span>
            {placed && <span style={{ fontSize: 9, color: 'var(--green)' }}>✓</span>}
          </div>
        )
      })}

      {berths.length === 0 && (
        <div style={{ padding: '20px 12px', fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center' }}>
          No berths defined yet
        </div>
      )}
    </div>
  )
}
