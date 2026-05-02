// frontend/src/components/harbor-map/MapBuilder.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import useMapConfig from '../../hooks/useMapConfig.js'
import useBerths from '../../hooks/useBerths.js'
import usePiers from '../../hooks/usePiers.js'
import CanvasCore from './CanvasCore.jsx'
import MapBuilderPalette from './MapBuilderPalette.jsx'
import MapBuilderBerthPanel from './MapBuilderBerthPanel.jsx'
import {
  newId, snapToGrid, GRID, COLS, ROWS, rotateAndSnap, snapRotation,
  groupOrigin, sortItemsForRender, computeAbsPosition, snapBerthToPier,
} from './mapBuilderUtils.js'
import { PREFAB_BY_TYPE } from './mapBuilderPrefabs.js'
import api from '../../api.js'

// Docking prefab types that create Pier DB records when dropped
const DOCKING_TYPES = new Set([
  'parallel-wall', 'pier-v', 'pier-h', 'slip', 'slip-t', 'fuel-dock', 'gangway', 'ramp',
])

const TRANSPARENT_IMG = (() => {
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return img
})()

// Build shapes[] for CanvasCore from piers (DB), berths (DB), and env items (MarinaMapConfig)
function buildShapes(piers, berths, envItems, selectedIds) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

  // Pier shapes — center coords from DB
  const pierShapes = piers
    .filter(p => p.canvas_x != null && p.canvas_y != null)
    .map(p => ({
      id:       `pier-${p.id}`,
      _pierId:  p.id,
      type:     'pier',
      absX:     parseFloat(p.canvas_x),
      absY:     parseFloat(p.canvas_y),
      w:        p.canvas_w,
      h:        p.canvas_h,
      rotation: p.rotation,
      fill:     '#c8b97a',
      stroke:   '#a8994a',
      label:    p.code,
    }))

  // Berth shapes — position computed from parent pier
  const berthShapes = berths
    .filter(b => b.pier && b.local_x != null && pierById[b.pier])
    .map(b => {
      const pier = pierById[b.pier]
      const { absX, absY } = computeAbsPosition(
        { canvas_x: parseFloat(pier.canvas_x), canvas_y: parseFloat(pier.canvas_y), rotation: pier.rotation },
        { local_x: parseFloat(b.local_x), local_y: parseFloat(b.local_y) }
      )
      return {
        id:       `berth-${b.id}`,
        _berthId: b.id,
        type:     'berth',
        absX,
        absY,
        w:        2,
        h:        1,
        rotation: 0,
        fill:     'rgba(26,107,110,0.25)',
        stroke:   '#1a6b6e',
        label:    b.code,
      }
    })

  // Env shapes (non-DB items from MarinaMapConfig) — gx/gy are top-left, convert to center
  const envShapes = envItems.map(item => ({
    ...item,
    absX: item.gx + item.w / 2,
    absY: item.gy + item.h / 2,
    fill:   item.bg,
    stroke: item.border,
  }))

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}

