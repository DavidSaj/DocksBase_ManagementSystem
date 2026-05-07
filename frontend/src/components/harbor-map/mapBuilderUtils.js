export const METERS_PER_GU = 2  // 1 grid unit = 2 real metres — used for berth visual scaling

export const GRID = 32
export const COLS = 500
export const ROWS = 350
export const CW = COLS * GRID   // 16000
export const CH = ROWS * GRID   // 11200

// Convert mouse client coords + canvas DOMRect → snapped grid position.
// Pass zoom so that CSS-scaled canvas coords map correctly to grid units.
export function snapToGrid(clientX, clientY, canvasRect, zoom = 1) {
  const snapGrid = zoom < 0.07 ? 5 : zoom < 0.15 ? 2 : 1
  const gx = Math.round((clientX - canvasRect.left) / zoom / GRID / snapGrid) * snapGrid
  const gy = Math.round((clientY - canvasRect.top)  / zoom / GRID / snapGrid) * snapGrid
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
// Sort items so terrain polygons are at the bottom, then piers, then berths, then buildings.
const LAYER = (type) => {
  if (['land', 'quay-wall', 'water', 'shore'].includes(type))  return 0  // terrain
  if (['parallel-wall', 'quay', 'pier-v', 'pier-h', 'pier'].includes(type)) return 1
  if (['tri-ul','tri-ur','tri-bl','tri-br','tri-up','tri-rt'].includes(type)) return 1
  if (type === 'berth')                                         return 2
  if (['slip','slip-t','fuel-dock','gangway','ramp'].includes(type)) return 2
  if (['office','fuel-stn','parking','boatyard','chandlery','restaurant','toilets','security'].includes(type)) return 3
  return 4
}

export function sortItemsForRender(items) {
  return [...items].sort((a, b) => {
    // isPolygon terrain always renders at layer 0 regardless of type name
    const la = a.isPolygon ? 0 : LAYER(a.type)
    const lb = b.isPolygon ? 0 : LAYER(b.type)
    return la - lb
  })
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

// Snap a dragged pier to adjacent piers' edges (axis-aligned only).
// Returns { x, y } snapped center position, or null if nothing is close enough.
export function snapPierToPier(dragX, dragY, dragW, dragH, otherPiers, snapRadius = 1.5) {
  const dL = dragX - dragW / 2, dR = dragX + dragW / 2
  const dT = dragY - dragH / 2, dB = dragY + dragH / 2
  let snapX = null, snapY = null

  for (const p of otherPiers) {
    const pL = p.canvas_x - p.canvas_w / 2, pR = p.canvas_x + p.canvas_w / 2
    const pT = p.canvas_y - p.canvas_h / 2, pB = p.canvas_y + p.canvas_h / 2

    if (snapX === null) {
      if (Math.abs(dR - pL)  <= snapRadius) snapX = dragX + (pL - dR)
      else if (Math.abs(dL - pR)  <= snapRadius) snapX = dragX + (pR - dL)
      else if (Math.abs(dL - pL)  <= snapRadius) snapX = dragX + (pL - dL)
      else if (Math.abs(dR - pR)  <= snapRadius) snapX = dragX + (pR - dR)
    }
    if (snapY === null) {
      if (Math.abs(dB - pT)  <= snapRadius) snapY = dragY + (pT - dB)
      else if (Math.abs(dT - pB)  <= snapRadius) snapY = dragY + (pB - dT)
      else if (Math.abs(dT - pT)  <= snapRadius) snapY = dragY + (pT - dT)
      else if (Math.abs(dB - pB)  <= snapRadius) snapY = dragY + (pB - dB)
    }
  }
  if (snapX === null && snapY === null) return null
  return { x: snapX ?? dragX, y: snapY ?? dragY }
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
 * Choose berth canvas dimensions based on the pier orientation and, when available,
 * the berth's physical length_m / beam_m so bigger boats appear as bigger blocks.
 *
 * Beside a vertical pier: beam is horizontal, length is vertical.
 * Beside a horizontal pier: length is horizontal, beam is vertical.
 */
export function berthCanvasDims(berth, pier) {
  const isVertical = pier.canvas_h >= pier.canvas_w
  if (berth?.length_m) {
    const lenGU  = Math.max(2, Math.round(berth.length_m  / METERS_PER_GU))
    const beamM  = berth.beam_m ?? berth.max_beam_m ?? 3
    const beamGU = Math.max(1, Math.round(beamM / METERS_PER_GU))
    return isVertical
      ? { berthW: beamGU, berthH: lenGU }
      : { berthW: lenGU,  berthH: beamGU }
  }
  return isVertical ? { berthW: 1, berthH: 2 } : { berthW: 2, berthH: 1 }
}

// Keep the pier-orientation-only version for drop-ghost previews (no berth object available)
export function berthDimsForPier(pier) {
  return pier.canvas_h >= pier.canvas_w
    ? { berthW: 1, berthH: 2 }
    : { berthW: 2, berthH: 1 }
}

/**
 * Determine if a dragged berth should snap to a pier edge.
 * Returns snap data or null.
 * Automatically picks berth dimensions based on pier orientation.
 * @param {number} mouseGx - Current drag position x in grid units
 * @param {number} mouseGy - Current drag position y in grid units
 * @param {Array}  piers   - Array of pier objects with canvas_x/y/w/h/rotation
 * @returns {{ pierId, local_x, local_y, absX, absY, berthW, berthH, position_on_parent } | null}
 */
export function snapBerthToPier(mouseGx, mouseGy, piers, berth = null) {
  for (const pier of piers) {
    const { canvas_x: cx, canvas_y: cy, canvas_w: pw, canvas_h: ph } = pier
    const halfW = pw / 2
    const halfH = ph / 2
    const { berthW, berthH } = berth ? berthCanvasDims(berth, pier) : berthDimsForPier(pier)

    if (ph >= pw) {
      // Vertical pier — snap to left or right edge
      const leftEdgeX  = cx - halfW
      const rightEdgeX = cx + halfW
      const withinHeight = mouseGy >= cy - halfH - SNAP_RADIUS && mouseGy <= cy + halfH + SNAP_RADIUS

      if (withinHeight) {
        if (Math.abs(mouseGx - leftEdgeX) <= SNAP_RADIUS) {
          const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
          return {
            pierId: pier.id,
            local_x: leftEdgeX - berthW / 2 - cx,
            local_y: clampedY - cy,
            absX: leftEdgeX - berthW / 2,
            absY: clampedY,
            berthW, berthH,
            position_on_parent: { side: 'port', slot_index: Math.floor((clampedY - (cy - halfH)) / berthH) },
          }
        }
        if (Math.abs(mouseGx - rightEdgeX) <= SNAP_RADIUS) {
          const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
          return {
            pierId: pier.id,
            local_x: rightEdgeX + berthW / 2 - cx,
            local_y: clampedY - cy,
            absX: rightEdgeX + berthW / 2,
            absY: clampedY,
            berthW, berthH,
            position_on_parent: { side: 'starboard', slot_index: Math.floor((clampedY - (cy - halfH)) / berthH) },
          }
        }
      }
    } else {
      // Horizontal pier — snap to top or bottom edge
      const topEdgeY    = cy - halfH
      const bottomEdgeY = cy + halfH
      const withinWidth = mouseGx >= cx - halfW - SNAP_RADIUS && mouseGx <= cx + halfW + SNAP_RADIUS

      if (withinWidth) {
        if (Math.abs(mouseGy - topEdgeY) <= SNAP_RADIUS) {
          const clampedX = Math.max(cx - halfW + berthW / 2, Math.min(cx + halfW - berthW / 2, mouseGx))
          return {
            pierId: pier.id,
            local_x: clampedX - cx,
            local_y: topEdgeY - berthH / 2 - cy,
            absX: clampedX,
            absY: topEdgeY - berthH / 2,
            berthW, berthH,
            position_on_parent: { side: 'port', slot_index: Math.floor((clampedX - (cx - halfW)) / berthW) },
          }
        }
        if (Math.abs(mouseGy - bottomEdgeY) <= SNAP_RADIUS) {
          const clampedX = Math.max(cx - halfW + berthW / 2, Math.min(cx + halfW - berthW / 2, mouseGx))
          return {
            pierId: pier.id,
            local_x: clampedX - cx,
            local_y: bottomEdgeY + berthH / 2 - cy,
            absX: clampedX,
            absY: bottomEdgeY + berthH / 2,
            berthW, berthH,
            position_on_parent: { side: 'starboard', slot_index: Math.floor((clampedX - (cx - halfW)) / berthW) },
          }
        }
      }
    }
  }
  return null
}
