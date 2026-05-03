// frontend/src/components/harbor-map/CanvasCore.jsx
import { useId } from 'react'
import { GRID, COLS, ROWS, CW, CH } from './mapBuilderUtils.js'

/**
 * CanvasCore — dumb SVG renderer.
 *
 * shapes[] item contract:
 * {
 *   id:       string,
 *   type:     string,
 *   absX:     number,   // center x in grid units
 *   absY:     number,   // center y in grid units
 *   w:        number,   // width in grid units
 *   h:        number,   // height in grid units
 *   rotation: number,   // degrees
 *   fill:     string,   // CSS color or var(--token)
 *   stroke:   string,
 *   label:    string,
 *   meta:     object,   // opaque controller data
 * }
 *
 * mode='builder': shows drag handles, snap zone overlays
 * mode='viewer':  pointer cursor on berths, no edit affordances
 */
export default function CanvasCore({
  shapes = [],
  mode = 'viewer',
  snapZones = [],       // [{absX, absY, w, h}] — highlight these in builder mode
  selectedIds = new Set(),
  onItemClick,          // (e, item) => void — viewer mode only, berth type only
  onItemPointerDown,    // (e, item) => void  — builder only
  onRotateHandlePointerDown, // (e, item) => void  — builder only
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasClick,
  onCanvasDragOver,
  onCanvasDrop,
  onCanvasDragLeave,
  ghost,                // { absX, absY, w, h, fill, stroke } | null — drag preview
}) {
  const uid = useId()
  const minorId = `ccMinorGrid${uid}`
  const majorId = `ccMajorGrid${uid}`
  return (
    <svg
      className="canvas-core"
      width={CW}
      height={CH}
      style={{ display: 'block', cursor: 'default', flexShrink: 0 }}
      onClick={onCanvasClick}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onDragLeave={onCanvasDragLeave}
    >
      {/* Grid */}
      <defs>
        <pattern id={minorId} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#1a3a55" strokeWidth={0.5} />
        </pattern>
        <pattern id={majorId} width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
          <rect width={GRID * 5} height={GRID * 5} fill={`url(#${minorId})`} />
          <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="#2a5a7a" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={CW} height={CH} fill="#0d2235" />
      <rect width={CW} height={CH} fill={`url(#${majorId})`} />

      {/* Shapes — rendered in array order (controller is responsible for layer ordering) */}
      {shapes.map(item => {
        const px = item.absX * GRID              // center in pixels
        const py = item.absY * GRID
        const pw = item.w * GRID
        const ph = item.h * GRID
        const rx = px - pw / 2                   // top-left in pixels
        const ry = py - ph / 2
        const selected = selectedIds.has(item.id)
        const isEditable = mode === 'builder'
        const isClickable = mode === 'viewer' && item.type === 'berth'

        return (
          <g
            key={item.id}
            transform={item.rotation ? `rotate(${item.rotation},${px},${py})` : undefined}
            onPointerDown={isEditable && onItemPointerDown ? e => onItemPointerDown(e, item) : undefined}
            onClick={isClickable && onItemClick ? e => onItemClick(e, item) : undefined}
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
                fontSize={10} fill="rgba(255,255,255,0.75)"
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
          </g>
        )
      })}

      {/* Snap zone highlights — builder mode only */}
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

      {/* Rotation handles — builder mode, selected items */}
      {mode === 'builder' && shapes
        .filter(i => selectedIds.has(i.id))
        .map(item => {
          const px = item.absX * GRID
          const handleY = (item.absY - item.h / 2) * GRID - 16
          return (
            <g
              key={`rot-${item.id}`}
              onPointerDown={onRotateHandlePointerDown ? e => { e.stopPropagation(); onRotateHandlePointerDown(e, item) } : undefined}
              style={{ cursor: 'grab' }}
            >
              <circle cx={px} cy={handleY} r={8} fill="#b8965a" stroke="white" strokeWidth={1.5} />
              <text x={px} y={handleY} textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fill="white" style={{ pointerEvents: 'none', userSelect: 'none' }}>↻</text>
            </g>
          )
        })
      }

      {/* Ghost element while dragging */}
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
    </svg>
  )
}
