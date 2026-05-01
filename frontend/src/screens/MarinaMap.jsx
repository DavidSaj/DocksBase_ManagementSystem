import { useState, useEffect } from 'react';
import HarborMap from '../components/harbor-map/HarborMap.jsx';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import { useBerths } from '../hooks/useBerths.js';
import useMapConfig from '../hooks/useMapConfig.js';

// ── Map Creator constants ─────────────────────────────────────────────────────
const GRID = 24;
const COLS = 34;
const ROWS = 22;
const CW   = COLS * GRID;
const CH   = ROWS * GRID;

const DRAW_PRESETS = [
  { type: 'pier',       label: 'Pier / Pontoon', bg: '#c8b97a', border: '#a8994a', text: '#7a6820' },
  { type: 'breakwater', label: 'Breakwater',      bg: '#8a8880', border: '#6a6860', text: 'rgba(255,255,255,0.6)' },
  { type: 'land',       label: 'Land / Shore',    bg: '#d6cdb8', border: '#bfb7a4', text: 'rgba(0,0,0,0.5)' },
  { type: 'water',      label: 'Water Zone',      bg: '#0f3a56', border: '#1a5a80', text: 'rgba(255,255,255,0.55)' },
  { type: 'custom',     label: 'Custom',          bg: '#c2ecce', border: '#38a860', text: '#0a4a20' },
];

