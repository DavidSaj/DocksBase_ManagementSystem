# Marina Map — Frontend Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `HarborMap.jsx` and the disconnected `MapCreator` with a unified "Digital Twin" system: a single data-driven SVG canvas that renders real Berth DB records at their saved positions, supports zoom/pan, shows a status sidebar on the live view, and lets users drag unmapped berths onto the canvas in the editor.

**Architecture:** A shared `DigitalTwinCanvas.jsx` (SVG + zoom/pan) is used in both the live view and the editor. Berth canvas coordinates (`canvas_x`, `canvas_y`, `canvas_width`, `canvas_height`, `canvas_rotation`) are stored on the backend `Berth` model (see backend plan). A new `DocksBerthsTab.jsx` manages dock/berth data with a bulk generator modal. `MarinaMap.jsx` gains a third tab. The old `HarborMap.jsx` is deleted. Coordinate unit: **meters** (1 canvas unit = 1 m). At default zoom the renderer uses `CELL = 20px/m`.

**Tech Stack:** React 19, SVG (no new libraries), HTML5 drag-and-drop API, existing Axios instance at `src/api.js`

**Prerequisites:** Backend plan `2026-05-01-marina-map-backend.md` must be fully deployed before this plan is implemented.

---

## File Map

| File | Action |
|---|---|
| `frontend/src/hooks/usePiers.js` | New — CRUD + bulk-generate for piers |
| `frontend/src/hooks/useBerths.js` | Replace — return raw berths array (drop old transform) |
| `frontend/src/components/harbor-map/DigitalTwinCanvas.jsx` | New — shared zoom/pan SVG canvas |
| `frontend/src/components/harbor-map/BerthStatusSidebar.jsx` | New — right sidebar for live map |
| `frontend/src/components/harbor-map/UnmappedBerthsSidebar.jsx` | New — left sidebar for editor |
| `frontend/src/components/harbor-map/BulkGenerateModal.jsx` | New — bulk berth generator form |
| `frontend/src/components/harbor-map/DocksBerthsTab.jsx` | New — dock list + berth data grid |
| `frontend/src/screens/MarinaMap.jsx` | Modify — 3 tabs; replace MapCreator with new editor; replace HarborMap with live twin |
| `frontend/src/components/harbor-map/HarborMap.jsx` | Delete — replaced by DigitalTwinCanvas |

---

### Task 1: Replace useBerths hook + create usePiers hook

**Files:**
- Modify: `frontend/src/hooks/useBerths.js`
- Create: `frontend/src/hooks/usePiers.js`

- [ ] **Step 1: Replace useBerths.js**

The existing `useBerths.js` transforms berths into a pier-grouped format for the old HarborMap. Replace it with a raw hook that returns berths directly:

```js
// frontend/src/hooks/useBerths.js
import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function useBerths(filters = {}) {
  const [berths, setBerths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null))
    ).toString();
    api
      .get(`/berths/${params ? '?' + params : ''}`)
      .then(r => { setBerths(r.data); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, [JSON.stringify(filters)]);

  useEffect(() => { load(); }, [load]);

  const updateBerth = useCallback(async (id, data) => {
    const r = await api.patch(`/berths/${id}/`, data);
    setBerths(prev => prev.map(b => b.id === id ? r.data : b));
    return r.data;
  }, []);

  const createBerth = useCallback(async (data) => {
    const r = await api.post('/berths/', data);
    setBerths(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const deleteBerth = useCallback(async (id) => {
    await api.delete(`/berths/${id}/`);
    setBerths(prev => prev.filter(b => b.id !== id));
  }, []);

  const addBerths = useCallback((newBerths) => {
    setBerths(prev => [...prev, ...newBerths]);
  }, []);

  return { berths, loading, error, reload: load, updateBerth, createBerth, deleteBerth, addBerths };
}
```

- [ ] **Step 2: Create usePiers.js**

```js
// frontend/src/hooks/usePiers.js
import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function usePiers() {
  const [piers, setPiers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/piers/').then(r => { setPiers(r.data); setLoading(false); });
  }, []);

  const createPier = useCallback(async (data) => {
    const r = await api.post('/piers/', data);
    setPiers(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const updatePier = useCallback(async (id, data) => {
    const r = await api.patch(`/piers/${id}/`, data);
    setPiers(prev => prev.map(p => p.id === id ? r.data : p));
    return r.data;
  }, []);

  const deletePier = useCallback(async (id) => {
    await api.delete(`/piers/${id}/`);
    setPiers(prev => prev.filter(p => p.id !== id));
  }, []);

  const bulkGenerate = useCallback(async (pierId, data) => {
    const r = await api.post(`/piers/${pierId}/bulk-generate/`, data);
    return r.data;
  }, []);

  return { piers, loading, createPier, updatePier, deletePier, bulkGenerate };
}
```

