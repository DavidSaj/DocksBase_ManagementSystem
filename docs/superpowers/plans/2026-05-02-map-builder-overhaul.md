# Map Builder Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing click-to-place `MapCreator` inside `MarinaMap.jsx` with a fully-featured drag-and-drop `MapBuilder` component that supports ghost previews, rotation, a parallel docking wall with snap, and custom prefab creation.

**Architecture:** Extract the builder into `MapBuilder.jsx` (owns all state) composed of three sub-components: `MapBuilderPalette` (left panel), `MapBuilderCanvas` (SVG centre), and `MapBuilderBerthPanel` (right panel). Pure utility functions live in `mapBuilderUtils.js`; prefab definitions in `mapBuilderPrefabs.js`.

**Tech Stack:** React 19 (functional components + hooks), SVG for canvas, HTML5 Drag-and-Drop API (palette/berths → canvas), mouse events (move/rotate within canvas), Vitest for utility tests.

**Worktree root:** `C:\Users\david\.config\superpowers\worktrees\DocksBase_ManagementSystem\feature-signup-onboarding\`

All paths below are relative to that root unless stated otherwise.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/components/harbor-map/mapBuilderUtils.js` | Pure functions: snap, rotate+snap, render sort, group origin, wall snap |
| Create | `frontend/src/components/harbor-map/mapBuilderPrefabs.js` | Prefab definitions array + lookup map |
| Create | `frontend/src/components/harbor-map/MapBuilderCanvas.jsx` | SVG canvas: two-tier grid, sorted element render, ghost, selection handles, rotation handle, wall resize handles, draw mode |
| Create | `frontend/src/components/harbor-map/MapBuilderPalette.jsx` | Left panel: categorised prefab cards, Draw Custom button, Group→Prefab button |
| Create | `frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx` | Right panel: unplaced/placed berth cards |
| Create | `frontend/src/components/harbor-map/MapBuilder.jsx` | Top-level: all state, wires three panels together |
| Modify | `frontend/src/screens/MarinaMap.jsx` | Remove `MapCreator` + constants, import `MapBuilder` |
| Create | `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js` | Vitest tests for all utility functions |

---

## Task 1: Install Vitest and create utility functions

**Files:**
- Create: `frontend/src/components/harbor-map/mapBuilderUtils.js`
- Create: `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js`
- Modify: `frontend/package.json` (add vitest)
- Create: `frontend/vite.config.js` (add test config)

- [ ] **Step 1: Install Vitest**

```bash
cd frontend && npm install --save-dev vitest @vitest/ui jsdom @testing-library/react
```

- [ ] **Step 2: Add test script and vitest config to vite.config.js**

Read `frontend/vite.config.js`. Add the `test` block:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

Add to `frontend/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `mapBuilderUtils.js`**

```js
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
```

- [ ] **Step 4: Write tests**

Create `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  snapToGrid, snapRotation, rotateAndSnap,
  sortItemsForRender, groupOrigin, wallSnapPos, GRID, COLS, ROWS
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
  it('center is preserved after rotation', () => {
    // center of 2×1 at (4,4) = (5, 4.5)
    const r = rotateAndSnap(4, 4, 2, 1, 90)
    // new center should be ~(5, 4.5), so gx + w/2 ≈ 5, gy + h/2 ≈ 4.5
    expect(r.gx + r.w / 2).toBeCloseTo(5, 0)
    expect(r.gy + r.h / 2).toBeCloseTo(4.5, 0)
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
})