const PALETTE = [
  { cat: 'Environment', type: 'water',      label: 'Water',           w: 5,  h: 5, bg: '#0f3a56', border: '#1a5a80', text: 'rgba(255,255,255,0.55)' },
  { cat: 'Environment', type: 'shore',      label: 'Shore / Land',    w: 8,  h: 4, bg: '#d6cdb8', border: '#bfb7a4', text: 'rgba(0,0,0,0.5)'  },
  { cat: 'Environment', type: 'quay',       label: 'Quay Wall',       w: 10, h: 1, bg: '#8a7d68', border: '#6a5e50', text: 'rgba(255,255,255,0.5)' },
  { cat: 'Docking',     type: 'pier-v',     label: 'Pier (N–S)',      w: 1,  h: 8, bg: '#c8b97a', border: '#a8994a', text: '#7a6820' },
  { cat: 'Docking',     type: 'pier-h',     label: 'Pier (E–W)',      w: 8,  h: 1, bg: '#c8b97a', border: '#a8994a', text: '#7a6820' },
  { cat: 'Docking',     type: 'slip',       label: 'Berth Slip',      w: 3,  h: 2, bg: '#c2ecce', border: '#38a860', text: '#0a4a20' },
  { cat: 'Docking',     type: 'slip-t',     label: 'Transient Slip',  w: 3,  h: 2, bg: '#c6dcf5', border: '#3a7fc8', text: '#0a3a70' },
  { cat: 'Docking',     type: 'fuel-dock',  label: 'Fuel Dock',       w: 5,  h: 2, bg: '#f6e7b0', border: '#c89020', text: '#6a4800' },
  { cat: 'Docking',     type: 'gangway',    label: 'Gangway',         w: 1,  h: 3, bg: '#c0af72', border: '#a8994a', text: '#7a6820' },
  { cat: 'Docking',     type: 'ramp',       label: 'Launch Ramp',     w: 3,  h: 4, bg: '#c8c0aa', border: '#a8a090', text: 'rgba(0,0,0,0.5)' },
  { cat: 'Shapes',      type: 'tri-ul',     label: 'Corner ◸',        w: 4,  h: 4, bg: '#8a8880', border: '#6a6860', text: '', clipPath: 'polygon(0 0, 100% 0, 0 100%)' },
  { cat: 'Shapes',      type: 'tri-ur',     label: 'Corner ◹',        w: 4,  h: 4, bg: '#8a8880', border: '#6a6860', text: '', clipPath: 'polygon(0 0, 100% 0, 100% 100%)' },
  { cat: 'Shapes',      type: 'tri-bl',     label: 'Corner ◺',        w: 4,  h: 4, bg: '#8a8880', border: '#6a6860', text: '', clipPath: 'polygon(0 0, 0 100%, 100% 100%)' },
  { cat: 'Shapes',      type: 'tri-br',     label: 'Corner ◻',        w: 4,  h: 4, bg: '#8a8880', border: '#6a6860', text: '', clipPath: 'polygon(100% 0, 0 100%, 100% 100%)' },
  { cat: 'Shapes',      type: 'tri-up',     label: 'Wedge ▲',         w: 4,  h: 4, bg: '#8a8880', border: '#6a6860', text: '', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' },
  { cat: 'Shapes',      type: 'tri-rt',     label: 'Wedge ▶',         w: 4,  h: 4, bg: '#8a8880', border: '#6a6860', text: '', clipPath: 'polygon(0 0, 100% 50%, 0 100%)' },
  { cat: 'Buildings',   type: 'office',     label: 'Harbormaster',    w: 6,  h: 4, bg: '#ccc4ae', border: '#aaa090', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'fuel-stn',   label: 'Fuel Station',    w: 5,  h: 3, bg: '#ddd4aa', border: '#c0b070', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'parking',    label: 'Parking',         w: 8,  h: 4, bg: '#c0bcb0', border: '#a0a098', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'boatyard',   label: 'Boatyard',        w: 10, h: 6, bg: '#b8b0a0', border: '#989080', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'chandlery',  label: 'Chandlery',       w: 5,  h: 3, bg: '#cec8b8', border: '#b0aa98', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'restaurant', label: 'Restaurant',      w: 6,  h: 4, bg: '#c8d8b8', border: '#88a870', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'toilets',    label: 'Toilet Block',    w: 3,  h: 3, bg: '#d0d8e8', border: '#98a8c0', text: 'rgba(0,0,0,0.65)' },
  { cat: 'Buildings',   type: 'security',   label: 'Security / Gate', w: 2,  h: 2, bg: '#d8c8e0', border: '#a888c0', text: 'rgba(0,0,0,0.65)' },
];

// ── Map Creator component ─────────────────────────────────────────────────────
function MapCreator() {
  const { config, loading: cfgLoading, saving, saveConfig } = useMapConfig();

  const [items,       setItems]       = useState([]);
  const [activeTool,  setActiveTool]  = useState(null);
  const [selectedId,  setSelectedId]  = useState(null);
  const [showGrid,    setShowGrid]    = useState(true);
  const [itemLabels,  setItemLabels]  = useState({});
  const [customW,     setCustomW]     = useState(null);
  const [customH,     setCustomH]     = useState(null);
  const [drawMode,    setDrawMode]    = useState(false);
  const [drawPoints,  setDrawPoints]  = useState([]);
  const [drawPreset,  setDrawPreset]  = useState(DRAW_PRESETS[0]);
  const [hoverG,      setHoverG]      = useState({ gx: 0, gy: 0 });
  const [saveStatus,  setSaveStatus]  = useState(null);

  useEffect(() => {
    if (config?.custom_elements) setItems(config.custom_elements);
  }, [config]);

  async function handleSave() {
    const ok = await saveConfig({ ...(config || {}), custom_elements: items });
    setSaveStatus(ok ? 'saved' : 'error');
    setTimeout(() => setSaveStatus(null), 2500);
  }

  const activePalette = PALETTE.find(p => p.type === activeTool);
  const selectedItem  = items.find(i => i.id === selectedId);
  const cats          = [...new Set(PALETTE.map(p => p.cat))];
  const rectItems     = items.filter(i => i.shape !== 'polygon');
  const polyItems     = items.filter(i => i.shape === 'polygon');

  function selectTool(type) {
    if (drawMode) return;
    const same = type === activeTool;
    setActiveTool(same ? null : type);
    if (!same) { setCustomW(null); setCustomH(null); }
    setSelectedId(null);
  }
  function cancelTool() { setActiveTool(null); setCustomW(null); setCustomH(null); }
  function startDraw() { setActiveTool(null); setCustomW(null); setCustomH(null); setSelectedId(null); setDrawMode(true); setDrawPoints([]); }
  function cancelDraw() { setDrawMode(false); setDrawPoints([]); }

  function closeShape() {
    if (drawPoints.length < 3) return;
    const newItem = { id: Date.now(), shape: 'polygon', points: drawPoints, fill: drawPreset.bg, stroke: drawPreset.border, text: drawPreset.text, label: drawPreset.label, type: drawPreset.type };
    setItems(prev => [...prev, newItem]);
    setSelectedId(newItem.id);
    setDrawMode(false); setDrawPoints([]);
  }

  function gridPos(e, snap = 'floor') {
    const rect = e.currentTarget.getBoundingClientRect();
    const fn   = snap === 'round' ? Math.round : Math.floor;
    return { gx: Math.max(0, Math.min(COLS, fn((e.clientX - rect.left) / GRID))), gy: Math.max(0, Math.min(ROWS, fn((e.clientY - rect.top) / GRID))) };
  }

  function handleCanvasClick(e) {
    if (drawMode) {
      const { gx, gy } = gridPos(e, 'round');
      if (drawPoints.length >= 3) { const f = drawPoints[0]; if (Math.abs(gx - f.gx) <= 1 && Math.abs(gy - f.gy) <= 1) { closeShape(); return; } }
      setDrawPoints(prev => [...prev, { gx, gy }]);
      return;
    }
    if (!activeTool) { setSelectedId(null); return; }
    const tool = PALETTE.find(p => p.type === activeTool);
    if (!tool) return;
    const { gx, gy } = gridPos(e);
    const pw = Math.max(1, customW ?? tool.w);
    const ph = Math.max(1, customH ?? tool.h);
    const newItem = { id: Date.now(), shape: 'rect', type: tool.type, gx: Math.min(gx, COLS - pw), gy: Math.min(gy, ROWS - ph), w: pw, h: ph, tool };
    setItems(prev => [...prev, newItem]);
    setSelectedId(newItem.id);
  }

  function handleMouseMove(e) { if (!drawMode) return; const { gx, gy } = gridPos(e, 'round'); setHoverG({ gx, gy }); }
  function handleItemClick(e, item) { e.stopPropagation(); if (activeTool || drawMode) return; setSelectedId(item.id === selectedId ? null : item.id); }
  function deleteSelected() { setItems(prev => prev.filter(i => i.id !== selectedId)); setSelectedId(null); }
  function reorder(id, dir) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id); const next = [...prev]; const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]]; return next;
    });
  }
  function centroid(pts) { return { x: pts.reduce((s, p) => s + p.gx, 0) / pts.length * GRID, y: pts.reduce((s, p) => s + p.gy, 0) / pts.length * GRID }; }

  const nearFirst = drawMode && drawPoints.length >= 3 && Math.abs(hoverG.gx - drawPoints[0].gx) <= 1 && Math.abs(hoverG.gy - drawPoints[0].gy) <= 1;

  if (cfgLoading) return <div style={{ padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>Loading map…</div>;

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {/* ── Left palette ── */}
      <div style={{ width: 190, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {drawMode ? (
          <div className="card" style={{ padding: '12px 14px', border: '1.5px solid #b8965a' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>Drawing Dock Outline</div>
            <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', marginBottom: 10, lineHeight: 1.55 }}>
              {drawPoints.length === 0 ? 'Click canvas to place first vertex' : drawPoints.length < 3 ? `${drawPoints.length} vert${drawPoints.length > 1 ? 'ices' : 'ex'} · need ${3 - drawPoints.length} more` : `${drawPoints.length} vertices · click gold circle or Close to finish`}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Fill Type</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
              {DRAW_PRESETS.map(p => (
                <div key={p.type} onClick={() => setDrawPreset(p)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 5, cursor: 'pointer', background: drawPreset.type === p.type ? 'rgba(0,0,0,0.07)' : 'transparent', border: `1px solid ${drawPreset.type === p.type ? 'rgba(0,0,0,0.15)' : 'transparent'}` }}>
                  <div style={{ width: 11, height: 11, borderRadius: 2, background: p.bg, border: `1.5px solid ${p.border}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.68)' }}>{p.label}</span>
                  {drawPreset.type === p.type && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(0,0,0,0.4)' }}>✓</span>}
                </div>
              ))}
            </div>
            {drawPoints.length >= 3 && <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center', marginBottom: 6 }} onClick={closeShape}>Close Shape</button>}
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={cancelDraw}><Ic n="x" s={10} /> Cancel Drawing</button>
          </div>
        ) : activeTool ? (
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <div style={{ width: 11, height: 11, borderRadius: 2, background: activePalette?.bg, border: `1.5px solid ${activePalette?.border}`, flexShrink: 0, clipPath: activePalette?.clipPath || 'none' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)' }}>{activePalette?.label}</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Size (grid units)</div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <label style={{ fontSize: 9, color: 'rgba(0,0,0,0.35)', textAlign: 'center' }}>W</label>
                <input type="number" min="1" max={COLS} value={customW ?? activePalette?.w ?? 1} onChange={e => setCustomW(Math.max(1, Math.min(COLS, +e.target.value)))} style={{ width: '100%', textAlign: 'center', boxSizing: 'border-box' }} />
              </div>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.3)', paddingTop: 14 }}>×</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <label style={{ fontSize: 9, color: 'rgba(0,0,0,0.35)', textAlign: 'center' }}>H</label>
                <input type="number" min="1" max={ROWS} value={customH ?? activePalette?.h ?? 1} onChange={e => setCustomH(Math.max(1, Math.min(ROWS, +e.target.value)))} style={{ width: '100%', textAlign: 'center', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ fontSize: 9, color: 'rgba(0,0,0,0.3)', textAlign: 'center', marginBottom: 10 }}>{(customW ?? activePalette?.w) * GRID} × {(customH ?? activePalette?.h) * GRID} px</div>
            <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', marginBottom: 8, textAlign: 'center' }}>Click canvas to place</div>
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={cancelTool}><Ic n="x" s={10} /> Cancel</button>
          </div>
        ) : (
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', lineHeight: 1.55 }}>Select a block to place, or use <b>Draw Custom Dock</b> to trace any polygon shape.</div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6, paddingLeft: 2 }}>Freehand</div>
          <div onClick={drawMode ? cancelDraw : startDraw} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, cursor: 'pointer', background: drawMode ? 'var(--navy)' : 'var(--white)', border: `1px solid ${drawMode ? 'var(--navy)' : 'rgba(0,0,0,0.09)'}` }}>
            <Ic n="pen" s={12} c={drawMode ? '#fff' : 'rgba(0,0,0,0.5)'} />
            <span style={{ fontSize: 11.5, fontWeight: 500, color: drawMode ? '#fff' : 'rgba(0,0,0,0.72)' }}>Draw Custom Dock</span>
          </div>
        </div>

        {cats.map(cat => (
          <div key={cat}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6, paddingLeft: 2 }}>{cat}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {PALETTE.filter(p => p.cat === cat).map(item => {
                const isActive = activeTool === item.type;
                return (
                  <div key={item.type} onClick={() => selectTool(item.type)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 7, cursor: 'pointer', background: isActive ? 'var(--navy)' : 'var(--white)', border: `1px solid ${isActive ? 'var(--navy)' : 'rgba(0,0,0,0.09)'}`, transition: 'background 0.1s' }}>
                    <div style={{ width: 12, height: 12, borderRadius: item.clipPath ? 0 : 2, background: item.bg, border: `1.5px solid ${item.border}`, flexShrink: 0, clipPath: item.clipPath || 'none' }} />
                    <span style={{ fontSize: 11.5, fontWeight: 500, color: isActive ? '#fff' : 'rgba(0,0,0,0.72)', flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: 9, color: isActive ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.25)', whiteSpace: 'nowrap' }}>{item.w}×{item.h}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{items.length} element{items.length !== 1 ? 's' : ''}</span>
          {drawMode && drawPoints.length > 0 && <span style={{ fontSize: 11, color: '#b8965a', fontWeight: 600 }}>· {drawPoints.length} {drawPoints.length === 1 ? 'vertex' : 'vertices'} placed</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowGrid(g => !g)}>{showGrid ? 'Hide Grid' : 'Show Grid'}</button>
            {items.length > 0 && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => { setItems([]); setSelectedId(null); }}>Clear All</button>}
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{ minWidth: 90 }}>
              {saving ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error!' : 'Save Layout'}
            </button>
          </div>
        </div>

        <div onClick={handleCanvasClick} onMouseMove={handleMouseMove} style={{ width: CW, height: CH, position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#1a4a6a', cursor: drawMode || activeTool ? 'crosshair' : 'default', boxShadow: '0 4px 24px rgba(0,0,0,0.3)', backgroundImage: showGrid ? 'linear-gradient(to right,rgba(255,255,255,0.055) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,0.055) 1px,transparent 1px)' : 'none', backgroundSize: `${GRID}px ${GRID}px` }}>
          {rectItems.map(item => {
            const isSel = item.id === selectedId;
            const label = itemLabels[item.id] || item.tool?.label || '';
            const fs    = Math.min(11, Math.max(7, item.w * GRID / 8));
            return (
              <div key={item.id} onClick={e => handleItemClick(e, item)} style={{ position: 'absolute', left: item.gx * GRID, top: item.gy * GRID, width: item.w * GRID, height: item.h * GRID, background: item.tool?.bg, border: `${isSel ? 2 : 1.5}px solid ${isSel ? '#b8965a' : item.tool?.border}`, borderRadius: 5, boxShadow: isSel ? '0 0 0 3px rgba(184,150,90,0.35),0 2px 8px rgba(0,0,0,0.3)' : '0 1px 5px rgba(0,0,0,0.28)', cursor: activeTool || drawMode ? 'crosshair' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', userSelect: 'none', clipPath: item.tool?.clipPath || 'none' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '36%', background: 'rgba(255,255,255,0.11)', borderRadius: '4px 4px 0 0', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(0,0,0,0.1)', pointerEvents: 'none' }} />
                {!item.tool?.clipPath && <span style={{ fontSize: fs, fontWeight: 700, color: item.tool?.text, textTransform: 'uppercase', letterSpacing: '0.3px', textAlign: 'center', padding: '2px 4px', position: 'relative', zIndex: 1, lineHeight: 1.25 }}>{label}</span>}
              </div>
            );
          })}

          <svg style={{ position: 'absolute', inset: 0, width: CW, height: CH, pointerEvents: 'none', overflow: 'visible' }}>
            {polyItems.map(item => {
              const isSel = item.id === selectedId;
              const pts   = item.points.map(p => `${p.gx * GRID},${p.gy * GRID}`).join(' ');
              const c     = centroid(item.points);
              const label = itemLabels[item.id] || item.label;
              return (
                <g key={item.id} onClick={e => handleItemClick(e, item)} style={{ cursor: activeTool || drawMode ? 'crosshair' : 'pointer', pointerEvents: 'all' }}>
                  {isSel && <polygon points={pts} fill="none" stroke="#b8965a" strokeWidth={5} opacity={0.3} />}
                  <polygon points={pts} fill={item.fill} fillOpacity={0.88} stroke={isSel ? '#b8965a' : item.stroke} strokeWidth={isSel ? 2 : 1.5} />
                  <polygon points={pts} fill="rgba(255,255,255,0.07)" style={{ pointerEvents: 'none' }} />
                  <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight="700" fill={item.text} fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.3" style={{ pointerEvents: 'none' }}>{label.toUpperCase()}</text>
                </g>
              );
            })}
            {drawMode && drawPoints.length > 0 && (() => {
              const previewPts = [...drawPoints, hoverG].map(p => `${p.gx*GRID},${p.gy*GRID}`).join(' ');
              return (
                <g>
                  {drawPoints.length >= 2 && <polygon points={previewPts} fill={drawPreset.bg} fillOpacity={0.22} stroke="none" />}
                  <polyline points={drawPoints.map(p => `${p.gx*GRID},${p.gy*GRID}`).join(' ')} fill="none" stroke="#b8965a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <line x1={drawPoints[drawPoints.length-1].gx*GRID} y1={drawPoints[drawPoints.length-1].gy*GRID} x2={hoverG.gx*GRID} y2={hoverG.gy*GRID} stroke="#b8965a" strokeWidth={1.5} strokeDasharray="5 4" opacity={nearFirst ? 0.35 : 0.7} />
                  {drawPoints.length >= 3 && <line x1={hoverG.gx*GRID} y1={hoverG.gy*GRID} x2={drawPoints[0].gx*GRID} y2={drawPoints[0].gy*GRID} stroke="#b8965a" strokeWidth={1} strokeDasharray="4 5" opacity={nearFirst ? 0.6 : 0.25} />}
                  {drawPoints.map((p, i) => { const isFirst = i === 0; const r = isFirst && drawPoints.length >= 3 ? 8 : 4; return (<g key={i}><circle cx={p.gx*GRID} cy={p.gy*GRID} r={r} fill={isFirst ? '#b8965a' : '#fff'} stroke="#b8965a" strokeWidth={1.5} opacity={isFirst ? 0.9 : 1} />{isFirst && drawPoints.length >= 3 && <text x={p.gx*GRID} y={p.gy*GRID} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#fff" fontWeight="700" fontFamily="IBM Plex Sans">✕</text>}</g>); })}
                  <circle cx={hoverG.gx*GRID} cy={hoverG.gy*GRID} r={nearFirst ? 4 : 3} fill={nearFirst ? '#b8965a' : '#fff'} stroke="#b8965a" strokeWidth={1.5} opacity={0.85} />
                </g>
              );
            })()}
          </svg>

          {items.length === 0 && !drawMode && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.22)', marginBottom: 6 }}>Select a block from the palette</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.14)' }}>Click anywhere on the canvas to place it</div>
              </div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.32)', marginTop: 8, fontStyle: 'italic' }}>Canvas {COLS}×{ROWS} grid units · {GRID}px per unit · Shapes snap to grid intersections</div>
      </div>

      {/* ── Properties panel ── */}
      <div style={{ width: 196, flexShrink: 0 }}>
        {selectedItem ? (
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 14 }}>Properties</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Type</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 11, height: 11, borderRadius: 2, background: selectedItem.fill || selectedItem.tool?.bg, border: `1.5px solid ${selectedItem.stroke || selectedItem.tool?.border}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.7)' }}>{selectedItem.shape === 'polygon' ? selectedItem.label : selectedItem.tool?.label}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Custom Name</div>
                <input type="text" value={itemLabels[selectedItem.id] || ''} onChange={e => setItemLabels(prev => ({ ...prev, [selectedItem.id]: e.target.value }))} placeholder={selectedItem.shape === 'polygon' ? selectedItem.label : selectedItem.tool?.label} style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              {selectedItem.shape !== 'polygon' ? (
                <>
                  <div><div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Size</div><div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{selectedItem.w * GRID} × {selectedItem.h * GRID} px</div><div style={{ fontSize: 10, color: 'rgba(0,0,0,0.32)' }}>{selectedItem.w} × {selectedItem.h} grid units</div></div>
                  <div><div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Position</div><div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>Col {selectedItem.gx}, Row {selectedItem.gy}</div></div>
                </>
              ) : (
                <div><div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Shape</div><div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{selectedItem.points.length} vertices</div></div>
              )}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Layer</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center', fontSize: 10 }} onClick={() => reorder(selectedId, -1)}>↓ Back</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center', fontSize: 10 }} onClick={() => reorder(selectedId, 1)}>↑ Front</button>
                </div>
              </div>
              <button className="btn btn-danger btn-sm" style={{ justifyContent: 'center', marginTop: 2 }} onClick={deleteSelected}>Delete Element</button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '20px 18px' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.32)', textAlign: 'center', lineHeight: 1.7 }}>Click a placed element to view its properties.</div>
          </div>
        )}
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--white)', border: 'var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Tips</div>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', lineHeight: 1.8 }}>
            · Adjust <b>W × H</b> before placing to set custom size<br />
            · Triangles are great for breakwater corners<br />
            · <b>Draw Custom Dock</b> traces any polygon<br />
            · Click the gold vertex circle to close a drawn shape<br />
            · Use Back / Front to control layering<br />
            · <b>Save Layout</b> persists to the database
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MarinaMap() {
  const [tab, setTab] = useState('live');
  const [sel, setSel] = useState(null);
  const { piers, counts, loading } = useBerths();

  return (
    <div>
      <div className="tabs">
        {[['live','Marina Map'],['creator','Map Creator']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'live' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['Occupied',counts.occupied,'badge-blue'],['Available',counts.available,'badge-green'],['Reserved',counts.reserved,'badge-gold'],['Maintenance',counts.maintenance,'badge-red']].map(([l,c,b]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: 'var(--border)', borderRadius: 8, padding: '8px 14px' }}>
                <span className={`badge ${b}`}>{loading ? '…' : c}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.6)' }}>{l}</span>
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }}><Ic n="plus" s={12} />New Booking</button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>Loading map…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
              <div>
                <HarborMap piers={piers} selectedSlip={sel} onSelectSlip={setSel} />
                <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                  {[['Occupied','#c6dcf5','#3a7fc8'],['Available','#c2ecce','#38a860'],['Reserved','#f6e7b0','#c89020'],['Maintenance','#f5cccc','#c04040']].map(([l,bg,stroke]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 2, background: bg, border: `1.5px solid ${stroke}` }} />{l}
                    </div>
                  ))}
                </div>
              </div>
              {sel ? (
                <div className="detail">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div className="detail-title">Slip {sel.id}</div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
                  </div>
                  <div className="detail-sub">{sel.len} · {sel.status}</div>
                  <StatusBadge s={sel.status} />
                  <div style={{ marginTop: 14 }}>
                    {sel.vessel
                      ? [['Vessel',sel.vessel],['Owner',sel.owner||'—'],['Type',sel.type||'—'],['Draft',sel.draft||'—']].map(([k,v]) => (
                          <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                        ))
                      : <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Slip is {sel.status}.</div>
                    }
                  </div>
                  <div className="detail-actions">
                    {sel.status === 'available'   && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Book this Slip</button>}
                    {sel.status === 'occupied'    && <><button className="btn btn-primary" style={{ justifyContent: 'center' }}>View Booking</button><button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Check Out</button></>}
                    {sel.status === 'reserved'    && <button className="btn btn-primary" style={{ justifyContent: 'center' }}>View Reservation</button>}
                    {sel.status === 'maintenance' && <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Clear Flag</button>}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', textAlign: 'center', padding: '20px 0', lineHeight: 1.6 }}>
                    Click any slip on the map to view details, make a booking, or check a vessel out.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'creator' && <MapCreator />}
    </div>
  );
}