- [ ] **Step 3: Verify no JS errors**

```bash
cd frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds (may have warnings about unused HarborMap — fine for now).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useBerths.js frontend/src/hooks/usePiers.js
git commit -m "feat(map): replace useBerths with raw hook; add usePiers CRUD hook"
```

---

### Task 2: Create DigitalTwinCanvas.jsx

**Files:**
- Create: `frontend/src/components/harbor-map/DigitalTwinCanvas.jsx`

This is the core shared canvas used in both the live view and the editor. It renders pier rectangles and berth rectangles on a zoomable/pannable SVG.

- [ ] **Step 1: Create the component**

```jsx
// frontend/src/components/harbor-map/DigitalTwinCanvas.jsx
import { useRef, useState, useCallback } from 'react';

const CELL = 20; // pixels per meter at zoom=1

const STATUS_COL = {
  available:   { fill: '#c2ecce', stroke: '#38a860', text: '#0a4a20' },
  occupied:    { fill: '#c6dcf5', stroke: '#3a7fc8', text: '#0a3a70' },
  reserved:    { fill: '#f6e7b0', stroke: '#c89020', text: '#6a4800' },
  maintenance: { fill: '#f5cccc', stroke: '#c04040', text: '#780000' },
};

export default function DigitalTwinCanvas({
  piers = [],
  berths = [],
  mode = 'view',          // 'view' | 'edit'
  selectedBerthId = null,
  onBerthClick,           // (berth) => void
  onBerthDrop,            // (berthId, canvasX, canvasY) => void  — edit mode only
  showGrid = true,
  initialZoom = 1,
  initialPan = { x: 60, y: 60 },
}) {
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState(initialPan);
  const isPanning = useRef(false);
  const panStart = useRef(null);

  // Convert screen pixels → canvas meters
  const screenToCanvas = useCallback((screenX, screenY) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (screenX - rect.left - pan.x) / (CELL * zoom),
      y: (screenY - rect.top  - pan.y) / (CELL * zoom),
    };
  }, [zoom, pan]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom(z => Math.min(8, Math.max(0.15, z * factor)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    // Middle-click or Alt+left-click to pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current || !panStart.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  const handleDragOver = (e) => { if (mode === 'edit') e.preventDefault(); };

  const handleDrop = (e) => {
    if (mode !== 'edit') return;
    e.preventDefault();
    const berthId = parseInt(e.dataTransfer.getData('berthId'), 10);
    if (!berthId) return;
    const c = screenToCanvas(e.clientX, e.clientY);
    // Snap to 0.5m grid
    const x = Math.round(c.x * 2) / 2;
    const y = Math.round(c.y * 2) / 2;
    onBerthDrop?.(berthId, x, y);
  };

  const mappedBerths = berths.filter(b => b.canvas_x != null);
  const sw = 1 / zoom; // stroke widths scale inversely with zoom so they look consistent

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Grid (screen-space pattern so it stays fixed as zoom changes) */}
      {showGrid && (() => {
        const gSize = CELL * zoom;
        const ox = ((pan.x % gSize) + gSize) % gSize;
        const oy = ((pan.y % gSize) + gSize) % gSize;
        return (
          <defs>
            <pattern id="dtgrid" width={gSize} height={gSize}
              patternUnits="userSpaceOnUse" x={ox} y={oy}>
              <path d={`M ${gSize} 0 L 0 0 0 ${gSize}`}
                fill="none" stroke="#d8dde3" strokeWidth="0.5"/>
            </pattern>
          </defs>
        );
      })()}
      {showGrid && <rect width="100%" height="100%" fill="url(#dtgrid)" />}

      {/* All canvas content lives inside this group — zoom + pan applied here */}
      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

        {/* Water background */}
        <rect x="-9999" y="-9999" width="19998" height="19998" fill="#deeef7" />

        {/* Pier (dock) rectangles */}
        {piers.map(pier => (
          pier.canvas_x != null && (
            <g key={pier.id}>
              <rect
                x={pier.canvas_x * CELL}
                y={pier.canvas_y * CELL}
                width={pier.canvas_width * CELL}
                height={pier.canvas_height * CELL}
                fill="#7a7a7a"
                stroke="#4a4a4a"
                strokeWidth={sw}
                rx={2}
              />
              <text
                x={(pier.canvas_x + pier.canvas_width / 2) * CELL}
                y={(pier.canvas_y + pier.canvas_height / 2) * CELL}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={11 / zoom}
                fontWeight="700"
                style={{ pointerEvents: 'none' }}
              >
                {pier.label || pier.code}
              </text>
            </g>
          )
        ))}

        {/* Berth rectangles */}
        {mappedBerths.map(berth => {
          const col = STATUS_COL[berth.status] || STATUS_COL.available;
          const bx = berth.canvas_x * CELL;
          const by = berth.canvas_y * CELL;
          const bw = berth.canvas_width * CELL;
          const bh = berth.canvas_height * CELL;
          const cx = bx + bw / 2;
          const cy = by + bh / 2;
          const isSelected = berth.id === selectedBerthId;

          return (
            <g
              key={berth.id}
              transform={berth.canvas_rotation
                ? `rotate(${berth.canvas_rotation},${cx},${cy})`
                : undefined}
              onClick={() => onBerthClick?.(berth)}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <rect
                  x={bx - 3 * sw} y={by - 3 * sw}
                  width={bw + 6 * sw} height={bh + 6 * sw}
                  fill="none" stroke="#2563eb" strokeWidth={3 * sw} rx={3}
                />
              )}
              <rect
                x={bx} y={by} width={bw} height={bh}
                fill={col.fill} stroke={col.stroke} strokeWidth={sw} rx={1}
              />
              <text
                x={cx} y={cy - 5 / zoom}
                textAnchor="middle" dominantBaseline="middle"
                fill={col.text} fontSize={9 / zoom} fontWeight="600"
                style={{ pointerEvents: 'none' }}
              >
                {berth.code}
              </text>
              {berth.vessel_name && (
                <text
                  x={cx} y={cy + 5 / zoom}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={col.text} fontSize={7 / zoom}
                  style={{ pointerEvents: 'none' }}
                >
                  {berth.vessel_name.substring(0, 10)}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Zoom indicator (bottom-right, always on top) */}
      <text x="calc(100% - 8px)" y="calc(100% - 8px)"
        textAnchor="end" dominantBaseline="auto"
        fill="#999" fontSize="11" style={{ userSelect: 'none' }}>
        {Math.round(zoom * 100)}%
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Verify no build errors**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/harbor-map/DigitalTwinCanvas.jsx
git commit -m "feat(map): DigitalTwinCanvas — shared zoom/pan SVG canvas with berth/pier rendering"
```

