// frontend/src/components/harbor-map/MapBuilder.jsx
import { useState, useEffect, useRef } from 'react'
import useMapConfig from '../../hooks/useMapConfig.js'
import useBerths from '../../hooks/useBerths.js'
import usePiers from '../../hooks/usePiers.js'
import CanvasCore from './CanvasCore.jsx'
import MapBuilderPalette from './MapBuilderPalette.jsx'
import MapBuilderBerthPanel from './MapBuilderBerthPanel.jsx'
import {
  newId, snapToGrid, GRID, COLS, ROWS, METERS_PER_GU,
  sortItemsForRender, computeAbsPosition, snapBerthToPier, snapPierToPier, berthCanvasDims, berthDimsForPier,
} from './mapBuilderUtils.js'
import { TERRAIN_TOOLS, MATERIALS, buildComboDockLayout, PREFAB_TO_PIER_TYPE } from './mapBuilderPrefabs.js'
import api from '../../api.js'

// All prefab types that become Pier DB records when dropped
const DOCKING_TYPES = new Set([
  'parallel-wall', 'pier-v', 'pier-h', 'pontoon-spine-h', 'pontoon-spine-v',
  'pontoon-spine-h-stone', 'pontoon-spine-v-stone',
  'slip', 'slip-t', 'fuel-dock', 'gangway', 'ramp',
])

// pier_type → canvas colors (includes specialized dock types)
const PIER_COLORS = {
  pontoon:    { fill: '#c8b97a', stroke: '#a89940' },
  concrete:   { fill: '#b0aaa2', stroke: '#888480' },
  steel:      { fill: '#8a9aaa', stroke: '#607080' },
  'fuel-dock': { fill: '#f0d878', stroke: '#c8a820' },
  gangway:    { fill: '#d0c888', stroke: '#a8a060' },
  ramp:       { fill: '#c8c0aa', stroke: '#a8a088' },
}
function pierColors(pier) {
  return PIER_COLORS[pier.pier_type] ?? PIER_COLORS.pontoon
}

const TRANSPARENT_IMG = (() => {
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return img
})()

// ── Build Combo Dock modal ───────────────────────────────────────────────────

