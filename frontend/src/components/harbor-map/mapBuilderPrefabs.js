// Draggable prefabs — docking structures and buildings only.
// Terrain (land, quay walls) is drawn with the click-to-draw terrain tools.
// Compound docks (comb, custom) are built via the toolbar dialogs and saved to custom prefabs.

// Pier materials — used by build dialogs and custom prefab storage
export const MATERIALS = {
  pontoon:  { label: 'Pontoon (Wood)',    bg: '#c8b97a', border: '#a89940' },
  concrete: { label: 'Concrete / Stone', bg: '#b0aaa2', border: '#888480' },
  steel:    { label: 'Steel',            bg: '#8a9aaa', border: '#607080' },
}

export const PREFABS = [
  // ── Single-unit docking structures ────────────────────────────────────────────
  { type: 'pontoon-spine-h',       label: 'Access Pontoon H (Wood)',   cat: 'Docking', w: 10, h: 2,   bg: '#c8b97a', border: '#a89940' },
  { type: 'pontoon-spine-v',       label: 'Access Pontoon V (Wood)',   cat: 'Docking', w: 2,  h: 10,  bg: '#c8b97a', border: '#a89940' },
  { type: 'pontoon-spine-h-stone', label: 'Access Pontoon H (Stone)',  cat: 'Docking', w: 10, h: 2,   bg: '#b0aaa2', border: '#888480' },
  { type: 'pontoon-spine-v-stone', label: 'Access Pontoon V (Stone)',  cat: 'Docking', w: 2,  h: 10,  bg: '#b0aaa2', border: '#888480' },
  { type: 'ramp',                  label: 'Launch Ramp',               cat: 'Docking', w: 2,  h: 3,   bg: '#c8c0aa', border: '#a8a088' },
  // ── Buildings — stored in MarinaMapConfig ─────────────────────────────────────
  { type: 'office',     label: 'Harbormaster',   cat: 'Buildings', w: 3, h: 2, bg: '#d4cec4', border: '#aaa89a' },
  { type: 'fuel-stn',   label: 'Fuel Station',   cat: 'Buildings', w: 2, h: 2, bg: '#e8daa8', border: '#c0b060' },
  { type: 'parking',    label: 'Parking',         cat: 'Buildings', w: 6, h: 4, bg: '#c8c4bc', border: '#a0a098' },
  { type: 'boatyard',   label: 'Boatyard',        cat: 'Buildings', w: 5, h: 4, bg: '#c4bca8', border: '#9a9280' },
  { type: 'chandlery',  label: 'Chandlery',       cat: 'Buildings', w: 2, h: 2, bg: '#d4cec0', border: '#b0a890' },
  { type: 'restaurant', label: 'Restaurant',      cat: 'Buildings', w: 3, h: 2, bg: '#d0dcc8', border: '#90a870' },
  { type: 'toilets',    label: 'Toilet Block',    cat: 'Buildings', w: 2, h: 2, bg: '#ccd4e0', border: '#98a8c0' },
  { type: 'security',   label: 'Security / Gate', cat: 'Buildings', w: 2, h: 2, bg: '#d8cce0', border: '#a888c0' },
]

export const PREFAB_BY_TYPE = Object.fromEntries(PREFABS.map(p => [p.type, p]))

// Maps prefab type → pier_type stored in DB (so specialized items keep their color)
export const PREFAB_TO_PIER_TYPE = {
  'pontoon-spine-h':       'pontoon',
  'pontoon-spine-v':       'pontoon',
  'pontoon-spine-h-stone': 'concrete',
  'pontoon-spine-v-stone': 'concrete',
  'gangway':               'gangway',
  'ramp':                  'ramp',
}

export const CATEGORIES = [...new Set(PREFABS.map(p => p.cat))]

// Terrain draw tools — appear in the map editor toolbar.
export const TERRAIN_TOOLS = [
  { type: 'land',      label: 'Land',      bg: '#8ac87a', border: '#5a9850', icon: '🌿' },
  { type: 'quay-wall', label: 'Quay Wall', bg: '#c0bcb4', border: '#8a8880', icon: '⬜' },
]

/**
 * Compute compound dock layout for the "Build Combo Dock" dialog.
 * Returns { w, h, components } ready to drop into PREFABS / customPrefabs.
 *
 * @param {number} numFingers  — number of finger piers
 * @param {number} fingerLen   — finger pier length in grid units
 * @param {number} berthBeamGU — berth beam in grid units (determines spacing between fingers)
 * @param {string} bg          — fill colour
 * @param {string} border      — stroke colour
 */
export function buildComboDockLayout({ numFingers, fingerLen, berthBeamGU, bg, border }) {
  const fingerW       = Math.max(1, berthBeamGU)     // scale finger width with berth beam
  const fingerSpacing = fingerW + 2 * berthBeamGU   // exact room for one berth each side
  const totalW        = (numFingers - 1) * fingerSpacing + 2  // 1 unit margin each side
  const spineH        = 2                            // whole number — spine is the access walkway
  const totalH        = spineH + fingerLen

  const components = [
    // Main access pontoon spanning the full width
    { pier_type: 'pontoon', ox: totalW / 2, oy: spineH / 2, canvas_w: totalW, canvas_h: spineH, bg, border },
    // Finger piers
    ...Array.from({ length: numFingers }, (_, i) => ({
      pier_type: 'pontoon',
      ox: 1 + i * fingerSpacing,
      oy: spineH + fingerLen / 2,
      canvas_w: fingerW,
      canvas_h: fingerLen,
      bg, border,
    })),
  ]

  return { w: totalW, h: totalH, components }
}