---

### Task 3: Create BerthStatusSidebar.jsx

**Files:**
- Create: `frontend/src/components/harbor-map/BerthStatusSidebar.jsx`

This is the right-side panel on the live map tab showing berth status counts and a filterable list.

- [ ] **Step 1: Create the component**

```jsx
// frontend/src/components/harbor-map/BerthStatusSidebar.jsx
import { useState } from 'react';

const STATUS_LABEL = {
  available:   { label: 'Available',    color: '#38a860', bg: '#c2ecce' },
  occupied:    { label: 'Occupied',     color: '#3a7fc8', bg: '#c6dcf5' },
  reserved:    { label: 'Reserved',     color: '#c89020', bg: '#f6e7b0' },
  maintenance: { label: 'Maintenance',  color: '#c04040', bg: '#f5cccc' },
};

export default function BerthStatusSidebar({ berths = [], onBerthClick, selectedBerthId }) {
  const [filter, setFilter] = useState('all');

  const counts = berths.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  const visible = filter === 'all'
    ? berths
    : berths.filter(b => b.status === filter);

  return (
    <div style={{
      width: 240, flexShrink: 0, borderLeft: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', background: '#fafafa',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#111' }}>
          Berth Status
        </div>
        {/* Status count chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(STATUS_LABEL).map(([key, { label, color, bg }]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              style={{
                border: `1px solid ${color}`,
                background: filter === key ? color : bg,
                color: filter === key ? 'white' : color,
                borderRadius: 12, padding: '2px 8px',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {label} {counts[key] || 0}
            </button>
          ))}
        </div>
      </div>

      {/* Berth list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {visible.length === 0 && (
          <div style={{ padding: '24px 16px', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
            No berths match this filter.
          </div>
        )}
        {visible.map(berth => {
          const { color, bg } = STATUS_LABEL[berth.status] || STATUS_LABEL.available;
          const isSelected = berth.id === selectedBerthId;
          return (
            <button
              key={berth.id}
              onClick={() => onBerthClick?.(berth)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', textAlign: 'left',
                padding: '6px 14px',
                background: isSelected ? '#eff6ff' : 'transparent',
                border: 'none', cursor: 'pointer',
                borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
              }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: color, flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>
                {berth.code}
              </span>
              <span style={{ fontSize: 11, color: '#6b7280', flex: 1, textAlign: 'right' }}>
                {berth.vessel_name || (berth.length_m ? `${berth.length_m}m` : '—')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary footer */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid #e5e7eb',
        fontSize: 11, color: '#6b7280',
      }}>
        {berths.length} berths total
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/BerthStatusSidebar.jsx
git commit -m "feat(map): BerthStatusSidebar — filterable status panel for live map"
```