function BuildComboDockModal({ onClose, onBuild }) {
  const [numFingers,    setNumFingers]    = useState(5)
  const [berthLengthM,  setBerthLengthM]  = useState(10)
  const [berthBeamM,    setBerthBeamM]    = useState(3)
  const [material,      setMaterial]      = useState('pontoon')
  const [prefabName,    setPrefabName]    = useState('')

  const fingerLenGU  = Math.max(2, Math.round(berthLengthM / METERS_PER_GU))
  const berthBeamGU  = Math.max(1, Math.round(berthBeamM  / METERS_PER_GU))
  const mat          = MATERIALS[material]
  const layout       = buildComboDockLayout({ numFingers, fingerLen: fingerLenGU, berthBeamGU, bg: mat.bg, border: mat.border })
  const label        = prefabName.trim() || `${numFingers}-Finger Dock (${berthLengthM}m)`

  function confirm() {
    onBuild({
      type: `custom-${newId()}`,
      label,
      w: layout.w, h: layout.h,
      bg: mat.bg, border: mat.border,
      material,
      compound: true,
      components: layout.components,
    })
    onClose()
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }} onClick={onClose}>
      <div style={{ background:'#fff',borderRadius:10,padding:28,width:440,maxWidth:'92vw',boxShadow:'var(--shadow2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:700,fontSize:15,marginBottom:20 }}>Build Combo Dock</div>

        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16 }}>
          <div>
            <div className="field-label">Number of fingers</div>
            <select className="field-input" value={numFingers} onChange={e => setNumFingers(Number(e.target.value))}>
              {[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Material</div>
            <select className="field-input" value={material} onChange={e => setMaterial(e.target.value)}>
              {Object.entries(MATERIALS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Berth length (m)</div>
            <input className="field-input" type="number" min={4} max={50} step={1}
              value={berthLengthM} onChange={e => setBerthLengthM(Number(e.target.value))} />
            <div style={{ fontSize:11,color:'rgba(0,0,0,0.4)',marginTop:2 }}>finger pier will be {fingerLenGU} grid units long</div>
          </div>
          <div>
            <div className="field-label">Berth beam / width (m)</div>
            <input className="field-input" type="number" min={1} max={20} step={0.5}
              value={berthBeamM} onChange={e => setBerthBeamM(Number(e.target.value))} />
            <div style={{ fontSize:11,color:'rgba(0,0,0,0.4)',marginTop:2 }}>spacing: {1 + 2*berthBeamGU} grid units between fingers</div>
          </div>
          <div style={{ gridColumn:'1/-1' }}>
            <div className="field-label">Prefab name (optional)</div>
            <input className="field-input" placeholder={label} value={prefabName} onChange={e => setPrefabName(e.target.value)} />
          </div>
        </div>

        {/* Mini preview */}
        <div style={{ marginBottom:16,padding:'10px 12px',background:'var(--bg)',borderRadius:6,fontSize:12,color:'rgba(0,0,0,0.5)' }}>
          Layout: {layout.w.toFixed(1)} × {layout.h.toFixed(1)} grid units — drag from the Custom palette section to place
        </div>

        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm}>Add to Prefabs</button>
        </div>
      </div>
    </div>
  )
}

// ── Build Finger Pier modal ──────────────────────────────────────────────────

function BuildFingerPierModal({ onClose, onBuild }) {
  const [lengthM,   setLengthM]   = useState(12)
  const [direction, setDirection] = useState('v')
  const [material,  setMaterial]  = useState('pontoon')
  const [name,      setName]      = useState('')

  const lenGU = Math.max(2, Math.round(lengthM / METERS_PER_GU))
  const mat   = MATERIALS[material]
  const w     = direction === 'v' ? 1 : lenGU
  const h     = direction === 'v' ? lenGU : 1
  const label = name.trim() || `${material === 'pontoon' ? 'Pontoon' : material === 'concrete' ? 'Concrete' : 'Steel'} Pier (${lengthM}m)`

  function confirm() {
    onBuild({
      type: `custom-${newId()}`,
      label,
      w, h,
      bg: mat.bg, border: mat.border,
      material,
      compound: false,
    })
    onClose()
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }} onClick={onClose}>
      <div style={{ background:'#fff',borderRadius:10,padding:28,width:380,maxWidth:'92vw',boxShadow:'var(--shadow2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:700,fontSize:15,marginBottom:20 }}>Build Finger Pier</div>

        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16 }}>
          <div>
            <div className="field-label">Length (m)</div>
            <input className="field-input" type="number" min={2} max={80} step={1}
              value={lengthM} onChange={e => setLengthM(Number(e.target.value))} />
            <div style={{ fontSize:11,color:'rgba(0,0,0,0.4)',marginTop:2 }}>{lenGU} grid units</div>
          </div>
          <div>
            <div className="field-label">Direction</div>
            <select className="field-input" value={direction} onChange={e => setDirection(e.target.value)}>
              <option value="v">N–S (vertical)</option>
              <option value="h">E–W (horizontal)</option>
            </select>
          </div>
          <div>
            <div className="field-label">Material</div>
            <select className="field-input" value={material} onChange={e => setMaterial(e.target.value)}>
              {Object.entries(MATERIALS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Name (optional)</div>
            <input className="field-input" placeholder={label} value={name} onChange={e => setName(e.target.value)} />
          </div>
        </div>

        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm}>Add to Prefabs</button>
        </div>
      </div>
    </div>
  )
}

// ── Selected item panel ───────────────────────────────────────────────────────

