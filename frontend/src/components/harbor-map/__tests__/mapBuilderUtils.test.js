import { describe, it, expect } from 'vitest'
import {
  snapToGrid, snapRotation, rotateAndSnap,
  sortItemsForRender, groupOrigin, wallSnapPos, newId, GRID, COLS, ROWS,
  computeAbsPosition, snapBerthToPier
} from '../mapBuilderUtils.js'

const rect = { left: 0, top: 0 }

describe('snapToGrid', () => {
  it('snaps mouse position to nearest grid unit', () => {
    expect(snapToGrid(25, 25, rect)).toEqual({ gx: 1, gy: 1 })
    expect(snapToGrid(12, 12, rect)).toEqual({ gx: 1, gy: 1 }) // rounds
  })
  it('clamps to canvas bounds', () => {
    expect(snapToGrid(-10, -10, rect)).toEqual({ gx: 0, gy: 0 })
    expect(snapToGrid(9999, 9999, rect)).toEqual({ gx: COLS - 1, gy: ROWS - 1 })
  })
})

describe('snapRotation', () => {
  it('snaps to nearest 45°', () => {
    expect(snapRotation(0)).toBe(0)
    expect(snapRotation(22)).toBe(0)
    expect(snapRotation(23)).toBe(45)
    expect(snapRotation(90)).toBe(90)
    expect(snapRotation(359)).toBe(0)
  })
  it('always returns value in [0, 359]', () => {
    expect(snapRotation(360)).toBe(0)
    expect(snapRotation(405)).toBe(45)
  })
})

describe('rotateAndSnap', () => {
  it('square element at 0° unchanged', () => {
    expect(rotateAndSnap(2, 2, 3, 3, 0)).toEqual({ gx: 2, gy: 2, w: 3, h: 3 })
  })
  it('2×1 slip at 90° stays on whole-integer grid', () => {
    const result = rotateAndSnap(4, 4, 2, 1, 90)
    expect(Number.isInteger(result.gx)).toBe(true)
    expect(Number.isInteger(result.gy)).toBe(true)
    expect(Number.isInteger(result.w)).toBe(true)
    expect(Number.isInteger(result.h)).toBe(true)
  })
  it('2×1 slip rotated 90° swaps w and h', () => {
    const result = rotateAndSnap(4, 4, 2, 1, 90)
    expect(result.w).toBe(1)
    expect(result.h).toBe(2)
  })
  it('center is preserved after rotation within 1 grid unit', () => {
    const r = rotateAndSnap(4, 4, 2, 1, 90)
    // Original center: cx=5, cy=4.5. Snapping to integer grid may shift center
    // by up to 0.5 units — verify within 1 grid unit of original center.
    expect(Math.abs(r.gx + r.w / 2 - 5)).toBeLessThanOrEqual(1)
    expect(Math.abs(r.gy + r.h / 2 - 4.5)).toBeLessThanOrEqual(1)
  })
})

describe('sortItemsForRender', () => {
  it('sorts environment before infrastructure before berths before buildings', () => {
    const items = [
      { type: 'office' }, { type: 'berth' }, { type: 'water' }, { type: 'pier-h' }
    ]
    const sorted = sortItemsForRender(items)
    expect(sorted.map(i => i.type)).toEqual(['water', 'pier-h', 'berth', 'office'])
  })
  it('does not mutate original array', () => {
    const items = [{ type: 'office' }, { type: 'water' }]
    sortItemsForRender(items)
    expect(items[0].type).toBe('office')
  })
})

describe('groupOrigin', () => {
  it('returns min gx and min gy of all items', () => {
    const items = [
      { gx: 3, gy: 5 }, { gx: 1, gy: 7 }, { gx: 4, gy: 2 }
    ]
    expect(groupOrigin(items)).toEqual({ gx: 1, gy: 2 })
  })
  it('throws when called with empty array', () => {
    expect(() => groupOrigin([])).toThrow()
  })
})

describe('wallSnapPos', () => {
  const wall = { id: 'w1', gx: 2, gy: 3, w: 8, h: 1 }

  it('snaps berth to wall face when within 1 unit', () => {
    const result = wallSnapPos(4, 4, 2, [wall])
    expect(result).not.toBeNull()
    expect(result.gy).toBe(4)
    expect(result.snapWallId).toBe('w1')
    expect(Number.isInteger(result.gx)).toBe(true)
  })
  it('returns null when berth is too far from wall', () => {
    expect(wallSnapPos(4, 10, 2, [wall])).toBeNull()
  })
  it('returns null when berth is outside wall length', () => {
    expect(wallSnapPos(20, 4, 2, [wall])).toBeNull()
  })
  it('slotIndex is a non-negative integer', () => {
    const result = wallSnapPos(3, 4, 2, [wall])
    expect(result.slotIndex).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(result.slotIndex)).toBe(true)
  })
})

describe('newId', () => {
  it('returns an 8-character alphanumeric string', () => {
    expect(newId()).toMatch(/^[a-z0-9]{8}$/)
  })
  it('returns unique values on successive calls', () => {
    expect(newId()).not.toBe(newId())
  })
})

describe('computeAbsPosition', () => {
  it('returns pier center when local_x and local_y are both 0', () => {
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 0 }
    const berth = { local_x: 0, local_y: 0 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(10)
    expect(result.absY).toBeCloseTo(5)
  })

  it('offsets berth correctly when rotation is 0', () => {
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 0 }
    const berth = { local_x: 3, local_y: -2 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(13)
    expect(result.absY).toBeCloseTo(3)
  })

  it('rotates berth 90° correctly', () => {
    // At 90°: rotated_x = local_x*cos(90) - local_y*sin(90) = 0 - 0 = 0
    //          rotated_y = local_x*sin(90) + local_y*cos(90) = 3 + 0 = 3
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 90 }
    const berth = { local_x: 3, local_y: 0 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(10)
    expect(result.absY).toBeCloseTo(8)
  })

  it('rotates berth 180° flips both axes', () => {
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 180 }
    const berth = { local_x: 3, local_y: 2 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(7)
    expect(result.absY).toBeCloseTo(3)
  })
})

describe('snapBerthToPier', () => {
  const pier = { id: 1, canvas_x: 10, canvas_y: 5, canvas_w: 2, canvas_h: 8, rotation: 0 }

  it('returns null when mouse is far from any pier', () => {
    expect(snapBerthToPier(0, 0, [pier], 2, 1)).toBeNull()
  })

  it('snaps to port side (left edge) when mouse is near left edge', () => {
    // Pier left edge absX = canvas_x - canvas_w/2 = 10 - 1 = 9
    const result = snapBerthToPier(8, 5, [pier], 2, 1)
    expect(result).not.toBeNull()
    expect(result.pierId).toBe(1)
    expect(result.position_on_parent.side).toBe('port')
  })

  it('snaps to starboard side (right edge) when mouse is near right edge', () => {
    // Pier right edge absX = canvas_x + canvas_w/2 = 10 + 1 = 11
    const result = snapBerthToPier(12, 5, [pier], 2, 1)
    expect(result).not.toBeNull()
    expect(result.position_on_parent.side).toBe('starboard')
  })
})