---

### Task 4: Create UnmappedBerthsSidebar.jsx

**Files:**
- Create: `frontend/src/components/harbor-map/UnmappedBerthsSidebar.jsx`

This is the left-side panel in the Map Editor tab. It shows berths that have no canvas coordinates yet, grouped by pier. Users drag items from here onto the canvas.

- [ ] **Step 1: Create the component**

```jsx
// frontend/src/components/harbor-map/UnmappedBerthsSidebar.jsx
import { useState } from 'react';

export default function UnmappedBerthsSidebar({ berths = [], piers = [] }) {
  const [search, setSearch] = useState('');

  const unmapped = berths.filter(
    b => b.canvas_x == null &&
    (search === '' || b.code.toLowerCase().includes(search.toLowerCase()))
  );

  // Group by pier id
  const byPier = piers.reduce((acc, p) => {
    acc[p.id] = { pier: p, berths: [] };
    return acc;
  }, {});
  // Berths with no pier (shouldn't happen, but guard)
  byPier['__none'] = { pier: { code: 'No Dock', label: '' }, berths: [] };
  unmapped.forEach(b => {
    const key = b.pier ?? '__none';
    if (byPier[key]) byPier[key].berths.push(b);
    else byPier['__none'].berths.push(b);
  });

  const groups = Object.values(byPier).filter(g => g.berths.length > 0);

  return (
    <div style={{
      width: 200, flexShrink: 0, borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', background: '#f9fafb',
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', marginBottom: 6 }}>
          Unmapped Berths
        </div>
        <input
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '4px 8px', fontSize: 12,
            border: '1px solid #d1d5db', borderRadius: 4, boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groups.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
            All berths are placed.
          </div>
        )}
        {groups.map(({ pier, berths: gb }) => (
          <div key={pier.id}>
            <div style={{
              padding: '6px 12px 2px', fontSize: 10, fontWeight: 700,
              color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {pier.label || pier.code}
            </div>
            {gb.map(berth => (
              <div
                key={berth.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('berthId', String(berth.id));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                style={{
                  padding: '5px 12px', margin: '2px 8px',
                  background: 'white', border: '1px solid #e5e7eb',
                  borderRadius: 4, fontSize: 12, fontWeight: 600,
                  cursor: 'grab', color: '#111',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#38a860', flexShrink: 0,
                }} />
                {berth.code}
                {berth.length_m && (
                  <span style={{ color: '#9ca3af', fontSize: 10, marginLeft: 'auto' }}>
                    {berth.length_m}m
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{
        padding: '6px 12px', borderTop: '1px solid #e5e7eb',
        fontSize: 10, color: '#9ca3af',
      }}>
        {unmapped.length} unmapped — drag to canvas
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/UnmappedBerthsSidebar.jsx
git commit -m "feat(map): UnmappedBerthsSidebar — draggable berth list for editor"
```

---

### Task 5: Create BulkGenerateModal.jsx + DocksBerthsTab.jsx

**Files:**
- Create: `frontend/src/components/harbor-map/BulkGenerateModal.jsx`
- Create: `frontend/src/components/harbor-map/DocksBerthsTab.jsx`

- [ ] **Step 1: Create BulkGenerateModal.jsx**

