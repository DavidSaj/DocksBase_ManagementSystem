// Draggable prefabs — docking structures and buildings only.
// Terrain (land, quay walls) is drawn with the click-to-draw terrain tools.
// Compound docks (comb, custom) are built via the toolbar dialogs and saved to custom prefabs.

// Pier materials — used by build dialogs and custom prefab storage
export const MATERIALS = {
  pontoon:  { label: 'Pontoon (Wood)',    bg: '#c8b97a', border: '#a89940' },
  concrete: { label: 'Concrete / Stone', bg: '#b0aaa2', border: '#888480' },
  steel:    { label: 'Steel',            bg: '#8a9aaa', border: '#607080' },
}

// Default sizes are in grid units (METERS_PER_GU = 2, so 1 GU = 2 metres).
// Tuned to real-world marina footprints so docks read as docks (40m+ spines),
// parking lots and the boatyard dwarf service kiosks, and the restaurant is a
// real building footprint instead of a 6m shed. Everything is still resizable
// after placement.
export const PREFABS = [
  // ── Single-unit docking structures ────────────────────────────────────────────
  // Spines ~40 m × 4–5 m. The narrow dim (~2 GU) keeps the walkway visually
  // pier-like while remaining wide enough for the snap grid.
  { type: 'pontoon-spine-h',       label: 'Access Pontoon H (Wood)',   cat: 'Docking', w: 20, h: 2,   bg: '#c8b97a', border: '#a89940' },
  { type: 'pontoon-spine-v',       label: 'Access Pontoon V (Wood)',   cat: 'Docking', w: 2,  h: 20,  bg: '#c8b97a', border: '#a89940' },
  { type: 'pontoon-spine-h-stone', label: 'Access Pontoon H (Stone)',  cat: 'Docking', w: 20, h: 2,   bg: '#b0aaa2', border: '#888480' },
  { type: 'pontoon-spine-v-stone', label: 'Access Pontoon V (Stone)',  cat: 'Docking', w: 2,  h: 20,  bg: '#b0aaa2', border: '#888480' },
  // Launch ramp ~6m × 12m
  { type: 'ramp',                  label: 'Launch Ramp',               cat: 'Docking', w: 3,  h: 6,   bg: '#c8c0aa', border: '#a8a088' },
  // ── Buildings — stored in MarinaMapConfig ─────────────────────────────────────
  // Footprints chosen so each entity reads at the correct relative scale.
  { type: 'office',     label: 'Harbormaster',   cat: 'Buildings', w: 4,  h: 3,  bg: '#d4cec4', border: '#aaa89a' },  // ~8m × 6m
  { type: 'fuel-stn',   label: 'Fuel Station',   cat: 'Buildings', w: 3,  h: 2,  bg: '#e8daa8', border: '#c0b060' },  // ~6m × 4m
  { type: 'parking',    label: 'Parking',         cat: 'Buildings', w: 13, h: 8,  bg: '#c8c4bc', border: '#a0a098' },  // ~26m × 16m (small lot)
  { type: 'boatyard',   label: 'Boatyard',        cat: 'Buildings', w: 15, h: 10, bg: '#c4bca8', border: '#9a9280' },  // ~30m × 20m
  { type: 'chandlery',  label: 'Chandlery',       cat: 'Buildings', w: 4,  h: 3,  bg: '#d4cec0', border: '#b0a890' },  // ~8m × 6m
  { type: 'restaurant', label: 'Restaurant',      cat: 'Buildings', w: 8,  h: 5,  bg: '#d0dcc8', border: '#90a870' },  // ~16m × 10m
  { type: 'toilets',    label: 'Toilet Block',    cat: 'Buildings', w: 3,  h: 2,  bg: '#ccd4e0', border: '#98a8c0' },  // ~6m × 4m
  { type: 'security',   label: 'Security / Gate', cat: 'Buildings', w: 2,  h: 2,  bg: '#d8cce0', border: '#a888c0' },  // ~4m × 4m
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
    { role: 'spine', pier_type: 'pontoon', ox: totalW / 2, oy: spineH / 2, canvas_w: totalW, canvas_h: spineH, bg, border },
    // Finger piers
    ...Array.from({ length: numFingers }, (_, i) => ({
      role: 'finger',
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
