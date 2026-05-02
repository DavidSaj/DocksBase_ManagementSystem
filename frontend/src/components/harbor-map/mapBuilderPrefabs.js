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