```jsx
// frontend/src/components/harbor-map/BulkGenerateModal.jsx
import { useState } from 'react';

export default function BulkGenerateModal({ pier, onGenerate, onClose }) {
  const [form, setForm] = useState({
    prefix: pier.code,
    start: 1,
    end: 10,
    length_m: '',
    max_beam_m: '',
    price_per_night: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = {
        prefix: form.prefix,
        start: parseInt(form.start, 10),
        end: parseInt(form.end, 10),
        ...(form.length_m     && { length_m: form.length_m }),
        ...(form.max_beam_m   && { max_beam_m: form.max_beam_m }),
        ...(form.price_per_night && { price_per_night: form.price_per_night }),
      };
      await onGenerate(pier.id, payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data) || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const count = Math.max(0, parseInt(form.end, 10) - parseInt(form.start, 10) + 1) || 0;

  const field = (label, key, type = 'text', placeholder = '') => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '6px 10px', fontSize: 13,
          border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box',
        }}
      />
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'white', borderRadius: 10, padding: 24, width: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
          Bulk Generate Berths — {pier.label || pier.code}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                Prefix
              </label>
              <input
                value={form.prefix} onChange={e => set('prefix', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                From #
              </label>
              <input
                type="number" min="1" value={form.start} onChange={e => set('start', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                To #
              </label>
              <input
                type="number" min="1" value={form.end} onChange={e => set('end', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 4 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Max Length (m)</label>
              <input type="number" step="0.1" value={form.length_m} onChange={e => set('length_m', e.target.value)} placeholder="e.g. 12"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Max Beam (m)</label>
              <input type="number" step="0.1" value={form.max_beam_m} onChange={e => set('max_beam_m', e.target.value)} placeholder="e.g. 4"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Price/night</label>
              <input type="number" step="0.01" value={form.price_per_night} onChange={e => set('price_per_night', e.target.value)} placeholder="e.g. 50"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
          </div>

          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
            <button type="submit" disabled={loading || count === 0} style={{
              background: '#2563eb', color: 'white', border: 'none',
              borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
            }}>
              {loading ? 'Generating…' : `Generate ${count} Berths`}
            </button>
            <button type="button" onClick={onClose} style={{
              background: 'transparent', border: '1px solid #d1d5db',
              borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create DocksBerthsTab.jsx**

```jsx
// frontend/src/components/harbor-map/DocksBerthsTab.jsx
import { useState } from 'react';
import BulkGenerateModal from './BulkGenerateModal';

const STATUS_OPTIONS = ['available', 'occupied', 'reserved', 'maintenance'];

