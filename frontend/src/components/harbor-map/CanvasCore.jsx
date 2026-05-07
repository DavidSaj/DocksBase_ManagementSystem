// frontend/src/components/harbor-map/CanvasCore.jsx
import { useId } from 'react'
import { GRID, COLS, ROWS, CW, CH } from './mapBuilderUtils.js'

/**
 * CanvasCore — dumb SVG renderer.
 *
 * shapes[] item contract:
 * {
 *   id:        string,
 *   type:      string,
 *   absX:      number,   // center x in grid units (unused for polygon items)
 *   absY:      number,   // center y in grid units
 *   w:         number,   // width in grid units
 *   h:         number,   // height in grid units
 *   rotation:  number,   // degrees
 *   fill:      string,   // CSS color
 *   stroke:    string,
 *   label:     string,
 *   meta:      object,   // opaque controller data
 *   // Polygon terrain items also have:
 *   isPolygon: true,
 *   points:    [{gx, gy}],  // grid coords
 * }
 *
 * mode='builder': drag handles, snap zones
 * mode='viewer':  pointer cursor on berths only
 * mode='draw':    crosshair, click-to-draw terrain polygon
 */
export default function CanvasCore({
  shapes = [],
  mode = 'viewer',
  zoom = 1,              // CSS scale applied to parent — used for grid hit-testing
  // Draw mode
  drawPoints = [],       // [{gx, gy}] — already-placed polygon points
  drawCursor = null,     // {gx, gy} | null — live cursor position
  drawTool = null,       // { bg, border } | null
  // Builder mode
  snapZones = [],
  selectedIds = new Set(),
  // Event handlers
  onItemClick,
  onItemPointerDown,
  onRotateHandlePointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasClick,
  onCanvasClickDraw,      // (pos: {gx, gy}) => void — draw mode single click
  onCanvasDoubleClickDraw, // (pos: {gx, gy}) => void — draw mode double click
  onCanvasDragOver,
  onCanvasDrop,
  onCanvasDragLeave,
  ghost,
  onResizeHandlePointerDown,
}) {
  const uid = useId()
  const minorId = `ccMinorGrid${uid}`
  const majorId = `ccMajorGrid${uid}`
  const isDrawMode = mode === 'draw'

  function snapFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      gx: Math.max(0, Math.min(COLS - 1, Math.round((e.clientX - rect.left) / zoom / GRID))),
      gy: Math.max(0, Math.min(ROWS - 1, Math.round((e.clientY - rect.top) / zoom / GRID))),
    }
  }

  function handleSvgClick(e) {
    if (isDrawMode) {
      onCanvasClickDraw?.(snapFromEvent(e))
      return
    }
    onCanvasClick?.(e)
  }

  function handleSvgDoubleClick(e) {
    if (isDrawMode) {
      onCanvasDoubleClickDraw?.(snapFromEvent(e))
    }
  }

  return (
    <svg
      className="canvas-core"
      width={CW}
      height={CH}
      style={{ display: 'block', cursor: isDrawMode ? 'crosshair' : 'inherit', flexShrink: 0, overflow: 'visible' }}
      onClick={handleSvgClick}
      onDoubleClick={handleSvgDoubleClick}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onDragLeave={onCanvasDragLeave}
    >
      {/* Invisible hit area extending beyond canvas for edge drawing */}
      {isDrawMode && (
        <rect
          x={-GRID * 2} y={-GRID * 2}
          width={CW + GRID * 4} height={CH + GRID * 4}
          fill="transparent"
          style={{ pointerEvents: 'all' }}
        />
      )}

      {/* Water background + grid */}
      <defs>
        <pattern id={minorId} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="rgba(0,60,120,0.18)" strokeWidth={0.8} />
        </pattern>
        <pattern id={majorId} width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
          <rect width={GRID * 5} height={GRID * 5} fill={`url(#${minorId})`} />
          <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="rgba(0,60,120,0.32)" strokeWidth={1.5} />
        </pattern>
      </defs>
      <rect width={CW} height={CH} fill="#d4e8f2" />
      <rect width={CW} height={CH} fill={`url(#${majorId})`} />

      {/* Shapes */}
      {shapes.map(item => {
        // Polygon terrain items (land, quay-wall drawn with terrain tool)
        if (item.isPolygon && item.points?.length >= 3) {
          const ptsStr = item.points.map(p => `${p.gx * GRID},${p.gy * GRID}`).join(' ')
          return (
            <polygon
              key={item.id}
              points={ptsStr}
              fill={item.fill ?? '#8ac87a'}
              stroke={item.stroke ?? '#5a9850'}
              strokeWidth={1.5}
              style={{ pointerEvents: 'none' }}
            />
          )
        }

        // Rectangle items
        const px = item.absX * GRID
        const py = item.absY * GRID
        const pw = item.w * GRID
        const ph = item.h * GRID
        const rx = px - pw / 2
        const ry = py - ph / 2
        const selected = selectedIds.has(item.id)
        const isEditable = mode === 'builder' && !isDrawMode
        const isClickable = mode === 'viewer' && item.type === 'berth'

        return (
          <g
            key={item.id}
            transform={item.rotation ? `rotate(${item.rotation},${px},${py})` : undefined}
            onPointerDown={isEditable && onItemPointerDown ? e => onItemPointerDown(e, item) : undefined}
            onClick={isEditable ? e => e.stopPropagation() : (isClickable && onItemClick ? e => onItemClick(e, item) : undefined)}
            style={{ cursor: isEditable ? 'move' : (isClickable ? 'pointer' : 'default') }}
          >
            <rect
              x={rx} y={ry} width={pw} height={ph}
              fill={item.fill ?? '#888'}
              stroke={item.stroke ?? '#555'}
              strokeWidth={1.5}
              rx={2}
            />
            {item.label && (
              <text
                x={px} y={py}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fill="rgba(0,0,0,0.65)"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                fontFamily="var(--font)"
              >
                {item.label}
              </text>
            )}
            {selected && (
              <rect
                x={rx} y={ry} width={pw} height={ph}
                fill="none" stroke="#b8965a" strokeWidth={2} rx={2}
                style={{ pointerEvents: 'none' }}
              />
            )}
            {selected && isEditable && onResizeHandlePointerDown && (
              <>
                {[
                  { id: 'n', cx: px,       cy: ry,      cursor: 'ns-resize' },
                  { id: 's', cx: px,       cy: ry + ph, cursor: 'ns-resize' },
                  { id: 'w', cx: rx,       cy: py,      cursor: 'ew-resize' },
                  { id: 'e', cx: rx + pw,  cy: py,      cursor: 'ew-resize' },
                ].map(h => (
                  <circle key={h.id} cx={h.cx} cy={h.cy} r={5}
                    fill="#b8965a" stroke="white" strokeWidth={1.5}
                    style={{ cursor: h.cursor }}
                    onPointerDown={e => {
                      e.stopPropagation()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      onResizeHandlePointerDown(e, item, h.id)
                    }}
                  />
                ))}
              </>
            )}
          </g>
        )
      })}

      {/* Snap zone highlights — builder mode */}
      {mode === 'builder' && snapZones.map((zone, i) => {
        const zx = zone.absX * GRID - (zone.w * GRID) / 2
        const zy = zone.absY * GRID - (zone.h * GRID) / 2
        return (
          <rect
            key={`snap-${i}`}
            x={zx} y={zy}
            width={zone.w * GRID} height={zone.h * GRID}
            fill="rgba(42,157,153,0.25)"
            stroke="#2a9d99"
            strokeWidth={1.5}
            strokeDasharray="4,3"
            rx={2}
            style={{ pointerEvents: 'none' }}
          />
        )
      })}


      {/* Ghost while dragging */}
      {ghost && (() => {
        const gx = ghost.absX * GRID - (ghost.w * GRID) / 2
        const gy = ghost.absY * GRID - (ghost.h * GRID) / 2
        return (
          <rect
            x={gx} y={gy}
            width={ghost.w * GRID} height={ghost.h * GRID}
            fill={ghost.fill ?? '#888'} fillOpacity={0.45}
            stroke={ghost.stroke ?? '#aaa'} strokeWidth={1.5}
            strokeDasharray="4,3" rx={2}
            style={{ pointerEvents: 'none' }}
          />
        )
      })()}

      {/* Draw mode overlay — polygon in progress */}
      {isDrawMode && drawPoints.length > 0 && (() => {
        const pts = drawPoints.map(p => ({ x: p.gx * GRID, y: p.gy * GRID }))
        const cur = drawCursor ? { x: drawCursor.gx * GRID, y: drawCursor.gy * GRID } : null
        const allPts = cur ? [...pts, cur] : pts
        const fill = drawTool?.bg ?? '#8ac87a'
        const stroke = drawTool?.border ?? '#5a9850'

        return (
          <g style={{ pointerEvents: 'none' }}>
            {/* Preview area */}
            {allPts.length >= 3 && (
              <polygon
                points={allPts.map(p => `${p.x},${p.y}`).join(' ')}
                fill={fill}
                fillOpacity={0.4}
                stroke={stroke}
                strokeWidth={1.5}
                strokeDasharray="5,3"
              />
            )}
            {/* Edge line when only 2 pts + cursor */}
            {allPts.length === 2 && (
              <line
                x1={allPts[0].x} y1={allPts[0].y}
                x2={allPts[1].x} y2={allPts[1].y}
                stroke={stroke} strokeWidth={1.5} strokeDasharray="5,3"
              />
            )}
            {/* Guide line from last placed point to cursor */}
            {cur && pts.length >= 1 && (
              <line
                x1={pts[pts.length - 1].x} y1={pts[pts.length - 1].y}
                x2={cur.x} y2={cur.y}
                stroke={stroke} strokeWidth={1} strokeDasharray="4,4"
                opacity={0.6}
              />
            )}
            {/* Placed point markers */}
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill={stroke} stroke="white" strokeWidth={1.5} />
            ))}
          </g>
        )
      })()}

      {/* Draw mode cursor snap indicator */}
      {isDrawMode && drawCursor && (
        <circle
          cx={drawCursor.gx * GRID}
          cy={drawCursor.gy * GRID}
          r={Math.max(5, Math.round(16 / zoom))}
          fill={drawTool?.border ?? '#5a9850'}
          fillOpacity={0.7}
          stroke="white"
          strokeWidth={1.5}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}