export default function MapBuilder() {
  const { config, loading: cfgLoading, saveConfig } = useMapConfig()
  const { berths, loading: berthsLoading, refetch: refetchBerths } = useBerths()
  const { piers, loading: piersLoading, createPier, updatePierCanvas, deletePier } = usePiers()

  const [envItems,      setEnvItems]      = useState([])
  const [customPrefabs, setCustomPrefabs] = useState([])
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [ghost,         setGhost]         = useState(null)
  const [snapZones,     setSnapZones]     = useState([])
  const [saveStatus,    setSaveStatus]    = useState(null)
  const [canUndo,       setCanUndo]       = useState(false)

  const historyRef      = useRef([])
  const dragPayloadRef  = useRef(null)
  const moveRef         = useRef(null)
  const rotateRef       = useRef(null)

  useEffect(() => {
    if (!config) return
    if (config.env_items)      setEnvItems(config.env_items)
    if (config.custom_prefabs) setCustomPrefabs(config.custom_prefabs)
    // Legacy: migrate old custom_elements to env_items if present
    if (config.custom_elements && !config.env_items) {
      setEnvItems(config.custom_elements)
    }
  }, [config])

  const shapes = buildShapes(piers, berths, envItems, selectedIds)

  // ── Drag start ──────────────────────────────────────────────────────────────

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

  // ── Canvas drag over ─────────────────────────────────────────────────────────

  function handleCanvasDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const payload = dragPayloadRef.current
    if (!payload) return

    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)

    const w = payload.kind === 'prefab' ? payload.prefab.w : 2
    const h = payload.kind === 'prefab' ? payload.prefab.h : 1

    if (payload.kind === 'berth') {
      const placedPiers = piers.filter(p => p.canvas_x != null)
        .map(p => ({
          id: p.id,
          canvas_x: parseFloat(p.canvas_x),
          canvas_y: parseFloat(p.canvas_y),
          canvas_w: p.canvas_w,
          canvas_h: p.canvas_h,
          rotation: p.rotation,
        }))
      const snap = snapBerthToPier(gx, gy, placedPiers, w, h)
      if (snap) {
        setGhost({ absX: snap.absX, absY: snap.absY, w, h, fill: 'rgba(42,157,153,0.35)', stroke: '#2a9d99' })
        setSnapZones([{ absX: snap.absX, absY: snap.absY, w, h }])
        return
      }
      setSnapZones([])
    }

    const fill   = payload.kind === 'prefab' ? (payload.prefab.bg ?? '#888') : 'rgba(26,107,110,0.35)'
    const stroke = payload.kind === 'prefab' ? (payload.prefab.border ?? '#aaa') : '#1a6b6e'
    setGhost({ absX: gx + w / 2, absY: gy + h / 2, w, h, fill, stroke })
  }

  // ── Canvas drop ──────────────────────────────────────────────────────────────

  async function handleCanvasDrop(e) {
    e.preventDefault()
    const payload = dragPayloadRef.current
    dragPayloadRef.current = null
    if (!payload || !ghost) { setGhost(null); setSnapZones([]); return }

    if (payload.kind === 'berth') {
      const placedPiers = piers.filter(p => p.canvas_x != null)
        .map(p => ({
          id: p.id,
          canvas_x: parseFloat(p.canvas_x),
          canvas_y: parseFloat(p.canvas_y),
          canvas_w: p.canvas_w,
          canvas_h: p.canvas_h,
          rotation: p.rotation,
        }))
      const rect = e.currentTarget.getBoundingClientRect()
      const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
      const snap = snapBerthToPier(gx, gy, placedPiers, 2, 1)
      if (snap) {
        await api.patch(`/berths/${payload.berth.id}/`, {
          pier: snap.pierId,
          local_x: snap.local_x.toFixed(2),
          local_y: snap.local_y.toFixed(2),
          position_on_parent: snap.position_on_parent,
        })
        await refetchBerths()
      }
      setGhost(null)
      setSnapZones([])
      return
    }

    // Prefab drop
    const p = payload.prefab
    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
    const dropCenterX = gx + p.w / 2
    const dropCenterY = gy + p.h / 2

    if (DOCKING_TYPES.has(p.type)) {
      // Creates a Pier DB record
      await createPier({
        code:     `${p.type.toUpperCase()}-${newId().slice(0, 4).toUpperCase()}`,
        pier_type: p.type === 'pier-v' || p.type === 'pier-h' ? 'concrete' : 'pontoon',
        canvas_x:  dropCenterX.toFixed(2),
        canvas_y:  dropCenterY.toFixed(2),
        canvas_w:  p.w,
        canvas_h:  p.h,
        rotation:  0,
      })
    } else {
      // Environmental item — goes to MarinaMapConfig
      const newItem = {
        id: newId(), type: p.type, shape: 'rect',
        gx, gy, w: p.w, h: p.h,
        bg: p.bg, border: p.border, label: p.label ?? '',
        rotation: 0,
      }
      historyRef.current = [...historyRef.current.slice(-19), envItems]
      setEnvItems(prev => [...prev, newItem])
      setCanUndo(true)
    }

    setGhost(null)
    setSnapZones([])
  }

  // ── Pointer events for moving pier shapes ────────────────────────────────────

  function handleItemPointerDown(e, item) {
    if (!item._pierId) return   // only piers are draggable in builder
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedIds(new Set([item.id]))
    moveRef.current = {
      pierId: item._pierId,
      startAbsX: item.absX,
      startAbsY: item.absY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    }
  }

  function handleCanvasPointerMove(e) {
    if (!moveRef.current || e.buttons === 0) return
    const { startAbsX, startAbsY, startClientX, startClientY } = moveRef.current
    const dgx = (e.clientX - startClientX) / GRID
    const dgy = (e.clientY - startClientY) / GRID
    if (Math.abs(dgx) < 0.1 && Math.abs(dgy) < 0.1) return
    moveRef.current.moved = true
    // Live update: mutate piers state optimistically for smooth drag
    // (actual API call on pointer up)
    moveRef.current.liveX = startAbsX + dgx
    moveRef.current.liveY = startAbsY + dgy
    // Force re-render by triggering a state update
    setSelectedIds(prev => new Set(prev))
  }

  async function handleCanvasPointerUp() {
    if (moveRef.current?.moved && moveRef.current.pierId) {
      const { pierId, liveX, liveY } = moveRef.current
      await updatePierCanvas(pierId, liveX.toFixed(2), liveY.toFixed(2))
    }
    moveRef.current = null
  }

  // ── Undo (env items only) ────────────────────────────────────────────────────

  function handleUndo() {
    if (!historyRef.current.length) return
    setEnvItems(historyRef.current.pop())
    setCanUndo(historyRef.current.length > 0)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.key === 'z') handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Save env items to MarinaMapConfig ───────────────────────────────────────

  async function handleSave() {
    setSaveStatus('saving')
    const ok = await saveConfig({ ...(config ?? {}), env_items: envItems, custom_prefabs: customPrefabs })
    setSaveStatus(ok ? 'saved' : 'error')
    setTimeout(() => setSaveStatus(null), 2500)
  }

  const saveLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? '✓ Saved'
    : saveStatus === 'error' ? 'Error!'
    : 'Save'

  // A berth is placed when it has a pier FK and local coordinates
  const placedBerthIds = new Set(berths.filter(b => b.pier != null && b.local_x != null).map(b => b.id))

  if (cfgLoading || berthsLoading || piersLoading) {
    return <div style={{ padding: 40, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0a1829' }}>
      <MapBuilderPalette
        customPrefabs={customPrefabs}
        selectedIds={selectedIds}
        drawMode={false}
        onPrefabDragStart={handlePrefabDragStart}
        onStartDraw={() => {}}
        onGroupToPrefab={() => {}}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', position: 'relative' }}>
        <div style={{
          display: 'flex', gap: 8, padding: '8px 12px',
          background: '#0c1f3d', borderBottom: '1px solid #1e3a5f', alignItems: 'center',
        }}>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              style={{ fontSize: 11, padding: '4px 12px', background: '#1e3a5f', border: '1px solid #2a5a7a', borderRadius: 4, color: '#c8d8e8', cursor: 'pointer' }}
            >
              Undo
            </button>
            <button
              onClick={handleSave}
              style={{ fontSize: 11, padding: '4px 14px', background: '#b8965a', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', fontWeight: 600 }}
            >
              {saveLabel}
            </button>
          </div>
        </div>

        <CanvasCore
          shapes={shapes}
          mode="builder"
          snapZones={snapZones}
          selectedIds={selectedIds}
          ghost={ghost}
          onItemPointerDown={handleItemPointerDown}
          onCanvasPointerMove={handleCanvasPointerMove}
          onCanvasPointerUp={handleCanvasPointerUp}
          onCanvasClick={() => setSelectedIds(new Set())}
          onCanvasDragOver={handleCanvasDragOver}
          onCanvasDrop={handleCanvasDrop}
          onCanvasDragLeave={() => { setGhost(null); setSnapZones([]) }}
        />
      </div>

      <MapBuilderBerthPanel
        berths={berths}
        placedBerthIds={placedBerthIds}
        onBerthDragStart={handleBerthDragStart}
      />
    </div>
  )
}