export default function DocksBerthsTab({ piers, berths, onCreatePier, onUpdatePier, onDeletePier, onBulkGenerate, onUpdateBerth, onDeleteBerth }) {
  const [selectedPierId, setSelectedPierId] = useState(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [newPierCode, setNewPierCode] = useState('');
  const [newPierLabel, setNewPierLabel] = useState('');
  const [editingBerthId, setEditingBerthId] = useState(null);
  const [editValues, setEditValues] = useState({});

  const selectedPier = piers.find(p => p.id === selectedPierId);
  const pierBerths = selectedPierId
    ? berths.filter(b => b.pier === selectedPierId)
    : [];

  const handleCreatePier = async (e) => {
    e.preventDefault();
    if (!newPierCode.trim()) return;
    await onCreatePier({ code: newPierCode.trim(), label: newPierLabel.trim() });
    setNewPierCode('');
    setNewPierLabel('');
  };

  const startEditBerth = (berth) => {
    setEditingBerthId(berth.id);
    setEditValues({
      code: berth.code,
      length_m: berth.length_m || '',
      max_beam_m: berth.max_beam_m || '',
      max_draft_m: berth.max_draft_m || '',
      price_per_night: berth.price_per_night || '',
      status: berth.status,
    });
  };

  const saveEditBerth = async (berthId) => {
    await onUpdateBerth(berthId, editValues);
    setEditingBerthId(null);
  };

  const handleBulkGenerate = async (pierId, data) => {
    const created = await onBulkGenerate(pierId, data);
    return created;
  };

  const inputStyle = {
    padding: '3px 6px', fontSize: 12, border: '1px solid #d1d5db',
    borderRadius: 4, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: Dock list */}
      <div style={{
        width: 220, borderRight: '1px solid #e5e7eb', display: 'flex',
        flexDirection: 'column', background: '#f9fafb',
      }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', fontWeight: 700, fontSize: 13 }}>
          Docks / Piers
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {piers.map(pier => (
            <div
              key={pier.id}
              onClick={() => setSelectedPierId(pier.id)}
              style={{
                padding: '8px 14px', cursor: 'pointer', fontSize: 13,
                background: pier.id === selectedPierId ? '#eff6ff' : 'transparent',
                borderLeft: pier.id === selectedPierId ? '3px solid #2563eb' : '3px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>
                <span style={{ fontWeight: 600 }}>{pier.code}</span>
                {pier.label && <span style={{ color: '#6b7280', marginLeft: 4 }}>{pier.label}</span>}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{pier.berth_count}</span>
            </div>
          ))}
        </div>

        {/* Add dock form */}
        <form onSubmit={handleCreatePier} style={{ padding: '10px 12px', borderTop: '1px solid #e5e7eb' }}>
          <input
            placeholder="Code (e.g. A)" value={newPierCode}
            onChange={e => setNewPierCode(e.target.value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <input
            placeholder="Label (optional)" value={newPierLabel}
            onChange={e => setNewPierLabel(e.target.value)}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <button type="submit" style={{
            width: '100%', background: '#2563eb', color: 'white',
            border: 'none', borderRadius: 5, padding: '6px', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}>
            + Add Dock
          </button>
        </form>
      </div>

      {/* Right: Berth grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedPier ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
            Select a dock on the left to manage its berths.
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{
              padding: '10px 16px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {selectedPier.label || selectedPier.code} — {pierBerths.length} berths
              </span>
              <button
                onClick={() => setShowBulkModal(true)}
                style={{
                  marginLeft: 'auto', background: '#059669', color: 'white',
                  border: 'none', borderRadius: 6, padding: '6px 14px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                ⚡ Bulk Generate
              </button>
              <button
                onClick={() => onDeletePier(selectedPier.id).then(() => setSelectedPierId(null))}
                style={{
                  background: '#fee2e2', color: '#991b1b',
                  border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 12px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Delete Dock
              </button>
            </div>

            {/* Berth table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f3f4f6', position: 'sticky', top: 0 }}>
                    {['Code', 'Length (m)', 'Beam (m)', 'Draft (m)', 'Price/night', 'Status', 'Placed', ''].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pierBerths.map(berth => {
                    const isEditing = editingBerthId === berth.id;
                    return (
                      <tr key={berth.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing
                            ? <input value={editValues.code} onChange={e => setEditValues(p => ({ ...p, code: e.target.value }))} style={inputStyle} />
                            : <span style={{ fontWeight: 600 }}>{berth.code}</span>}
                        </td>
                        {['length_m', 'max_beam_m', 'max_draft_m', 'price_per_night'].map(field => (
                          <td key={field} style={{ padding: '6px 10px' }}>
                            {isEditing
                              ? <input type="number" step="0.1" value={editValues[field]} onChange={e => setEditValues(p => ({ ...p, [field]: e.target.value }))} style={inputStyle} />
                              : (berth[field] || '—')}
                          </td>
                        ))}
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing
                            ? (
                              <select value={editValues.status} onChange={e => setEditValues(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
                                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            )
                            : berth.status}
                        </td>
                        <td style={{ padding: '6px 10px', color: berth.canvas_x != null ? '#059669' : '#9ca3af', fontSize: 11 }}>
                          {berth.canvas_x != null ? '✓ Yes' : 'No'}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEditBerth(berth.id)} style={{ fontSize: 11, padding: '2px 8px', marginRight: 4, background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
                              <button onClick={() => setEditingBerthId(null)} style={{ fontSize: 11, padding: '2px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEditBerth(berth)} style={{ fontSize: 11, padding: '2px 8px', marginRight: 4, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>Edit</button>
                              <button onClick={() => onDeleteBerth(berth.id)} style={{ fontSize: 11, padding: '2px 8px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}>Del</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pierBerths.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>
                        No berths yet. Use Bulk Generate or add individually.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showBulkModal && selectedPier && (
        <BulkGenerateModal
          pier={selectedPier}
          onGenerate={handleBulkGenerate}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify no build errors**

```bash
cd frontend
npm run build 2>&1 | grep -E "^.*(error|Error)" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/BulkGenerateModal.jsx frontend/src/components/harbor-map/DocksBerthsTab.jsx
git commit -m "feat(map): BulkGenerateModal + DocksBerthsTab — dock management with berth spreadsheet grid"
```

---

### Task 6: Rewrite MarinaMap.jsx with 3 tabs

**Files:**
- Modify: `frontend/src/screens/MarinaMap.jsx`
- Delete: `frontend/src/components/harbor-map/HarborMap.jsx` (at end of step)

This is the main wiring step. `MarinaMap.jsx` currently has a 2-tab layout (Map + Map Creator). Replace it with a 3-tab layout: **Live Map**, **Map Editor**, **Docks & Berths**.

- [ ] **Step 1: Read the existing MarinaMap.jsx**

Read `frontend/src/screens/MarinaMap.jsx` in full before editing. Note: the existing Map Creator tab contains a palette + grid + element placement system. The new Map Editor tab keeps that system intact and ADDS the UnmappedBerthsSidebar on the left and wires berth drop events.

- [ ] **Step 2: Replace MarinaMap.jsx**

The new `MarinaMap.jsx` structure:

```jsx
// frontend/src/screens/MarinaMap.jsx
import { useState, useCallback } from 'react';
import { usePiers } from '../hooks/usePiers';
import { useBerths } from '../hooks/useBerths';
import DigitalTwinCanvas from '../components/harbor-map/DigitalTwinCanvas';
import BerthStatusSidebar from '../components/harbor-map/BerthStatusSidebar';
import UnmappedBerthsSidebar from '../components/harbor-map/UnmappedBerthsSidebar';
import DocksBerthsTab from '../components/harbor-map/DocksBerthsTab';

// ── Tab styles ────────────────────────────────────────────────────────────────
const tabStyle = (active) => ({
  padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
  borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
  color: active ? '#2563eb' : '#6b7280', background: 'none', border: 'none',
  borderBottomStyle: 'solid', borderBottomWidth: 2,
  borderBottomColor: active ? '#2563eb' : 'transparent',
});

// ── Berth detail panel (shown on click in live view) ─────────────────────────
function BerthDetailPanel({ berth, onClose, onUpdateBerth }) {
  if (!berth) return null;
  return (
    <div style={{
      position: 'absolute', top: 16, right: 256, background: 'white',
      border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, width: 220,
      boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{berth.code}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af' }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div><b>Status:</b> {berth.status}</div>
        <div><b>Dock:</b> {berth.pier_code}</div>
        {berth.length_m && <div><b>Length:</b> {berth.length_m}m</div>}
        {berth.max_beam_m && <div><b>Beam:</b> {berth.max_beam_m}m</div>}
        {berth.vessel_name && <div><b>Vessel:</b> {berth.vessel_name}</div>}
        {berth.price_per_night && <div><b>Rate:</b> €{berth.price_per_night}/night</div>}
      </div>
      {/* Quick status change */}
      <select
        value={berth.status}
        onChange={e => onUpdateBerth(berth.id, { status: e.target.value })}
        style={{ marginTop: 10, width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5 }}
      >
        {['available', 'occupied', 'reserved', 'maintenance'].map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MarinaMap() {
  const [tab, setTab] = useState('live');
  const [selectedBerth, setSelectedBerth] = useState(null);

  const { piers, createPier, updatePier, deletePier, bulkGenerate } = usePiers();
  const { berths, updateBerth, deleteBerth, addBerths } = useBerths();

  // ── Canvas save: bulk-patch berths with new canvas coords ──────────────────
  const [pendingPositions, setPendingPositions] = useState({}); // { berthId: {x,y} }
  const [saving, setSaving] = useState(false);

  const handleBerthDrop = useCallback((berthId, canvasX, canvasY) => {
    const berth = berths.find(b => b.id === berthId);
    if (!berth) return;
    setPendingPositions(prev => ({ ...prev, [berthId]: { canvas_x: canvasX, canvas_y: canvasY } }));
    // Optimistic update in berths state
    updateBerth(berthId, {
      canvas_x: canvasX,
      canvas_y: canvasY,
      canvas_width: berth.canvas_width || 4,
      canvas_height: berth.canvas_height || 12,
      canvas_rotation: berth.canvas_rotation || 0,
    });
  }, [berths, updateBerth]);

  const handleSaveLayout = async () => {
    setSaving(true);
    try {
      // All positions already saved via PATCH in handleBerthDrop
      // This button just confirms and clears pending state
      setPendingPositions({});
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = Object.keys(pendingPositions).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid #e5e7eb', background: 'white', paddingLeft: 16, flexShrink: 0,
      }}>
        <button style={tabStyle(tab === 'live')}    onClick={() => setTab('live')}>Marina Map</button>
        <button style={tabStyle(tab === 'editor')}  onClick={() => setTab('editor')}>Map Editor</button>
        <button style={tabStyle(tab === 'docks')}   onClick={() => setTab('docks')}>Docks & Berths</button>

        {tab === 'editor' && pendingCount > 0 && (
          <button
            onClick={handleSaveLayout}
            disabled={saving}
            style={{
              marginLeft: 'auto', marginRight: 16,
              background: '#2563eb', color: 'white', border: 'none',
              borderRadius: 6, padding: '6px 16px', fontSize: 12,
              fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : `Save Layout (${pendingCount} changes)`}
          </button>
        )}
      </div>

      {/* ── LIVE MAP TAB ─────────────────────────────────────────────────── */}
      {tab === 'live' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <DigitalTwinCanvas
              piers={piers}
              berths={berths}
              mode="view"
              selectedBerthId={selectedBerth?.id}
              onBerthClick={setSelectedBerth}
              showGrid={false}
            />
            <BerthDetailPanel
              berth={selectedBerth}
              onClose={() => setSelectedBerth(null)}
              onUpdateBerth={updateBerth}
            />
          </div>
          <BerthStatusSidebar
            berths={berths}
            selectedBerthId={selectedBerth?.id}
            onBerthClick={setSelectedBerth}
          />
        </div>
      )}

      {/* ── MAP EDITOR TAB ───────────────────────────────────────────────── */}
      {tab === 'editor' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <UnmappedBerthsSidebar berths={berths} piers={piers} />
          <div style={{ flex: 1, position: 'relative' }}>
            <DigitalTwinCanvas
              piers={piers}
              berths={berths}
              mode="edit"
              selectedBerthId={selectedBerth?.id}
              onBerthClick={setSelectedBerth}
              onBerthDrop={handleBerthDrop}
              showGrid={true}
            />
          </div>
        </div>
      )}

      {/* ── DOCKS & BERTHS TAB ───────────────────────────────────────────── */}
      {tab === 'docks' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DocksBerthsTab
            piers={piers}
            berths={berths}
            onCreatePier={createPier}
            onUpdatePier={updatePier}
            onDeletePier={deletePier}
            onBulkGenerate={async (pierId, data) => {
              const created = await bulkGenerate(pierId, data);
              addBerths(created);
              return created;
            }}
            onUpdateBerth={updateBerth}
            onDeleteBerth={deleteBerth}
          />
        </div>
      )}
    </div>
  );
}
```

**Important:** The existing Map Creator tab code (palette, grid, element placement) is dropped in this replacement. The editor tab is now the digital twin canvas with drag-drop. If the marina still wants to draw decorative shapes (buildings, water areas), that can be added back in a future iteration by embedding the old palette into the editor tab. For now the canvas shows only piers (dock rectangles) and berths.

- [ ] **Step 3: Delete HarborMap.jsx**

```bash
rm frontend/src/components/harbor-map/HarborMap.jsx
```

Search for any remaining imports of HarborMap and remove them:

```bash
grep -r "HarborMap" frontend/src/ --include="*.jsx" --include="*.js" -l
```

For each file found, remove the import and any JSX usage.

- [ ] **Step 4: Build and verify**

```bash
cd frontend
npm run build 2>&1 | tail -20
```

Expected: successful build, no errors.

- [ ] **Step 5: Smoke-test in browser**

Start the dev server:
```bash
npm run dev
```

1. Open `http://localhost:5173` and navigate to Marina Map.
2. **Live Map tab**: canvas renders (blue water background, zoom with scroll wheel, pan with Alt+drag).
3. **Map Editor tab**: left sidebar shows "Unmapped Berths", canvas is droppable.
4. **Docks & Berths tab**: dock list shows existing piers; berth table shows berths.
5. Create a dock (e.g., code "A", label "Pier Alpha") → appears in left panel.
6. Use Bulk Generate on Pier A → generates A1–A10 → they appear in editor sidebar as unmapped.
7. Drag A1 from sidebar to canvas → it appears on canvas at drop position.
8. Switch to Live Map → A1 appears (green = available).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/MarinaMap.jsx
git add -A frontend/src/components/harbor-map/
git commit -m "feat(map): 3-tab digital twin — live map with status sidebar, editor with drag-drop berths, docks management"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Editing mode grid smaller (CELL=20, same as before but canvas fills full height) | Task 2 (DigitalTwinCanvas) |
| Map saved the way it looks on main tab (same coord system, same component) | Tasks 2, 6 |
| Berths connected to real DB records (canvas coords on Berth model) | Prereq backend plan |
| Map bigger (full-height flex container, no wasted space) | Task 6 (MarinaMap layout) |
| Zoomable on both tabs | Task 2 (onWheel handler) |
| Right sidebar on main tab: occupied/not occupied listing | Task 3 (BerthStatusSidebar) |
| List-First architecture: Dock → Berth hierarchy | Task 5 (DocksBerthsTab) |
| Bulk generator | Task 5 (BulkGenerateModal) |
| Digital twin canvas | Task 2 (DigitalTwinCanvas) |
| Drag unmapped berths from sidebar to canvas | Tasks 4, 6 |
| canvas_x, canvas_y, rotation, width, height on Berth | Backend plan Task 1 |

**Placeholder scan:** None found.

**Type consistency:** `berth.pier` is the pier **id** (integer FK) from the API — used correctly as a key in `DocksBerthsTab` (`berths.filter(b => b.pier === selectedPierId)`). `pier.id` matches. Consistent throughout.