describe('wallSnapPos', () => {
  const wall = { id: 'w1', gx: 2, gy: 3, w: 8, h: 1 }
  // docking face = gy + h = 4

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
```

- [ ] **Step 5: Run tests — expect all to pass**

```bash
cd frontend && npm test
```

Expected: all tests PASS (no failures)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/harbor-map/mapBuilderUtils.js \
        frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js \
        frontend/package.json frontend/vite.config.js
git commit -m "feat: add MapBuilder utility functions with Vitest tests"
```

---

## Task 2: Prefab definitions

**Files:**
- Create: `frontend/src/components/harbor-map/mapBuilderPrefabs.js`

- [ ] **Step 1: Create the file**

```js
// All prefab types available in the palette.
// T Dock is intentionally omitted.
// Sizes are ~40% smaller than the old PALETTE in MarinaMap.jsx.
export const PREFABS = [
  // ── Environment ──────────────────────────────────────────────────────────────
  { type: 'water',         label: 'Water',           cat: 'Environment', w: 3, h: 3, bg: '#0f3a56', border: '#1a5a80' },
  { type: 'shore',         label: 'Shore / Land',    cat: 'Environment', w: 5, h: 2, bg: '#d6cdb8', border: '#bfb7a4' },
  { type: 'quay',          label: 'Quay Wall',       cat: 'Environment', w: 6, h: 1, bg: '#8a7d68', border: '#6a5e50' },
  // ── Docking ──────────────────────────────────────────────────────────────────
  { type: 'parallel-wall', label: 'Par. Wall',       cat: 'Docking',     w: 8, h: 1, bg: '#3a7f5f', border: '#5aaf8f', parallelWall: true },
  { type: 'pier-v',        label: 'Pier (N–S)',      cat: 'Docking',     w: 1, h: 5, bg: '#c8b97a', border: '#a8994a' },
  { type: 'pier-h',        label: 'Pier (E–W)',      cat: 'Docking',     w: 5, h: 1, bg: '#c8b97a', border: '#a8994a' },
  { type: 'slip',          label: 'Berth Slip',      cat: 'Docking',     w: 2, h: 1, bg: '#c2ecce', border: '#38a860' },
  { type: 'slip-t',        label: 'Transient Slip',  cat: 'Docking',     w: 2, h: 1, bg: '#c6dcf5', border: '#3a7fc8' },
  { type: 'fuel-dock',     label: 'Fuel Dock',       cat: 'Docking',     w: 3, h: 1, bg: '#f6e7b0', border: '#c89020' },
  { type: 'gangway',       label: 'Gangway',         cat: 'Docking',     w: 1, h: 2, bg: '#c0af72', border: '#a8994a' },
  { type: 'ramp',          label: 'Launch Ramp',     cat: 'Docking',     w: 2, h: 3, bg: '#c8c0aa', border: '#a8a090' },
  // ── Shapes ───────────────────────────────────────────────────────────────────
  { type: 'tri-ul', label: 'Corner ◸', cat: 'Shapes', w: 3, h: 3, bg: '#8a8880', border: '#6a6860', clip: 'polygon(0 0, 100% 0, 0 100%)' },
  { type: 'tri-ur', label: 'Corner ◹', cat: 'Shapes', w: 3, h: 3, bg: '#8a8880', border: '#6a6860', clip: 'polygon(0 0, 100% 0, 100% 100%)' },
  { type: 'tri-bl', label: 'Corner ◺', cat: 'Shapes', w: 3, h: 3, bg: '#8a8880', border: '#6a6860', clip: 'polygon(0 0, 0 100%, 100% 100%)' },
  { type: 'tri-br', label: 'Corner ◻', cat: 'Shapes', w: 3, h: 3, bg: '#8a8880', border: '#6a6860', clip: 'polygon(100% 0, 0 100%, 100% 100%)' },
  { type: 'tri-up', label: 'Wedge ▲',  cat: 'Shapes', w: 3, h: 3, bg: '#8a8880', border: '#6a6860', clip: 'polygon(50% 0, 100% 100%, 0 100%)' },
  { type: 'tri-rt', label: 'Wedge ▶',  cat: 'Shapes', w: 3, h: 3, bg: '#8a8880', border: '#6a6860', clip: 'polygon(0 0, 100% 50%, 0 100%)' },
  // ── Buildings ────────────────────────────────────────────────────────────────
  { type: 'office',     label: 'Harbormaster',    cat: 'Buildings', w: 3, h: 2, bg: '#ccc4ae', border: '#aaa090' },
  { type: 'fuel-stn',   label: 'Fuel Station',    cat: 'Buildings', w: 2, h: 2, bg: '#ddd4aa', border: '#c0b070' },
  { type: 'parking',    label: 'Parking',          cat: 'Buildings', w: 6, h: 4, bg: '#c0bcb0', border: '#a0a098' },
  { type: 'boatyard',   label: 'Boatyard',         cat: 'Buildings', w: 5, h: 4, bg: '#b8b0a0', border: '#989080' },
  { type: 'chandlery',  label: 'Chandlery',        cat: 'Buildings', w: 2, h: 2, bg: '#cec8b8', border: '#b0aa98' },
  { type: 'restaurant', label: 'Restaurant',       cat: 'Buildings', w: 3, h: 2, bg: '#c8d8b8', border: '#88a870' },
  { type: 'toilets',    label: 'Toilet Block',     cat: 'Buildings', w: 2, h: 2, bg: '#d0d8e8', border: '#98a8c0' },
  { type: 'security',   label: 'Security / Gate',  cat: 'Buildings', w: 2, h: 2, bg: '#d8c8e0', border: '#a888c0' },
]

export const PREFAB_BY_TYPE = Object.fromEntries(PREFABS.map(p => [p.type, p]))

export const CATEGORIES = [...new Set(PREFABS.map(p => p.cat))]
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/mapBuilderPrefabs.js
git commit -m "feat: add MapBuilder prefab definitions (sizes reduced, T Dock removed)"
```

---

## Task 3: MapBuilderCanvas — grid and sorted item rendering

**Files:**
- Create: `frontend/src/components/harbor-map/MapBuilderCanvas.jsx`

- [ ] **Step 1: Create the canvas component**

This component renders the SVG canvas with a two-tier grid and all placed items sorted by layer. No interactivity yet — that comes in later tasks.

```jsx
import { GRID, COLS, ROWS, CW, CH, sortItemsForRender } from './mapBuilderUtils.js'

// Render a single item as an SVG rect (polygon items handled separately below)
function ItemRect({ item, selected }) {
  const x = item.gx * GRID
  const y = item.gy * GRID
  const w = item.w * GRID
  const h = item.h * GRID
  const cx = x + w / 2
  const cy = y + h / 2
  const bg   = item.bg   ?? item.tool?.bg   ?? '#888'
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
  ghost,           // { gx, gy, w, h, bg, border } | null — element being dragged in
  selectedIds,     // Set<string>
  drawMode,
  drawPoints,      // [{ gx, gy }] — polygon vertices placed so far
  hoverG,          // { gx, gy } — cursor grid pos during draw
  onCanvasClick,
  onCanvasMouseMove,
  onCanvasDragOver,
  onCanvasDrop,
  onCanvasDragLeave,
  onItemPointerDown,   // (e, item) — start move or select
  onRotateHandlePointerDown, // (e, item)
  onWallResizePointerDown,   // (e, item, side) side = 'left'|'right'
}) {
  const sorted = sortItemsForRender(items)
  const walls  = items.filter(i => i.type === 'parallel-wall')

  // For draw mode: is cursor near first vertex?
  const nearFirst = drawMode && drawPoints.length >= 3 && hoverG &&
    Math.abs(hoverG.gx - drawPoints[0].gx) <= 1 &&
    Math.abs(hoverG.gy - drawPoints[0].gy) <= 1

  return (
    <svg
      width={CW} height={CH}
      style={{ display: 'block', cursor: drawMode ? 'crosshair' : 'default', flexShrink: 0 }}
      onClick={onCanvasClick}
      onMouseMove={onCanvasMouseMove}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onDragLeave={onCanvasDragLeave}
    >
      {/* ── Two-tier grid ──────────────────────────────────────────────────── */}
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

      {/* ── Placed items (sorted by render layer) ──────────────────────────── */}
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

      {/* ── Parallel wall docking-face dash + resize handles ───────────────── */}
      {walls.map(wall => {
        const x = wall.gx * GRID
        const y = wall.gy * GRID
        const w = wall.w * GRID
        const faceY = y + wall.h * GRID
        const sel = selectedIds.has(wall.id)
        return (
          <g key={`wall-extras-${wall.id}`}>
            {/* Dashed line on docking face */}
            <line x1={x} y1={faceY} x2={x + w} y2={faceY}
              stroke="#5aaf8f" strokeWidth={1.5} strokeDasharray="4,3" />
            {/* Resize handles — only when selected */}
            {sel && (
              <>
                <rect x={x - 5} y={y + (wall.h * GRID / 2) - 5} width={10} height={10}
                  fill="#b8965a" stroke="white" strokeWidth={1} rx={2}
                  style={{ cursor: 'ew-resize' }}
                  onPointerDown={e => { e.stopPropagation(); onWallResizePointerDown(e, wall, 'left') }} />
                <rect x={x + w - 5} y={y + (wall.h * GRID / 2) - 5} width={10} height={10}
                  fill="#b8965a" stroke="white" strokeWidth={1} rx={2}
                  style={{ cursor: 'ew-resize' }}
                  onPointerDown={e => { e.stopPropagation(); onWallResizePointerDown(e, wall, 'right') }} />
                {/* Length label */}
                <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="#b8965a">
                  {wall.w} units
                </text>
              </>
            )}
          </g>
        )
      })}

      {/* ── Rotation handles (selected non-polygon items) ───────────────────── */}
      {sorted.filter(i => selectedIds.has(i.id) && i.shape !== 'polygon').map(item => {
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

      {/* ── Ghost element while dragging ────────────────────────────────────── */}
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

      {/* ── Draw mode: polygon in progress ──────────────────────────────────── */}
      {drawMode && drawPoints.length > 0 && (
        <>
          <polyline
            points={[...drawPoints, hoverG ?? drawPoints[drawPoints.length - 1]]
              .map(p => `${p.gx * GRID},${p.gy * GRID}`).join(' ')}
            fill="none" stroke="#b8965a" strokeWidth={1.5} strokeDasharray="5,3"
          />
          {/* Vertex dots */}
          {drawPoints.map((p, i) => (
            <circle key={i} cx={p.gx * GRID} cy={p.gy * GRID} r={i === 0 ? 6 : 3}
              fill={i === 0 ? (nearFirst ? '#b8965a' : 'white') : '#b8965a'}
              stroke="#b8965a" strokeWidth={1.5} />
          ))}
        </>
      )}
    </svg>
  )
}
```

- [ ] **Step 2: Manual verify — canvas renders**

Start dev server: `cd frontend && npm run dev`

Open Map Creator tab in MarinaMap. (MapBuilder.jsx doesn't exist yet — this file is just created, not wired in. No visible change yet.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilderCanvas.jsx
git commit -m "feat: add MapBuilderCanvas with two-tier grid and sorted SVG rendering"
```

---

## Task 4: MapBuilderPalette — left panel

**Files:**
- Create: `frontend/src/components/harbor-map/MapBuilderPalette.jsx`

- [ ] **Step 1: Create the file**

```jsx
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
  customPrefabs,  // [{ id, name, kind, ... }]
  selectedIds,    // Set<string> — for enabling Group→Prefab
  drawMode,
  onPrefabDragStart,    // (e, prefab) — HTML5 dragstart
  onStartDraw,
  onGroupToPrefab,
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

      {/* Custom prefabs section */}
      {customPrefabs.length > 0 && (
        <div>
          <div style={{ padding: '7px 10px 3px', fontSize: 10, color: '#5a7a9a', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
            Custom
          </div>
          {customPrefabs.map(cp => (
            <PrefabCard
              key={cp.id}
              prefab={{ type: cp.id, label: cp.name, w: 3, h: 3, bg: cp.fill ?? '#557', border: cp.stroke ?? '#779' }}
              onDragStart={onPrefabDragStart}
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilderPalette.jsx
git commit -m "feat: add MapBuilderPalette with draggable prefab cards"
```

---

## Task 5: MapBuilderBerthPanel — right panel

**Files:**
- Create: `frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx`

- [ ] **Step 1: Create the file**

```jsx
export default function MapBuilderBerthPanel({ berths, placedBerthIds, onBerthDragStart }) {
  // Sort: unplaced first, then placed (greyed out)
  const sorted = [...berths].sort((a, b) => {
    const aP = placedBerthIds.has(a.id)
    const bP = placedBerthIds.has(b.id)
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx
git commit -m "feat: add MapBuilderBerthPanel with placed/unplaced berth tracking"
```

---

## Task 6: Create MapBuilder.jsx and extract from MarinaMap.jsx

**Files:**
- Create: `frontend/src/components/harbor-map/MapBuilder.jsx`
- Modify: `frontend/src/screens/MarinaMap.jsx`

- [ ] **Step 1: Create `MapBuilder.jsx` skeleton with state and save logic**

```jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import useMapConfig from '../../hooks/useMapConfig.js'
import useBerths from '../../hooks/useBerths.js'
import MapBuilderCanvas from './MapBuilderCanvas.jsx'
import MapBuilderPalette from './MapBuilderPalette.jsx'
import MapBuilderBerthPanel from './MapBuilderBerthPanel.jsx'
import { newId } from './mapBuilderUtils.js'

export default function MapBuilder() {
  const { config, loading: cfgLoading, saveConfig } = useMapConfig()
  const { berths, loading: berthsLoading } = useBerths()

  const [items,        setItems]        = useState([])
  const [customPrefabs,setCustomPrefabs]= useState([])
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const [ghost,        setGhost]        = useState(null)
  const [drawMode,     setDrawMode]     = useState(false)
  const [drawPoints,   setDrawPoints]   = useState([])
  const [hoverG,       setHoverG]       = useState(null)
  const [saveStatus,   setSaveStatus]   = useState(null)  // null | 'saving' | 'saved' | 'error'
  const historyRef = useRef([])  // array of item snapshots for undo

  // Load saved state from config on mount
  useEffect(() => {
    if (!config) return
    if (config.custom_elements) setItems(config.custom_elements)
    if (config.custom_prefabs)  setCustomPrefabs(config.custom_prefabs)
  }, [config])

  // Snapshot for undo before any mutation
  const pushHistory = useCallback((prevItems) => {
    historyRef.current = [...historyRef.current.slice(-19), prevItems]
  }, [])

  const mutateItems = useCallback((updater) => {
    setItems(prev => {
      pushHistory(prev)
      return updater(prev)
    })
  }, [pushHistory])

  async function handleSave() {
    setSaveStatus('saving')
    const ok = await saveConfig({ ...(config ?? {}), custom_elements: items, custom_prefabs: customPrefabs })
    setSaveStatus(ok ? 'saved' : 'error')
    setTimeout(() => setSaveStatus(null), 2500)
  }

  function handleUndo() {
    if (!historyRef.current.length) return
    const prev = historyRef.current.pop()
    setItems(prev)
  }

  // Keyboard: Delete/Backspace removes selected; Ctrl+Z undoes
  useEffect(() => {
    function onKey(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        // Return placed berths to unplaced list (handled implicitly — placedBerthIds derived below)
        mutateItems(prev => prev.filter(i => !selectedIds.has(i.id)))
        setSelectedIds(new Set())
      }
      if (e.ctrlKey && e.key === 'z') handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, mutateItems])

  // Derive which berthIds are currently placed on canvas
  const placedBerthIds = new Set(items.filter(i => i.berthId).map(i => i.berthId))

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error!' : 'Save'

  if (cfgLoading || berthsLoading) {
    return <div style={{ padding: 40, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0a1829' }}>
      <MapBuilderPalette
        customPrefabs={customPrefabs}
        selectedIds={selectedIds}
        drawMode={drawMode}
        onPrefabDragStart={() => {}}    // Task 7
        onStartDraw={() => setDrawMode(true)}
        onGroupToPrefab={() => {}}      // Task 13
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', position: 'relative' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#0c1f3d', borderBottom: '1px solid #1e3a5f', alignItems: 'center' }}>
          {drawMode && (
            <span style={{ fontSize: 11, color: '#b8965a', marginRight: 8 }}>
              Drawing — click to add points. Click first point to close.
            </span>
          )}
          {drawMode && drawPoints.length >= 3 && (
            <button onClick={() => {}} style={{ fontSize: 11, padding: '3px 10px', background: '#1e3a5f', border: '1px solid #b8965a', borderRadius: 4, color: '#b8965a', cursor: 'pointer' }}>
              Close Shape
            </button>
          )}
          {drawMode && (
            <button onClick={() => { setDrawMode(false); setDrawPoints([]) }} style={{ fontSize: 11, padding: '3px 10px', background: 'none', border: '1px solid #3a5a7a', borderRadius: 4, color: '#7a9ab8', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={handleUndo} disabled={!historyRef.current.length} style={{ fontSize: 11, padding: '4px 12px', background: '#1e3a5f', border: '1px solid #2a5a7a', borderRadius: 4, color: '#c8d8e8', cursor: 'pointer' }}>
              Undo
            </button>
            <button onClick={handleSave} style={{ fontSize: 11, padding: '4px 14px', background: '#b8965a', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', fontWeight: 600 }}>
              {saveLabel}
            </button>
          </div>
        </div>

        <MapBuilderCanvas
          items={items}
          ghost={ghost}
          selectedIds={selectedIds}
          drawMode={drawMode}
          drawPoints={drawPoints}
          hoverG={hoverG}
          onCanvasClick={() => {}}           // Task 9
          onCanvasMouseMove={() => {}}       // Task 7
          onCanvasDragOver={() => {}}        // Task 7
          onCanvasDrop={() => {}}            // Task 7
          onCanvasDragLeave={() => {}}       // Task 7
          onItemPointerDown={() => {}}       // Task 9
          onRotateHandlePointerDown={() => {}}  // Task 10
          onWallResizePointerDown={() => {}}     // Task 11
        />
      </div>

      <MapBuilderBerthPanel
        berths={berths}
        placedBerthIds={placedBerthIds}
        onBerthDragStart={() => {}}     // Task 7
      />
    </div>
  )
}
```

- [ ] **Step 2: Modify `MarinaMap.jsx` — replace `MapCreator` with `MapBuilder`**

In `frontend/src/screens/MarinaMap.jsx`:

a) Add import at top:
```js
import MapBuilder from '../components/harbor-map/MapBuilder.jsx'
```

b) Delete everything from `// ── Map Creator constants ─────────` through the closing `}` of `function MapCreator()` (lines 8–343 approximately — the entire GRID/COLS/ROWS constants block, DRAW_PRESETS, PALETTE, and MapCreator function). Keep only the `// ── Main screen ───` section and below.

c) In the `tab === 'creator'` render, replace `<MapCreator />` with `<MapBuilder />`:
```jsx
{tab === 'creator' && <MapBuilder />}
```

- [ ] **Step 3: Manual verify**

`npm run dev` → open Marina Map → click "Map Creator" tab → should see the three-panel layout (navy left panel with prefab categories, dark canvas with grid, right berths panel). No interactions work yet.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx \
        frontend/src/screens/MarinaMap.jsx
git commit -m "feat: extract MapBuilder from MarinaMap, wire three-panel layout"
```

---

## Task 7: Drag & drop — ghost preview and placement

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Add drag payload ref and dragstart handlers**

Add to `MapBuilder.jsx` inside the component (after existing state):

```js
const dragPayloadRef = useRef(null)  // { kind: 'prefab'|'berth', prefab?, berth? }

function handlePrefabDragStart(e, prefab) {
  dragPayloadRef.current = { kind: 'prefab', prefab }
  e.dataTransfer.effectAllowed = 'copy'
  // Use a transparent 1x1 pixel as drag image to suppress browser ghost
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  e.dataTransfer.setDragImage(img, 0, 0)
}

function handleBerthDragStart(e, berth) {
  dragPayloadRef.current = { kind: 'berth', berth }
  e.dataTransfer.effectAllowed = 'copy'
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  e.dataTransfer.setDragImage(img, 0, 0)
}
```

- [ ] **Step 2: Add canvas drag event handlers**

Add a ref for the canvas SVG element and the canvas dragover/drop handlers:

```js
const canvasRef = useRef(null)

function getGhostFromPayload(payload, gx, gy) {
  if (payload.kind === 'prefab') {
    const p = payload.prefab
    return { gx, gy, w: p.w, h: p.h, bg: p.bg, border: p.border }
  }
  // berth
  return { gx, gy, w: 2, h: 1, bg: '#2a5f8f', border: '#5a8fbf' }
}

function handleCanvasDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  if (!dragPayloadRef.current) return
  const rect = e.currentTarget.getBoundingClientRect()
  const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
  const payload = dragPayloadRef.current
  const w = payload.kind === 'prefab' ? payload.prefab.w : 2
  const h = payload.kind === 'prefab' ? payload.prefab.h : 1

  // Wall snap for berths
  let snapPos = null
  if (payload.kind === 'berth') {
    const walls = items.filter(i => i.type === 'parallel-wall')
    snapPos = wallSnapPos(gx, gy, w, walls)
  }

  const pos = snapPos ?? { gx, gy }
  setGhost(getGhostFromPayload(payload, pos.gx, pos.gy))
}

function handleCanvasDrop(e) {
  e.preventDefault()
  if (!dragPayloadRef.current || !ghost) { dragPayloadRef.current = null; return }
  const payload = dragPayloadRef.current
  dragPayloadRef.current = null

  if (payload.kind === 'prefab') {
    const p = payload.prefab
    const newItem = {
      id: newId(), type: p.type, shape: 'rect',
      gx: ghost.gx, gy: ghost.gy, w: p.w, h: p.h,
      bg: p.bg, border: p.border, label: p.label,
      rotation: 0,
    }
    mutateItems(prev => [...prev, newItem])
    setSelectedIds(new Set([newItem.id]))
  } else {
    // berth
    const berth = payload.berth
    const walls = items.filter(i => i.type === 'parallel-wall')
    const snapPos = wallSnapPos(ghost.gx, ghost.gy, 2, walls)
    const newItem = {
      id: newId(), type: 'berth', shape: 'rect',
      gx: ghost.gx, gy: ghost.gy, w: 2, h: 1,
      bg: '#2a5f8f', border: '#5a8fbf', label: berth.code,
      rotation: 0,
      berthId: berth.id,
      ...(snapPos ? { snapWallId: snapPos.snapWallId, slotIndex: snapPos.slotIndex } : {}),
    }
    mutateItems(prev => [...prev, newItem])
    setSelectedIds(new Set([newItem.id]))
  }
  setGhost(null)
}

function handleCanvasDragLeave() {
  setGhost(null)
}
```

- [ ] **Step 3: Wire handlers into JSX — replace the `() => {}` placeholders**

In the `<MapBuilderPalette>` element:
```jsx
onPrefabDragStart={handlePrefabDragStart}
```

In the `<MapBuilderBerthPanel>` element:
```jsx
onBerthDragStart={handleBerthDragStart}
```

In the `<MapBuilderCanvas>` element:
```jsx
onCanvasDragOver={handleCanvasDragOver}
onCanvasDrop={handleCanvasDrop}
onCanvasDragLeave={handleCanvasDragLeave}
```

Also add imports at top of `MapBuilder.jsx`:
```js
import { snapToGrid, wallSnapPos, newId, sortItemsForRender } from './mapBuilderUtils.js'
```

- [ ] **Step 4: Manual verify**

`npm run dev` → Map Creator tab → drag "Water" prefab from palette → ghost blue/grey rectangle follows cursor snapped to grid → drop → element appears on canvas. Drag a berth from right panel → ghost appears → drop → berth appears, card in right panel turns grey with ✓.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: add drag-and-drop ghost preview and placement for prefabs and berths"
```

---

## Task 8: Selection, move, and keyboard delete

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Add move-drag state and handlers**

Add to `MapBuilder.jsx`:

```js
const moveRef = useRef(null)  // { itemId, startGx, startGy, startClientX, startClientY }

function handleItemPointerDown(e, item) {
  if (drawMode) return
  e.stopPropagation()
  e.currentTarget.setPointerCapture(e.pointerId)

  // Selection: Shift adds to set; plain click = single select
  if (e.shiftKey) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(item.id) ? next.delete(item.id) : next.add(item.id)
      return next
    })
  } else {
    setSelectedIds(new Set([item.id]))
  }

  // Start move tracking
  moveRef.current = {
    itemId: item.id,
    startGx: item.gx,
    startGy: item.gy,
    startClientX: e.clientX,
    startClientY: e.clientY,
    moved: false,
  }
}

function handleCanvasPointerMove(e) {
  if (drawMode && e.buttons === 0) {
    // draw mode hover
    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
    setHoverG({ gx, gy })
    return
  }
  if (!moveRef.current || e.buttons === 0) return
  const { itemId, startGx, startGy, startClientX, startClientY } = moveRef.current
  const dgx = Math.round((e.clientX - startClientX) / GRID)
  const dgy = Math.round((e.clientY - startClientY) / GRID)
  if (dgx === 0 && dgy === 0) return
  moveRef.current.moved = true

  setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item
    return {
      ...item,
      gx: Math.max(0, Math.min(COLS - item.w, startGx + dgx)),
      gy: Math.max(0, Math.min(ROWS - item.h, startGy + dgy)),
    }
  }))
}

function handleCanvasPointerUp(e) {
  if (moveRef.current?.moved) {
    // Commit move to history (history was not pushed during the live drag, push now)
    // We need the pre-move snapshot — store it on pointerdown
    // (simplified: just mark current state as committed)
  }
  moveRef.current = null
}
```

Update `handleItemPointerDown` to capture pre-move snapshot for undo:
```js
// At the start of handleItemPointerDown, capture snapshot before move
const snapshot = items  // closure over current items
moveRef.current = { ..., snapshot }
```

Then in `handleCanvasPointerUp`, if `moveRef.current?.moved`, push the snapshot:
```js
if (moveRef.current?.moved && moveRef.current.snapshot) {
  historyRef.current = [...historyRef.current.slice(-19), moveRef.current.snapshot]
}
moveRef.current = null
```

- [ ] **Step 2: Canvas click — deselect when clicking background**

```js
function handleCanvasClick(e) {
  if (drawMode) {
    // polygon vertex placement
    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
    if (drawPoints.length >= 3) {
      const f = drawPoints[0]
      if (Math.abs(gx - f.gx) <= 1 && Math.abs(gy - f.gy) <= 1) {
        closePolygon(); return
      }
    }
    setDrawPoints(prev => [...prev, { gx, gy }])
    return
  }
  // Deselect on canvas background click (not on items — items call stopPropagation)
  setSelectedIds(new Set())
}
```

(`closePolygon` is implemented in Task 14.)

- [ ] **Step 3: Wire handlers into canvas element**

Replace placeholders in `<MapBuilderCanvas>`:
```jsx
onCanvasClick={handleCanvasClick}
onCanvasMouseMove={handleCanvasPointerMove}
onItemPointerDown={handleItemPointerDown}
```

Also add `onPointerMove` and `onPointerUp` directly on the canvas SVG in `MapBuilderCanvas.jsx`. Update the `<svg>` element:
```jsx
<svg
  ...
  onPointerMove={onCanvasPointerMove}
  onPointerUp={onCanvasPointerUp}
>
```

And update `MapBuilderCanvas.jsx` props:
```jsx
onCanvasPointerMove,
onCanvasPointerUp,
```

Pass from `MapBuilder.jsx`:
```jsx
onCanvasPointerMove={handleCanvasPointerMove}
onCanvasPointerUp={handleCanvasPointerUp}
```

- [ ] **Step 4: Manual verify**

`npm run dev` → place a prefab → click it → gold border appears → drag it to a new position → it moves → press Delete → it disappears. Shift+click two items → both show gold borders.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx \
        frontend/src/components/harbor-map/MapBuilderCanvas.jsx
git commit -m "feat: selection, move-by-drag, keyboard delete for map elements"
```

---

## Task 9: Rotation handle — 45° snap + grid re-snap

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Add rotation drag handler**

Add to `MapBuilder.jsx`:

```js
const rotateRef = useRef(null)  // { item, centerX, centerY, startAngle }

function handleRotateHandlePointerDown(e, item) {
  e.stopPropagation()
  e.currentTarget.setPointerCapture(e.pointerId)
  const centerX = (item.gx + item.w / 2) * GRID
  const centerY = (item.gy + item.h / 2) * GRID
  rotateRef.current = { item: { ...item }, centerX, centerY, snapshot: items }
}

function handleRotatePointerMove(e) {
  if (!rotateRef.current) return
  const { centerX, centerY } = rotateRef.current
  const svgRect = document.querySelector('.mb-canvas').getBoundingClientRect()
  const mx = e.clientX - svgRect.left - centerX
  const my = e.clientY - svgRect.top  - centerY
  const rawDeg = (Math.atan2(my, mx) * 180) / Math.PI + 90
  const snapped = snapRotation(rawDeg)

  setItems(prev => prev.map(i => {
    if (i.id !== rotateRef.current.item.id) return i
    const { gx, gy, w, h } = rotateAndSnap(rotateRef.current.item.gx, rotateRef.current.item.gy, rotateRef.current.item.w, rotateRef.current.item.h, snapped)
    return { ...i, gx, gy, w, h, rotation: snapped }
  }))
}

function handleRotatePointerUp() {
  if (rotateRef.current) {
    historyRef.current = [...historyRef.current.slice(-19), rotateRef.current.snapshot]
  }
  rotateRef.current = null
}
```

- [ ] **Step 2: Add `className="mb-canvas"` to the SVG in `MapBuilderCanvas.jsx`**

```jsx
<svg className="mb-canvas" width={CW} height={CH} ...>
```

- [ ] **Step 3: Wire pointer move/up for rotation**

In `MapBuilder.jsx`, update `handleCanvasPointerMove` to also route rotation:

```js
function handleCanvasPointerMove(e) {
  if (rotateRef.current) { handleRotatePointerMove(e); return }
  // ... existing move + draw hover logic
}

function handleCanvasPointerUp(e) {
  if (rotateRef.current) { handleRotatePointerUp(); return }
  // ... existing move commit
}
```

Wire `onRotateHandlePointerDown` in canvas:
```jsx
onRotateHandlePointerDown={handleRotateHandlePointerDown}
```

- [ ] **Step 4: Manual verify**

Place a "Berth Slip" (2×1) → click it → gold circle appears above it → drag the circle → element rotates in 45° increments → after 90°, the element is a 1×2, still snapped cleanly to the grid (no half-unit offset). Element can then be dragged to a new position.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx \
        frontend/src/components/harbor-map/MapBuilderCanvas.jsx
git commit -m "feat: rotation handle with 45° snap and post-rotation grid re-snap"
```

---

## Task 10: Parallel wall resize handles

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Add wall resize handler**

```js
const wallResizeRef = useRef(null)  // { wall, side, startClientX, startW }

function handleWallResizePointerDown(e, wall, side) {
  e.stopPropagation()
  e.currentTarget.setPointerCapture(e.pointerId)
  wallResizeRef.current = { wall: { ...wall }, side, startClientX: e.clientX, startW: wall.w, snapshot: items }
}

function handleWallResizePointerMove(e) {
  if (!wallResizeRef.current) return
  const { wall, side, startClientX, startW } = wallResizeRef.current
  const dg = Math.round((e.clientX - startClientX) / GRID)
  const newW = Math.max(1, side === 'right' ? startW + dg : startW - dg)
  const newGx = side === 'left' ? wall.gx + (startW - newW) : wall.gx

  setItems(prev => prev.map(i => {
    if (i.id !== wall.id) return i
    return { ...i, gx: newGx, w: newW }
  }))
}

function handleWallResizePointerUp() {
  if (wallResizeRef.current) {
    historyRef.current = [...historyRef.current.slice(-19), wallResizeRef.current.snapshot]
  }
  wallResizeRef.current = null
}
```

- [ ] **Step 2: Route in pointer handlers**

```js
function handleCanvasPointerMove(e) {
  if (wallResizeRef.current) { handleWallResizePointerMove(e); return }
  if (rotateRef.current)     { handleRotatePointerMove(e); return }
  // ... existing
}
function handleCanvasPointerUp(e) {
  if (wallResizeRef.current) { handleWallResizePointerUp(); return }
  if (rotateRef.current)     { handleRotatePointerUp(); return }
  // ... existing
}
```

Wire the prop:
```jsx
onWallResizePointerDown={handleWallResizePointerDown}
```

- [ ] **Step 3: Manual verify**

Drag "Par. Wall" onto canvas → click it → gold squares at each end → drag right square to the right → wall extends, label shows updated unit count → drag left square → wall shrinks from left side, `gx` adjusts correctly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: parallel wall resize handles with live length label"
```

---

## Task 11: Berth snap to parallel wall

Wall snap is already computed in `handleCanvasDragOver` and `handleCanvasDrop` via `wallSnapPos`. This task verifies it works end-to-end and adds visual feedback.

- [ ] **Step 1: Verify wall snap is active**

`npm run dev` → place a "Par. Wall" → drag a berth from the right panel over the bottom edge of the wall (within 1 grid unit) → ghost should jump to snap to the wall face at 2-unit-aligned slot positions → drop → berth appears flush with wall.

- [ ] **Step 2: Add snap indicator to ghost**

In `handleCanvasDragOver`, when wall snap is active, give the ghost a green border:
```js
const snapActive = payload.kind === 'berth' && !!snapPos
setGhost({
  ...getGhostFromPayload(payload, pos.gx, pos.gy),
  border: snapActive ? '#38a860' : undefined,
})
```

- [ ] **Step 3: Verify berths move with wall**

Select and drag a placed wall that has snapped berths → berths should NOT move with the wall (they are independent items). This is acceptable per spec — wall-linked berths re-snap on the next drag. (Note for future: if berth-follows-wall is desired, store `snapWallId` and apply offset on wall move.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: berth wall-snap visual feedback with green ghost border"
```

---

## Task 12: Group → Prefab (Flow B)

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Add group-to-prefab handler**

```js
function handleGroupToPrefab() {
  if (selectedIds.size < 2) return
  const selected = items.filter(i => selectedIds.has(i.id))
  const name = window.prompt('Prefab name:', 'My Prefab')
  if (!name) return

  const origin = groupOrigin(selected)
  const elements = selected.map(i => ({ ...i, gx: i.gx - origin.gx, gy: i.gy - origin.gy }))

  const newPrefab = { id: newId(), name, kind: 'group', elements }
  setCustomPrefabs(prev => [...prev, newPrefab])

  // Remove grouped items from canvas
  mutateItems(prev => prev.filter(i => !selectedIds.has(i.id)))
  setSelectedIds(new Set())
}
```

- [ ] **Step 2: Wire group handler**

```jsx
onGroupToPrefab={handleGroupToPrefab}
```

- [ ] **Step 3: Handle dropping a custom group prefab**

In `handlePrefabDragStart`, custom prefabs are passed with type = their id. In `handleCanvasDrop`, detect when `payload.prefab.type` matches a custom prefab id:

```js
// At start of the 'prefab' case in handleCanvasDrop:
const customPrefab = customPrefabs.find(cp => cp.id === payload.prefab.type)
if (customPrefab) {
  if (customPrefab.kind === 'group') {
    const newItems = customPrefab.elements.map(el => ({
      ...el, id: newId(),
      gx: ghost.gx + el.gx,
      gy: ghost.gy + el.gy,
    }))
    mutateItems(prev => [...prev, ...newItems])
    setSelectedIds(new Set(newItems.map(i => i.id)))
    setGhost(null)
    return
  }
  // polygon custom prefab handled in Task 13
}
```

- [ ] **Step 4: Manual verify**

Place two prefabs → Shift+click both → "Group → Prefab" button becomes active → click it → prompt for name → enter "Test Group" → both items disappear from canvas → "Test Group" appears in Custom palette section → drag it back → both items reappear at correct relative positions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: Group → Prefab (Flow B) — multi-select, name, save, re-place"
```

---

## Task 13: Draw polygon → save as prefab (Flow A)

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Add closePolygon function**

```js
function closePolygon() {
  if (drawPoints.length < 3) return
  const name = window.prompt('Prefab name:', 'Custom Shape')
  if (!name) { setDrawMode(false); setDrawPoints([]); return }

  const fill = window.prompt('Fill colour (hex):', '#3a5f8f') || '#3a5f8f'
  const stroke = '#2a4f7f'

  // Normalise points relative to bounding-box origin
  const origin = groupOrigin(drawPoints.map(p => ({ gx: p.gx, gy: p.gy })))
  const relPoints = drawPoints.map(p => ({ gx: p.gx - origin.gx, gy: p.gy - origin.gy }))

  const newPrefab = { id: newId(), name, kind: 'polygon', points: relPoints, fill, stroke }
  setCustomPrefabs(prev => [...prev, newPrefab])
  setDrawMode(false)
  setDrawPoints([])
}
```

- [ ] **Step 2: Wire "Close Shape" button in toolbar**

Replace the `onClick={() => {}}` on the Close Shape button:
```jsx
<button onClick={closePolygon} ...>Close Shape</button>
```

- [ ] **Step 3: Handle canvas click in draw mode** (already partially in `handleCanvasClick`)

Ensure `closePolygon` is referenced correctly — no changes needed if it is in the same component scope.

- [ ] **Step 4: Handle dropping a polygon custom prefab**

In `handleCanvasDrop`, after the group branch add:
```js
if (customPrefab.kind === 'polygon') {
  const newItem = {
    id: newId(), type: customPrefab.id, shape: 'polygon',
    points: customPrefab.points.map(p => ({ gx: ghost.gx + p.gx, gy: ghost.gy + p.gy })),
    fill: customPrefab.fill, stroke: customPrefab.stroke,
    label: customPrefab.name, rotation: 0,
    customPrefabId: customPrefab.id,
  }
  mutateItems(prev => [...prev, newItem])
  setSelectedIds(new Set([newItem.id]))
  setGhost(null)
  return
}
```

- [ ] **Step 5: Manual verify**

Click "Draw Custom" → cursor becomes crosshair → click 4 points on canvas → "Close Shape" button active → click it → prompt for name and colour → custom shape appears in Custom palette → drag it back → polygon placed at cursor position.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: draw polygon and save as custom prefab (Flow A)"
```

---

## Task 14: Persist custom prefabs + final save wiring

**Files:**
- Modify: `frontend/src/hooks/useMapConfig.js`
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Read `useMapConfig.js` and verify `saveConfig` sends arbitrary keys**

```bash
cat frontend/src/hooks/useMapConfig.js
```

The hook does `PUT /map/config/` with `{ config: newConfig }`. Since `handleSave` in `MapBuilder.jsx` already spreads `customPrefabs` into the config object:
```js
saveConfig({ ...(config ?? {}), custom_elements: items, custom_prefabs: customPrefabs })
```
no changes to the hook are needed.

- [ ] **Step 2: Verify custom prefabs survive a page reload**

`npm run dev` → create a custom prefab → click Save → reload page → open Map Creator → custom prefab should still appear in Custom palette (loaded from `config.custom_prefabs` in the `useEffect`).

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "verify: custom prefabs persist via existing useMapConfig hook"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Two-tier grid (minor + major) | Task 3 |
| Prefab sizes reduced ~40% | Task 2 |
| T Dock removed | Task 2 |
| Three-panel layout | Task 6 |
| Drag ghost preview (prefabs) | Task 7 |
| Drag ghost preview (berths) | Task 7 |
| Placed berth removed from list | Task 7 (placedBerthIds derived set) |
| SVG render order | Task 3 (sortItemsForRender) |
| Selection (single + multi) | Task 8 |
| Move after drop | Task 8 |
| Keyboard Delete | Task 6 (useEffect keydown) |
| Rotation handle + 45° snap | Task 9 |
| Non-square rotation grid re-snap | Task 9 (rotateAndSnap) |
| Parallel wall prefab | Task 2 + Task 3 (docking face dash) |
| Wall resize handles | Task 10 |
| Berth snap to wall | Task 11 |
| Group → Prefab (Flow B) | Task 12 |
| Group origin = min(gx)/min(gy) | Task 12 (groupOrigin util) |
| Draw polygon → Prefab (Flow A) | Task 13 |
| Custom prefab persistence | Task 14 |
| Undo (20 steps) | Task 6 (historyRef + mutateItems + Ctrl+Z) |
| Extract MapBuilder from MarinaMap | Task 6 |

All spec requirements are covered. No gaps found.