function SelectedItemPanel({ shape, pier, onRotate, onDelete, onResize, onClose }) {
  const [w, setW] = useState(Math.round(shape.w * 10) / 10)
  const [h, setH] = useState(Math.round(shape.h * 10) / 10)
  useEffect(() => {
    setW(Math.round(shape.w * 10) / 10)
    setH(Math.round(shape.h * 10) / 10)
  }, [shape.id, shape.w, shape.h])

  const rot = shape.rotation ?? 0
  const pierType = pier?.pier_type ?? shape.type

  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }
  const label = { fontSize: 10, color: 'rgba(0,0,0,0.4)', fontWeight: 600, letterSpacing: '0.5px' }
  const rotBtn = {
    width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)',
    background: 'var(--white)', cursor: 'pointer', fontSize: 16, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, zIndex: 20,
      background: '#fff', borderRadius: 10, padding: '14px 16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)', width: 210,
      border: '1px solid rgba(0,0,0,0.09)', fontSize: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'rgba(0,0,0,0.85)' }}>{shape.label || 'Pier'}</div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2, textTransform: 'capitalize' }}>
            {pierType.replace(/-/g, ' ')}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
          color: 'rgba(0,0,0,0.3)', lineHeight: 1, padding: '0 2px',
        }}>×</button>
      </div>

      {/* Rotation */}
      <div style={{ marginBottom: 10 }}>
        <div style={label}>ROTATION</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button style={rotBtn} onClick={() => onRotate(-10)} title="Rotate −10°">↺</button>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{rot}°</span>
          <button style={rotBtn} onClick={() => onRotate(+10)} title="Rotate +10°">↻</button>
        </div>
      </div>

      {/* Size */}
      <div style={{ marginBottom: 12 }}>
        <div style={label}>SIZE (grid units)</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', marginBottom: 2 }}>W</div>
            <input type="number" value={w} min={0.5} step={0.5}
              onChange={e => setW(parseFloat(e.target.value) || 1)}
              style={{ width: '100%', padding: '4px 6px', borderRadius: 5, border: '1px solid #ddd', fontSize: 12 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', marginBottom: 2 }}>H</div>
            <input type="number" value={h} min={0.5} step={0.5}
              onChange={e => setH(parseFloat(e.target.value) || 1)}
              style={{ width: '100%', padding: '4px 6px', borderRadius: 5, border: '1px solid #ddd', fontSize: 12 }} />
          </div>
          <button
            onClick={() => onResize(w, h)}
            style={{ padding: '5px 8px', borderRadius: 5, border: 'none', background: 'var(--navy,#1a3a5c)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}
          >Apply</button>
        </div>
      </div>

      {/* Delete */}
      <button onClick={onDelete} style={{
        width: '100%', padding: '7px', borderRadius: 6, border: '1px solid rgba(192,57,43,0.4)',
        background: 'rgba(192,57,43,0.06)', color: '#c0392b', cursor: 'pointer',
        fontSize: 12, fontWeight: 600,
      }}>
        Delete
      </button>
    </div>
  )
}

// ── Shape builder ────────────────────────────────────────────────────────────

function buildShapes(piers, berths, envItems, dragOverride) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

  const pierShapes = piers
    .filter(p => p.canvas_x != null && p.canvas_y != null)
    .map(p => {
      const ov = dragOverride?.pierId === p.id ? dragOverride : null
      const { fill, stroke } = pierColors(p)
      return {
        id: `pier-${p.id}`, _pierId: p.id, type: 'pier',
        absX: ov ? ov.absX : parseFloat(p.canvas_x),
        absY: ov ? ov.absY : parseFloat(p.canvas_y),
        w: ov?.w ?? p.canvas_w, h: ov?.h ?? p.canvas_h, rotation: p.rotation,
        fill, stroke, label: p.code,
      }
    })

  const berthShapes = berths
    .filter(b => b.pier && b.local_x != null && pierById[b.pier])
    .map(b => {
      const pier = pierById[b.pier]
      const { absX, absY } = computeAbsPosition(
        { canvas_x: parseFloat(pier.canvas_x), canvas_y: parseFloat(pier.canvas_y), rotation: pier.rotation },
        { local_x: parseFloat(b.local_x), local_y: parseFloat(b.local_y) }
      )
      const { berthW, berthH } = berthCanvasDims(b, pier)
      return {
        id: `berth-${b.id}`, _berthId: b.id, type: 'berth',
        absX, absY, w: berthW, h: berthH, rotation: 0,
        fill: 'rgba(26,107,110,0.25)', stroke: '#1a6b6e', label: b.code,
      }
    })

  const envShapes = envItems.map(item => {
    if (item.isPolygon) return { ...item, fill: item.bg, stroke: item.border }
    return { ...item, absX: item.gx + item.w / 2, absY: item.gy + item.h / 2, fill: item.bg, stroke: item.border }
  })

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MapBuilder() {
  const { config, loading: cfgLoading, saveConfig } = useMapConfig()
  const { berths, loading: berthsLoading, refetch: refetchBerths } = useBerths()
  const { piers, loading: piersLoading, createPier, updatePierCanvas, patchPier, deletePier } = usePiers()

  const [envItems,      setEnvItems]      = useState([])
  const [customPrefabs, setCustomPrefabs] = useState([])
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [ghost,         setGhost]         = useState(null)
  const [snapZones,     setSnapZones]     = useState([])
  const [saveStatus,    setSaveStatus]    = useState(null)
  const [canUndo,       setCanUndo]       = useState(false)
  const [dragOverride,  setDragOverride]  = useState(null)

  // Draw mode
  const [drawTool,   setDrawTool]   = useState(null)
  const [drawPoints, setDrawPoints] = useState([])
  const [drawCursor, setDrawCursor] = useState(null)

  // Modals
  const [showComboDock,   setShowComboDock]   = useState(false)
  const [showFingerPier,  setShowFingerPier]  = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Pan/zoom
  const [zoom, setZoom] = useState(0.07)
  const [pan,  setPan]  = useState({ x: 0, y: 0 })
  const viewRef      = useRef({ zoom: 0.07, pan: { x: 0, y: 0 } })
  const panDragRef   = useRef(null)
  const containerRef = useRef(null)

  // Unified undo stack — entries: {type:'env',items} | {type:'pier',id} | {type:'piers',ids}
  const undoStackRef   = useRef([])
  const dragPayloadRef = useRef(null)
  const moveRef        = useRef(null)
  const resizeRef      = useRef(null)
  // Keep current envItems accessible in closures (avoids stale captures in useEffect keydown)
  const envItemsRef    = useRef(envItems)
  useEffect(() => { envItemsRef.current = envItems }, [envItems])

  useEffect(() => {
    if (!config) return
    if (config.env_items)      setEnvItems(config.env_items)
    if (config.custom_prefabs) setCustomPrefabs(config.custom_prefabs)
    if (config.custom_elements && !config.env_items) setEnvItems(config.custom_elements)
  }, [config])

  const shapes = buildShapes(piers, berths, envItems, dragOverride)

  // ── Undo ──────────────────────────────────────────────────────────────────

  function pushUndo(entry) {
    undoStackRef.current = [...undoStackRef.current, entry].slice(-25)
    setCanUndo(true)
  }

  async function handleUndo() {
    if (!undoStackRef.current.length) return
    const entry = undoStackRef.current.pop()
    setCanUndo(undoStackRef.current.length > 0)
    try {
      if (entry.type === 'env') {
        setEnvItems(entry.items)
      } else if (entry.type === 'pier') {
        await deletePier(entry.id)
        refetchBerths()
      } else if (entry.type === 'piers') {
        await Promise.all(entry.ids.map(id => deletePier(id)))
        refetchBerths()
      }
    } catch (err) {
      console.error('[MapBuilder] undo failed', err)
    }
  }

  // ── Clear layout ──────────────────────────────────────────────────────────

  async function handleClear() {
    setShowClearConfirm(false)
    try {
      await Promise.all(piers.map(p => deletePier(p.id)))
      setEnvItems([])
      undoStackRef.current = []
      setCanUndo(false)
      await saveConfig({ ...(config ?? {}), env_items: [], custom_prefabs: customPrefabs })
      refetchBerths()
    } catch (err) {
      console.error('[MapBuilder] clear failed', err)
    }
  }

  // ── Terrain draw tools ────────────────────────────────────────────────────

  function selectDrawTool(tool) {
    setDrawTool(prev => prev?.type === tool.type ? null : tool)
    setDrawPoints([])
    setDrawCursor(null)
    setSelectedIds(new Set())
  }

  function handleClickDraw({ gx, gy }) {
    setDrawPoints(pts => [...pts, { gx, gy }])
  }

  function handleDoubleClickDraw({ gx, gy }) {
    setDrawPoints(pts => {
      const trimmed = pts.slice(0, -1)
      const finalPts = trimmed.length >= 1 ? [...trimmed, { gx, gy }] : trimmed
      if (finalPts.length >= 3 && drawTool) {
        const newItem = {
          id: newId(), type: drawTool.type, isPolygon: true,
          points: finalPts, bg: drawTool.bg, border: drawTool.border, label: drawTool.label,
        }
        pushUndo({ type: 'env', items: envItemsRef.current })
        setEnvItems(prev => [...prev, newItem])
      }
      return []
    })
    setDrawCursor(null)
  }

  // ── Custom prefab creation (from build dialogs) ───────────────────────────

  async function handleBuildPrefab(prefab) {
    const next = [...customPrefabs, prefab]
    setCustomPrefabs(next)
    await saveConfig({ ...(config ?? {}), env_items: envItems, custom_prefabs: next })
  }

  async function handleDeleteCustomPrefab(prefabType) {
    const next = customPrefabs.filter(p => p.type !== prefabType)
    setCustomPrefabs(next)
    await saveConfig({ ...(config ?? {}), env_items: envItems, custom_prefabs: next })
  }

  // ── Drag start ────────────────────────────────────────────────────────────

  function handlePrefabDragStart(e, prefab) {
    dragPayloadRef.current = { kind: 'prefab', prefab }
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setDragImage(TRANSPARENT_IMG, 0, 0)
  }

  function handleBerthDragStart(e, berth) {
    dragPayloadRef.current = { kind: 'berth', berth }
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setDragImage(TRANSPARENT_IMG, 0, 0)
  }

  // ── Canvas drag over ──────────────────────────────────────────────────────

  function handleCanvasDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const payload = dragPayloadRef.current
    if (!payload) return

    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect, zoom)

    if (payload.kind === 'berth') {
      const b = payload.berth
      const placedPiers = piers.filter(p => p.canvas_x != null).map(p => ({
        id: p.id,
        canvas_x: parseFloat(p.canvas_x), canvas_y: parseFloat(p.canvas_y),
        canvas_w: p.canvas_w, canvas_h: p.canvas_h, rotation: p.rotation,
      }))
      const snap = snapBerthToPier(gx, gy, placedPiers, b)
      if (snap) {
        setGhost({ absX: snap.absX, absY: snap.absY, w: snap.berthW, h: snap.berthH, fill: 'rgba(42,157,153,0.35)', stroke: '#2a9d99' })
        setSnapZones([{ absX: snap.absX, absY: snap.absY, w: snap.berthW, h: snap.berthH }])
        return
      }
      // Unsnapped ghost — show actual berth size vertically as default
      const { berthW, berthH } = berthCanvasDims(b, { canvas_w: 1, canvas_h: 2 })
      setSnapZones([])
      setGhost({ absX: gx + berthW / 2, absY: gy + berthH / 2, w: berthW, h: berthH, fill: 'rgba(26,107,110,0.35)', stroke: '#1a6b6e' })
      return
    }

    const p2 = payload.prefab
    const fill   = p2.bg ?? '#888'
    const stroke = p2.border ?? '#aaa'
    setGhost({ absX: gx + p2.w / 2, absY: gy + p2.h / 2, w: p2.w, h: p2.h, fill, stroke })
  }

  // ── Canvas drop ───────────────────────────────────────────────────────────

  async function handleCanvasDrop(e) {
    e.preventDefault()
    const payload = dragPayloadRef.current
    dragPayloadRef.current = null
    if (!payload || !ghost) { setGhost(null); setSnapZones([]); return }

    try {
      if (payload.kind === 'berth') {
        const placedPiers = piers.filter(p => p.canvas_x != null).map(p => ({
          id: p.id,
          canvas_x: parseFloat(p.canvas_x), canvas_y: parseFloat(p.canvas_y),
          canvas_w: p.canvas_w, canvas_h: p.canvas_h, rotation: p.rotation,
        }))
        const rect = e.currentTarget.getBoundingClientRect()
        const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect, zoom)
        const snap = snapBerthToPier(gx, gy, placedPiers, payload.berth)
        if (snap) {
          await api.patch(`/berths/${payload.berth.id}/`, {
            pier: snap.pierId,
            local_x: snap.local_x.toFixed(2),
            local_y: snap.local_y.toFixed(2),
            position_on_parent: snap.position_on_parent,
          })
          await refetchBerths()
        }
        return
      }

      const p = payload.prefab
      const rect = e.currentTarget.getBoundingClientRect()
      const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect, zoom)

      if (p.compound && p.components) {
        const suffix   = newId().slice(0, 3).toUpperCase()
        const pierType = p.material ?? 'pontoon'
        const componentsWithIds = p.components.map(comp => ({
          id:   `c_${newId()}`,
          type: comp.pier_type === 'pontoon' ? 'spine' : 'finger',
          ox:   comp.ox - p.w / 2,   // convert from top-left-relative to pier-center-relative
          oy:   comp.oy - p.h / 2,
          w:    comp.canvas_w,
          h:    comp.canvas_h,
        }))
        const created = await createPier({
          code:       suffix,
          pier_type:  pierType,
          canvas_x:   (gx + p.w / 2).toFixed(2),
          canvas_y:   (gy + p.h / 2).toFixed(2),
          canvas_w:   p.w,
          canvas_h:   p.h,
          rotation:   0,
          components: componentsWithIds,
        })
        pushUndo({ type: 'pier', id: created.id })
        setSelectedIds(new Set([`pier-${created.id}`]))
      } else if (DOCKING_TYPES.has(p.type) || p.type.startsWith('custom-')) {
        const pier_type = p.material ?? PREFAB_TO_PIER_TYPE[p.type] ?? 'pontoon'
        const created = await createPier({
          code:      `${p.type.toUpperCase().slice(0,4)}-${newId().slice(0,4).toUpperCase()}`,
          pier_type,
          canvas_x:  (gx + p.w / 2).toFixed(2),
          canvas_y:  (gy + p.h / 2).toFixed(2),
          canvas_w:  p.w,
          canvas_h:  p.h,
          rotation:  0,
        })
        pushUndo({ type: 'pier', id: created.id })
        setSelectedIds(new Set([`pier-${created.id}`]))
      } else {
        const newItem = {
          id: newId(), type: p.type, shape: 'rect',
          gx, gy, w: p.w, h: p.h,
          bg: p.bg, border: p.border, label: p.label ?? '',
          rotation: 0,
        }
        pushUndo({ type: 'env', items: envItemsRef.current })
        setEnvItems(prev => [...prev, newItem])
      }
    } catch (err) {
      const detail = err?.response?.data ? JSON.stringify(err.response.data) : err.message
      console.error('[MapBuilder] drop failed:', detail, err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(null), 2500)
    } finally {
      setGhost(null)
      setSnapZones([])
    }
  }

  // ── Pier pointer drag ─────────────────────────────────────────────────────

  function handleItemPointerDown(e, item) {
    if (!item._pierId) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedIds(new Set([item.id]))
    moveRef.current = {
      pierId: item._pierId,
      startAbsX: item.absX, startAbsY: item.absY,
      startClientX: e.clientX, startClientY: e.clientY,
      moved: false,
    }
  }

  function handleResizeHandlePointerDown(e, item, handle) {
    if (!item._pierId) return
    e.stopPropagation()
    resizeRef.current = {
      handle,
      pierId: item._pierId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startW: item.w,
      startH: item.h,
      startAbsX: item.absX,
      startAbsY: item.absY,
    }
  }

  function handleCanvasPointerMove(e) {
    if (drawTool) {
      const rect = e.currentTarget.getBoundingClientRect()
      setDrawCursor(snapToGrid(e.clientX, e.clientY, rect, viewRef.current.zoom))
      return
    }

    // Resize handle drag
    if (resizeRef.current && e.buttons !== 0) {
      const { handle, startClientX, startClientY, startW, startH, startAbsX, startAbsY } = resizeRef.current
      const dgx = (e.clientX - startClientX) / (GRID * zoom)
      const dgy = (e.clientY - startClientY) / (GRID * zoom)
      let newW = startW, newH = startH, newAbsX = startAbsX, newAbsY = startAbsY
      if (handle === 'n') { newH = Math.max(0.5, startH - dgy); newAbsY = startAbsY + (startH - newH) / 2 }
      if (handle === 's') { newH = Math.max(0.5, startH + dgy); newAbsY = startAbsY + (newH - startH) / 2 }
      if (handle === 'w') { newW = Math.max(0.5, startW - dgx); newAbsX = startAbsX + (startW - newW) / 2 }
      if (handle === 'e') { newW = Math.max(0.5, startW + dgx); newAbsX = startAbsX + (newW - startW) / 2 }
      resizeRef.current.liveW = newW
      resizeRef.current.liveH = newH
      resizeRef.current.liveAbsX = newAbsX
      resizeRef.current.liveAbsY = newAbsY
      setDragOverride({ pierId: resizeRef.current.pierId, absX: newAbsX, absY: newAbsY, w: newW, h: newH })
      return
    }

    // Move drag
    if (!moveRef.current || e.buttons === 0) return
    const { startAbsX, startAbsY, startClientX, startClientY } = moveRef.current
    const dgx = (e.clientX - startClientX) / (GRID * zoom)
    const dgy = (e.clientY - startClientY) / (GRID * zoom)
    if (Math.abs(dgx) < 0.1 && Math.abs(dgy) < 0.1) return
    moveRef.current.moved = true
    let liveX = startAbsX + dgx
    let liveY = startAbsY + dgy

    // Pier-to-pier edge snapping
    const draggedPier = piers.find(p => p.id === moveRef.current.pierId)
    if (draggedPier) {
      const others = piers
        .filter(p => p.id !== moveRef.current.pierId && p.canvas_x != null)
        .map(p => ({ canvas_x: parseFloat(p.canvas_x), canvas_y: parseFloat(p.canvas_y), canvas_w: p.canvas_w, canvas_h: p.canvas_h }))
      const snap = snapPierToPier(liveX, liveY, draggedPier.canvas_w, draggedPier.canvas_h, others)
      if (snap) { liveX = snap.x; liveY = snap.y }
    }

    moveRef.current.liveX = liveX
    moveRef.current.liveY = liveY
    setDragOverride({ pierId: moveRef.current.pierId, absX: liveX, absY: liveY })
  }

  async function handleCanvasPointerUp() {
    try {
      if (resizeRef.current) {
        const { pierId, liveW, liveH, liveAbsX, liveAbsY } = resizeRef.current
        if (liveW !== undefined) {
          await patchPier(pierId, {
            canvas_w: Math.round(liveW * 2) / 2,
            canvas_h: Math.round(liveH * 2) / 2,
            canvas_x: parseFloat(liveAbsX).toFixed(2),
            canvas_y: parseFloat(liveAbsY).toFixed(2),
          })
        }
      } else if (moveRef.current?.moved && moveRef.current.pierId) {
        const { pierId, liveX, liveY } = moveRef.current
        await updatePierCanvas(pierId, liveX.toFixed(2), liveY.toFixed(2))
      }
    } catch (err) {
      console.error('[MapBuilder] pier move/resize failed', err)
    } finally {
      resizeRef.current = null
      moveRef.current = null
      setDragOverride(null)
    }
  }

  // ── Selected item actions ─────────────────────────────────────────────────

  const selectedShape = selectedIds.size === 1
    ? shapes.find(s => selectedIds.has(s.id))
    : null
  const selectedPier = selectedShape?._pierId
    ? piers.find(p => p.id === selectedShape._pierId)
    : null

  async function handleRotateSelected(deltaDeg) {
    if (!selectedPier) return
    const newRot = (((selectedPier.rotation ?? 0) + deltaDeg) % 360 + 360) % 360
    await updatePierCanvas(selectedPier.id, selectedPier.canvas_x, selectedPier.canvas_y, newRot)
  }

  async function handleResizeSelected(w, h) {
    if (!selectedPier) return
    await patchPier(selectedPier.id, { canvas_w: w, canvas_h: h })
  }

  async function handleDeleteSelected() {
    if (!selectedPier) return
    await deletePier(selectedPier.id)
    setSelectedIds(new Set())
    refetchBerths()
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { setDrawTool(null); setDrawPoints([]); setDrawCursor(null) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Non-passive wheel → pan/zoom (window-level to prevent browser page zoom) ─

  useEffect(() => {
    function onWheel(e) {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const over = e.clientX >= rect.left && e.clientX <= rect.right
                && e.clientY >= rect.top  && e.clientY <= rect.bottom
      if (!over) return
      e.preventDefault()
      if (e.ctrlKey) {
        const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05
        const newZoom = Math.max(0.03, Math.min(5, viewRef.current.zoom * factor))
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const { pan } = viewRef.current
        const ratio = newZoom / viewRef.current.zoom
        const newPan = { x: mx - (mx - pan.x) * ratio, y: my - (my - pan.y) * ratio }
        viewRef.current = { zoom: newZoom, pan: newPan }
        setZoom(newZoom)
        setPan(newPan)
      } else {
        const newPan = { x: viewRef.current.pan.x - e.deltaX, y: viewRef.current.pan.y - e.deltaY }
        viewRef.current.pan = newPan
        setPan(newPan)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveStatus('saving')
    const ok = await saveConfig({ ...(config ?? {}), env_items: envItems, custom_prefabs: customPrefabs })
    setSaveStatus(ok ? 'saved' : 'error')
    setTimeout(() => setSaveStatus(null), 2500)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error!' : 'Save'
  const placedBerthIds = new Set(berths.filter(b => b.is_placed).map(b => b.id))
  const isDrawMode = !!drawTool

  if (cfgLoading || berthsLoading || piersLoading) {
    return <div style={{ padding: 40, color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      <MapBuilderPalette
        customPrefabs={customPrefabs}
        selectedIds={selectedIds}
        drawMode={isDrawMode}
        onPrefabDragStart={handlePrefabDragStart}
        onBuildComboDock={() => setShowComboDock(true)}
        onBuildFingerPier={() => setShowFingerPier(true)}
        onDeleteCustomPrefab={handleDeleteCustomPrefab}
      />

      {/* Center canvas + toolbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', gap: 6, padding: '7px 10px', flexWrap: 'wrap',
          background: 'var(--white)', borderBottom: 'var(--border)', alignItems: 'center',
          flexShrink: 0,
        }}>
          {/* Terrain draw */}
          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', fontWeight: 700, letterSpacing: '0.5px' }}>DRAW</span>
          {TERRAIN_TOOLS.map(tool => (
            <button key={tool.type} onClick={() => selectDrawTool(tool)} style={{
              fontSize: 11, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
              border: drawTool?.type === tool.type ? `1.5px solid ${tool.border}` : 'var(--border)',
              background: drawTool?.type === tool.type ? tool.bg : 'var(--white)',
              color: 'rgba(0,0,0,0.65)', fontWeight: drawTool?.type === tool.type ? 600 : 400,
            }}>
              {tool.icon} {tool.label}
            </button>
          ))}

          <div style={{ width: 1, height: 18, background: 'rgba(0,0,0,0.1)' }} />

          {/* Move mode */}
          <button onClick={() => { setDrawTool(null); setDrawPoints([]); setDrawCursor(null) }} style={{
            fontSize: 11, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
            border: !isDrawMode ? '1.5px solid var(--navy)' : 'var(--border)',
            background: !isDrawMode ? 'var(--navy)' : 'var(--white)',
            color: !isDrawMode ? '#fff' : 'rgba(0,0,0,0.6)',
            fontWeight: !isDrawMode ? 600 : 400,
          }}>
            ✋ Move
          </button>

          {isDrawMode && drawPoints.length > 0 && (
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
              {drawPoints.length} pts — double-click to finish, Esc to cancel
            </span>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={handleUndo} disabled={!canUndo} className="btn btn-sm" style={{ opacity: canUndo ? 1 : 0.35 }}>
              Undo
            </button>
            <button onClick={handleSave} className="btn btn-gold btn-sm">{saveLabel}</button>
            {showClearConfirm ? (
              <>
                <span style={{ fontSize: 11, color: 'var(--red)' }}>Clear everything?</span>
                <button onClick={handleClear} className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none' }}>Yes, clear</button>
                <button onClick={() => setShowClearConfirm(false)} className="btn btn-sm btn-ghost">No</button>
              </>
            ) : (
              <button onClick={() => setShowClearConfirm(true)} className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Pan/zoom viewport */}
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: isDrawMode ? 'crosshair' : 'grab' }}
          onPointerDown={e => {
            if (isDrawMode) return
            if (e.button !== 0 && e.button !== 1) return
            panDragRef.current = {
              startClientX: e.clientX, startClientY: e.clientY,
              startPanX: viewRef.current.pan.x, startPanY: viewRef.current.pan.y,
              captured: false,
            }
          }}
          onPointerMove={e => {
            if (!panDragRef.current) return
            const dx = e.clientX - panDragRef.current.startClientX
            const dy = e.clientY - panDragRef.current.startClientY
            if (!panDragRef.current.captured) {
              if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
              panDragRef.current.captured = true
              e.currentTarget.setPointerCapture(e.pointerId)
            }
            const newPan = { x: panDragRef.current.startPanX + dx, y: panDragRef.current.startPanY + dy }
            viewRef.current.pan = newPan
            setPan(newPan)
          }}
          onPointerUp={() => { panDragRef.current = null }}
        >
          {/* Zoom controls */}
          <div style={{
            position: 'absolute', bottom: 12, right: 12, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 0,
            background: 'rgba(255,255,255,0.93)', borderRadius: 20,
            boxShadow: '0 2px 10px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.1)',
          }}>
            <button
              onClick={() => { const z = Math.max(0.03, viewRef.current.zoom / 1.3); viewRef.current.zoom = z; setZoom(z) }}
              style={{ width: 32, height: 32, borderRadius: '20px 0 0 20px', border: 'none', cursor: 'pointer', background: 'none', fontSize: 18, color: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', minWidth: 40, textAlign: 'center', padding: '0 4px', borderLeft: '1px solid rgba(0,0,0,0.08)', borderRight: '1px solid rgba(0,0,0,0.08)' }}>{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => { const z = Math.min(5, viewRef.current.zoom * 1.3); viewRef.current.zoom = z; setZoom(z) }}
              style={{ width: 32, height: 32, borderRadius: '0 20px 20px 0', border: 'none', cursor: 'pointer', background: 'none', fontSize: 18, color: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          </div>

          {selectedShape && selectedPier && !isDrawMode && (
            <SelectedItemPanel
              shape={selectedShape}
              pier={selectedPier}
              onRotate={handleRotateSelected}
              onResize={handleResizeSelected}
              onDelete={handleDeleteSelected}
              onClose={() => setSelectedIds(new Set())}
            />
          )}

          <div style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', display: 'inline-block' }}>
            <CanvasCore
              shapes={shapes}
              mode={isDrawMode ? 'draw' : 'builder'}
              zoom={zoom}
              drawPoints={drawPoints}
              drawCursor={drawCursor}
              drawTool={drawTool}
              snapZones={isDrawMode ? [] : snapZones}
              selectedIds={isDrawMode ? new Set() : selectedIds}
              ghost={isDrawMode ? null : ghost}
              onItemPointerDown={isDrawMode ? undefined : handleItemPointerDown}
              onResizeHandlePointerDown={isDrawMode ? undefined : handleResizeHandlePointerDown}
              onCanvasPointerMove={handleCanvasPointerMove}
              onCanvasPointerUp={isDrawMode ? undefined : handleCanvasPointerUp}
              onCanvasClick={isDrawMode ? undefined : () => setSelectedIds(new Set())}
              onCanvasClickDraw={isDrawMode ? handleClickDraw : undefined}
              onCanvasDoubleClickDraw={isDrawMode ? handleDoubleClickDraw : undefined}
              onCanvasDragOver={isDrawMode ? undefined : handleCanvasDragOver}
              onCanvasDrop={isDrawMode ? undefined : handleCanvasDrop}
              onCanvasDragLeave={isDrawMode ? undefined : () => { setGhost(null); setSnapZones([]) }}
            />
          </div>
        </div>
      </div>

      <MapBuilderBerthPanel
        berths={berths}
        placedBerthIds={placedBerthIds}
        onBerthDragStart={handleBerthDragStart}
      />

      {showComboDock  && <BuildComboDockModal  onClose={() => setShowComboDock(false)}  onBuild={handleBuildPrefab} />}
      {showFingerPier && <BuildFingerPierModal onClose={() => setShowFingerPier(false)} onBuild={handleBuildPrefab} />}
    </div>
  )
}
