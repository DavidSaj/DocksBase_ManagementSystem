export const GRID = 24
export const COLS = 34
export const ROWS = 22
export const CW = COLS * GRID   // 816
export const CH = ROWS * GRID   // 528

// Convert mouse client coords + canvas DOMRect → snapped grid position
export function snapToGrid(clientX, clientY, canvasRect) {
  const gx = Math.round((clientX - canvasRect.left) / GRID)
  const gy = Math.round((clientY - canvasRect.top) / GRID)
  return {
    gx: Math.max(0, Math.min(COLS - 1, gx)),
    gy: Math.max(0, Math.min(ROWS - 1, gy)),
  }
}

// Snap an angle (degrees) to nearest 45° increment, result in [0, 359]
export function snapRotation(deg) {
  return ((Math.round(deg / 45) * 45) % 360 + 360) % 360
}

// After rotating a gx/gy/w/h element by `deg` degrees around its pixel center,
// compute the new axis-aligned bounding box and snap top-left to whole grid integers.
// This prevents non-square elements (e.g. 2×1 slips) from landing at 0.5-unit offsets.
export function rotateAndSnap(gx, gy, w, h, deg) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const newW = w * cos + h * sin
  const newH = w * sin + h * cos
  const cx = gx + w / 2
  const cy = gy + h / 2
  return {
    gx: Math.max(0, Math.round(cx - newW / 2)),
    gy: Math.max(0, Math.round(cy - newH / 2)),
    w: Math.round(newW),
    h: Math.round(newH),
  }
}

// SVG renders in document order — last element is on top, no z-index.
// Sort items so environment is drawn first, selection handles always last.
const LAYER = (type) => {
  if (['water', 'shore'].includes(type))                      return 0
  if (['quay', 'parallel-wall', 'pier-v', 'pier-h'].includes(type)) return 1
  if (['tri-ul','tri-ur','tri-bl','tri-br','tri-up','tri-rt'].includes(type)) return 1
  if (type === 'berth')                                       return 2
  if (['slip','slip-t','fuel-dock','gangway','ramp'].includes(type)) return 2
  if (['office','fuel-stn','parking','boatyard','chandlery','restaurant','toilets','security'].includes(type)) return 3
  return 4 // custom, polygon
}

export function sortItemsForRender(items) {
  return [...items].sort((a, b) => LAYER(a.type) - LAYER(b.type))
}

// Group origin is Math.min of all gx and Math.min of all gy — NOT centroid.
// This ensures relative offsets are non-negative integers that snap cleanly.
export function groupOrigin(items) {
  if (items.length === 0) throw new Error('groupOrigin requires at least one item')
  return {
    gx: Math.min(...items.map(i => i.gx)),
    gy: Math.min(...items.map(i => i.gy)),
  }
}

// Check whether a berth ghost should snap to a parallel wall face.
// Snap priority: wall face > free grid.
// Returns snap position object or null.
export function wallSnapPos(ghostGx, ghostGy, ghostW, walls) {
  for (const wall of walls) {
    const faceY = wall.gy + wall.h  // bottom edge of horizontal wall = docking face
    const inRange = ghostGy >= faceY - 1 && ghostGy <= faceY + 1
    const inLength = ghostGx >= wall.gx - 1 && ghostGx <= wall.gx + wall.w
    if (inRange && inLength) {
      const relGx = Math.max(0, Math.min(wall.w - ghostW, ghostGx - wall.gx))
      const slotIndex = Math.round(relGx / 2)
      return {
        gx: wall.gx + slotIndex * 2,
        gy: faceY,
        snapWallId: wall.id,
        slotIndex,
      }
    }
  }
  return null
}

// Generate a unique id for new items
export function newId() {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Compute a berth's absolute canvas position (center, in grid units)
 * from its parent pier and local offset. Uses center-origin rotation math.
 * IMPORTANT: pier.canvas_x/y must be the pier's center, not its top-left.
 */
export function computeAbsPosition(pier, berth) {
  const θ = (pier.rotation * Math.PI) / 180
  const cos = Math.cos(θ)
  const sin = Math.sin(θ)
  const rx = berth.local_x * cos - berth.local_y * sin
  const ry = berth.local_x * sin + berth.local_y * cos
  return {
    absX: pier.canvas_x + rx,
    absY: pier.canvas_y + ry,
  }
}

// Snap radius in grid units — how close the mouse must be to a pier edge to trigger snap
const SNAP_RADIUS = 2

/**
 * Determine if a dragged berth should snap to a pier edge.
 * Returns snap data or null.
 * @param {number} mouseGx - Current drag position x in grid units
 * @param {number} mouseGy - Current drag position y in grid units
 * @param {Array}  piers   - Array of pier objects with canvas_x/y/w/h/rotation
 * @param {number} berthW  - Berth width in grid units
 * @param {number} berthH  - Berth height in grid units
 * @returns {{ pierId, local_x, local_y, absX, absY, position_on_parent } | null}
 */
export function snapBerthToPier(mouseGx, mouseGy, piers, berthW, berthH) {
  // NOTE: Only valid for axis-aligned piers (rotation === 0).
  // Rotated-pier snap requires transforming mouse coords into the pier's local frame first.
  for (const pier of piers) {
    const { canvas_x: cx, canvas_y: cy, canvas_w: pw, canvas_h: ph } = pier
    const halfW = pw / 2
    const halfH = ph / 2

    const leftEdgeX  = cx - halfW
    const rightEdgeX = cx + halfW

    const withinHeight = mouseGy >= cy - halfH - SNAP_RADIUS && mouseGy <= cy + halfH + SNAP_RADIUS

    if (withinHeight) {
      if (Math.abs(mouseGx - leftEdgeX) <= SNAP_RADIUS) {
        const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
        const local_x = leftEdgeX - berthW / 2 - cx
        const local_y = clampedY - cy
        const slot_index = Math.floor((clampedY - (cy - halfH)) / berthH)
        return {
          pierId: pier.id,
          local_x,
          local_y,
          absX: leftEdgeX - berthW / 2,
          absY: clampedY,
          position_on_parent: { side: 'port', slot_index },
        }
      }
      if (Math.abs(mouseGx - rightEdgeX) <= SNAP_RADIUS) {
        const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
        const local_x = rightEdgeX + berthW / 2 - cx
        const local_y = clampedY - cy
        const slot_index = Math.floor((clampedY - (cy - halfH)) / berthH)
        return {
          pierId: pier.id,
          local_x,
          local_y,
          absX: rightEdgeX + berthW / 2,
          absY: clampedY,
          position_on_parent: { side: 'starboard', slot_index },
        }
      }
    }
  }
  return null
}
