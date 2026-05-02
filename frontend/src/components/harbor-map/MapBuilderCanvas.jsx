import { GRID, COLS, ROWS, CW, CH, sortItemsForRender } from './mapBuilderUtils.js'

// Render a single item as an SVG rect
function ItemRect({ item, selected }) {
  const x = item.gx * GRID
  const y = item.gy * GRID
  const w = item.w * GRID
  const h = item.h * GRID
  const cx = x + w / 2
  const cy = y + h / 2
  const bg     = item.bg     ?? item.tool?.bg     ?? '#888'
  const border = item.border ?? item.tool?.border ?? '#555'

  return (
    <g transform={item.rotation ? `rotate(${item.rotation},${cx},${cy})` : undefined}>
      <rect
        x={x} y={y} width={w} height={h}
        fill={bg} stroke={border} strokeWidth={1} rx={2}
        style={{ cursor: 'move' }}
      />
      {item.label && (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
          fontSize={10} fill="rgba(0,0,0,0.55)" style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {item.label}
        </text>
      )}
      {selected && (
        <rect x={x} y={y} width={w} height={h}
          fill="none" stroke="#b8965a" strokeWidth={2} rx={2}
          style={{ pointerEvents: 'none' }} />
      )}
    </g>
  )
}

// Render a polygon item
function ItemPoly({ item, selected }) {
  const pts = item.points.map(p => `${p.gx * GRID},${p.gy * GRID}`).join(' ')
  return (
    <g>
      <polygon points={pts} fill={item.fill ?? '#888'} stroke={item.stroke ?? '#555'} strokeWidth={1} />
      {selected && (
        <polygon points={pts} fill="none" stroke="#b8965a" strokeWidth={2}
          style={{ pointerEvents: 'none' }} />
      )}
    </g>
  )
}

export default function MapBuilderCanvas({
  items,
  ghost,                         // { gx, gy, w, h, bg, border } | null
  selectedIds,                   // Set<string>
  drawMode,
  drawPoints,                    // [{ gx, gy }]
  hoverG,                        // { gx, gy } | null
  onCanvasClick,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasDragOver,
  onCanvasDrop,
  onCanvasDragLeave,
  onItemPointerDown,             // (e, item)
  onRotateHandlePointerDown,     // (e, item)
  onWallResizePointerDown,       // (e, item, side: 'left'|'right')
}) {
  const sorted = sortItemsForRender(items)
  const walls  = items.filter(i => i.type === 'parallel-wall')

  const nearFirst = drawMode && drawPoints.length >= 3 && hoverG &&
    Math.abs(hoverG.gx - drawPoints[0].gx) <= 1 &&
    Math.abs(hoverG.gy - drawPoints[0].gy) <= 1

  return (
    <svg
      className="mb-canvas"
      width={CW} height={CH}
      style={{ display: 'block', cursor: drawMode ? 'crosshair' : 'default', flexShrink: 0 }}
      onClick={onCanvasClick}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onDragLeave={onCanvasDragLeave}
    >
      {/* Two-tier grid */}
      <defs>
        <pattern id="mbMinorGrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#1a3a55" strokeWidth={0.5} />
        </pattern>
        <pattern id="mbMajorGrid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
          <rect width={GRID * 5} height={GRID * 5} fill="url(#mbMinorGrid)" />
          <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="#2a5a7a" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={CW} height={CH} fill="#0d2235" />
      <rect width={CW} height={CH} fill="url(#mbMajorGrid)" />

      {/* Placed items sorted by render layer */}
      {sorted.map(item => {
        const sel = selectedIds.has(item.id)
        return (
          <g key={item.id} onPointerDown={e => onItemPointerDown(e, item)}>
            {item.shape === 'polygon'
              ? <ItemPoly item={item} selected={sel} />
              : <ItemRect item={item} selected={sel} />
            }
          </g>
        )
      })}

      {/* Parallel wall docking-face dash + resize handles */}
      {walls.map(wall => {
        const x    = wall.gx * GRID
        const y    = wall.gy * GRID
        const w    = wall.w * GRID
        const faceY = y + wall.h * GRID
        const sel  = selectedIds.has(wall.id)
        return (
          <g key={`wall-extras-${wall.id}`}>
            <line x1={x} y1={faceY} x2={x + w} y2={faceY}
              stroke="#5aaf8f" strokeWidth={1.5} strokeDasharray="4,3" />
            {sel && (
              <>
                <rect
                  x={x - 5} y={y + (wall.h * GRID / 2) - 5} width={10} height={10}
                  fill="#b8965a" stroke="white" strokeWidth={1} rx={2}
                  style={{ cursor: 'ew-resize' }}
                  onPointerDown={e => { e.stopPropagation(); onWallResizePointerDown(e, wall, 'left') }}
                />
                <rect
                  x={x + w - 5} y={y + (wall.h * GRID / 2) - 5} width={10} height={10}
                  fill="#b8965a" stroke="white" strokeWidth={1} rx={2}
                  style={{ cursor: 'ew-resize' }}
                  onPointerDown={e => { e.stopPropagation(); onWallResizePointerDown(e, wall, 'right') }}
                />
                <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="#b8965a">
                  {wall.w} units
                </text>
              </>
            )}
          </g>
        )
      })}

      {/* Rotation handles (selected non-polygon items) */}
      {sorted
        .filter(i => selectedIds.has(i.id) && i.shape !== 'polygon')
        .map(item => {
          const cx = (item.gx + item.w / 2) * GRID
          const cy = item.gy * GRID - 16
          return (
            <g key={`rot-${item.id}`}
              onPointerDown={e => { e.stopPropagation(); onRotateHandlePointerDown(e, item) }}
              style={{ cursor: 'grab' }}>
              <circle cx={cx} cy={cy} r={8} fill="#b8965a" stroke="white" strokeWidth={1.5} />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fill="white" style={{ pointerEvents: 'none', userSelect: 'none' }}>↻</text>
            </g>
          )
        })}

      {/* Ghost element while dragging from palette/berth panel */}
      {ghost && (
        <rect
          x={ghost.gx * GRID} y={ghost.gy * GRID}
          width={ghost.w * GRID} height={ghost.h * GRID}
          fill={ghost.bg ?? '#888'} fillOpacity={0.5}
          stroke={ghost.border ?? '#aaa'} strokeWidth={1.5}
          strokeDasharray="4,3" rx={2}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Draw mode: polygon in progress */}
      {drawMode && drawPoints.length > 0 && (
        <>
          <polyline
            points={[
              ...drawPoints,
              hoverG ?? drawPoints[drawPoints.length - 1],
            ].map(p => `${p.gx * GRID},${p.gy * GRID}`).join(' ')}
            fill="none" stroke="#b8965a" strokeWidth={1.5} strokeDasharray="5,3"
          />
          {drawPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.gx * GRID} cy={p.gy * GRID}
              r={i === 0 ? 6 : 3}
              fill={i === 0 ? (nearFirst ? '#b8965a' : 'white') : '#b8965a'}
              stroke="#b8965a" strokeWidth={1.5}
            />
          ))}
        </>
      )}
    </svg>
  )
}
