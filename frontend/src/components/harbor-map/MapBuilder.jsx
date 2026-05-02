import { useState, useEffect, useRef, useCallback } from 'react'
import useMapConfig from '../../hooks/useMapConfig.js'
import useBerths from '../../hooks/useBerths.js'
import MapBuilderCanvas from './MapBuilderCanvas.jsx'
import MapBuilderPalette from './MapBuilderPalette.jsx'
import MapBuilderBerthPanel from './MapBuilderBerthPanel.jsx'
import { newId, snapToGrid, wallSnapPos, GRID, COLS, ROWS, rotateAndSnap, snapRotation } from './mapBuilderUtils.js'

export default function MapBuilder() {
  const { config, loading: cfgLoading, saveConfig } = useMapConfig()
  const { berths, loading: berthsLoading } = useBerths()

  const [items,         setItems]         = useState([])
  const [customPrefabs, setCustomPrefabs] = useState([])
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [ghost,         setGhost]         = useState(null)
  const [drawMode,      setDrawMode]      = useState(false)
  const [drawPoints,    setDrawPoints]    = useState([])
  const [hoverG,        setHoverG]        = useState(null)
  const [saveStatus,    setSaveStatus]    = useState(null)
  const historyRef = useRef([])
  const dragPayloadRef = useRef(null)
  const moveRef = useRef(null)
  // { itemId, startGx, startGy, startClientX, startClientY, moved, snapshot }
  const rotateRef = useRef(null)
  // { itemId, itemSnapshot, centerX, centerY }

  useEffect(() => {
    if (!config) return
    if (config.custom_elements) setItems(config.custom_elements)
    if (config.custom_prefabs)  setCustomPrefabs(config.custom_prefabs)
  }, [config])

  function closePolygon() {
    // Implemented in Task 13
  }

  const pushHistory = useCallback((prevItems) => {
    historyRef.current = [...historyRef.current.slice(-19), prevItems]
  }, [])

  const mutateItems = useCallback((updater) => {
    setItems(prev => {
      pushHistory(prev)
      return updater(prev)
    })
  }, [pushHistory])

  function handleItemPointerDown(e, item) {
    if (drawMode) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)

    if (e.shiftKey) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.has(item.id) ? next.delete(item.id) : next.add(item.id)
        return next
      })
    } else {
      setSelectedIds(new Set([item.id]))
    }

    moveRef.current = {
      itemId: item.id,
      startGx: item.gx,
      startGy: item.gy,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      snapshot: items,
    }
  }

  function handleRotateHandlePointerDown(e, item) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const centerX = (item.gx + item.w / 2) * GRID
    const centerY = (item.gy + item.h / 2) * GRID
    rotateRef.current = {
      itemId: item.id,
      itemSnapshot: { gx: item.gx, gy: item.gy, w: item.w, h: item.h },
      centerX,
      centerY,
      snapshot: items,
    }
  }

  function handleCanvasPointerMove(e) {
    if (rotateRef.current) {
      const svgRect = document.querySelector('.mb-canvas')?.getBoundingClientRect()
      if (!svgRect) return
      const { centerX, centerY, itemId, itemSnapshot } = rotateRef.current
      const mx = e.clientX - svgRect.left - centerX
      const my = e.clientY - svgRect.top  - centerY
      // atan2 with +90° offset so "up" = 0°
      const rawDeg = (Math.atan2(my, mx) * 180) / Math.PI + 90
      const snapped = snapRotation(rawDeg)
      const { gx, gy, w, h } = rotateAndSnap(
        itemSnapshot.gx, itemSnapshot.gy,
        itemSnapshot.w,  itemSnapshot.h,
        snapped
      )
      setItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, gx, gy, w, h, rotation: snapped } : i
      ))
      return
    }

    if (drawMode && e.buttons === 0) {
      const rect = e.currentTarget.getBoundingClientRect()
      const gx = Math.round((e.clientX - rect.left) / GRID)
      const gy = Math.round((e.clientY - rect.top) / GRID)
      setHoverG({ gx: Math.max(0, Math.min(COLS - 1, gx)), gy: Math.max(0, Math.min(ROWS - 1, gy)) })
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

  function handleCanvasPointerUp() {
    if (rotateRef.current) {
      historyRef.current = [...historyRef.current.slice(-19), rotateRef.current.snapshot]
      rotateRef.current = null
      return
    }

    if (moveRef.current?.moved && moveRef.current.snapshot) {
      historyRef.current = [...historyRef.current.slice(-19), moveRef.current.snapshot]
    }
    moveRef.current = null
  }

  function handleCanvasClick(e) {
    if (drawMode) {
      const rect = e.currentTarget.getBoundingClientRect()
      const gx = Math.round((e.clientX - rect.left) / GRID)
      const gy = Math.round((e.clientY - rect.top) / GRID)
      const snappedGx = Math.max(0, Math.min(COLS - 1, gx))
      const snappedGy = Math.max(0, Math.min(ROWS - 1, gy))

      if (drawPoints.length >= 3) {
        const f = drawPoints[0]
        if (Math.abs(snappedGx - f.gx) <= 1 && Math.abs(snappedGy - f.gy) <= 1) {
          closePolygon()
          return
        }
      }
      setDrawPoints(prev => [...prev, { gx: snappedGx, gy: snappedGy }])
      return
    }
    setSelectedIds(new Set())
  }

  function handlePrefabDragStart(e, prefab) {
    dragPayloadRef.current = { kind: 'prefab', prefab }
    e.dataTransfer.effectAllowed = 'copy'
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

  function handleCanvasDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const payload = dragPayloadRef.current
    if (!payload) return

    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)

    const w = payload.kind === 'prefab' ? payload.prefab.w : 2
    const h = payload.kind === 'prefab' ? payload.prefab.h : 1
    const bg     = payload.kind === 'prefab' ? payload.prefab.bg     : '#2a5f8f'
    const border = payload.kind === 'prefab' ? payload.prefab.border : '#5a8fbf'

    let pos = { gx, gy }
    let snapBorder = border

    if (payload.kind === 'berth') {
      const walls = items.filter(i => i.type === 'parallel-wall')
      const snap = wallSnapPos(gx, gy, w, walls)
      if (snap) {
        pos = { gx: snap.gx, gy: snap.gy }
        snapBorder = '#38a860'
      }
    }

    setGhost({ gx: pos.gx, gy: pos.gy, w, h, bg, border: snapBorder })
  }

  function handleCanvasDrop(e) {
    e.preventDefault()
    const payload = dragPayloadRef.current
    dragPayloadRef.current = null
    if (!payload || !ghost) { setGhost(null); return }

    if (payload.kind === 'prefab') {
      const p = payload.prefab

      const customPrefab = customPrefabs.find(cp => cp.id === p.type)
      if (customPrefab) {
        if (customPrefab.kind === 'group') {
          const newItems = customPrefab.elements.map(el => ({
            ...el,
            id: newId(),
            gx: ghost.gx + el.gx,
            gy: ghost.gy + el.gy,
          }))
          mutateItems(prev => [...prev, ...newItems])
          setSelectedIds(new Set(newItems.map(i => i.id)))
        } else if (customPrefab.kind === 'polygon') {
          const newItem = {
            id: newId(), type: customPrefab.id, shape: 'polygon',
            points: customPrefab.points.map(pt => ({ gx: ghost.gx + pt.gx, gy: ghost.gy + pt.gy })),
            fill: customPrefab.fill, stroke: customPrefab.stroke,
            label: customPrefab.name, rotation: 0,
            customPrefabId: customPrefab.id,
          }
          mutateItems(prev => [...prev, newItem])
          setSelectedIds(new Set([newItem.id]))
        }
        setGhost(null)
        return
      }

      const newItem = {
        id: newId(), type: p.type, shape: 'rect',
        gx: ghost.gx, gy: ghost.gy, w: p.w, h: p.h,
        bg: p.bg, border: p.border, label: p.label,
        rotation: 0,
      }
      mutateItems(prev => [...prev, newItem])
      setSelectedIds(new Set([newItem.id]))

    } else {
      const berth = payload.berth
      const walls = items.filter(i => i.type === 'parallel-wall')
      const snap = wallSnapPos(ghost.gx, ghost.gy, 2, walls)
      const newItem = {
        id: newId(), type: 'berth', shape: 'rect',
        gx: ghost.gx, gy: ghost.gy, w: 2, h: 1,
        bg: '#2a5f8f', border: '#5a8fbf', label: berth.code,
        rotation: 0,
        berthId: berth.id,
        ...(snap ? { snapWallId: snap.snapWallId, slotIndex: snap.slotIndex } : {}),
      }
      mutateItems(prev => [...prev, newItem])
      setSelectedIds(new Set([newItem.id]))
    }

    setGhost(null)
  }

  function handleCanvasDragLeave() {
    setGhost(null)
  }

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

  useEffect(() => {
    function onKey(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        mutateItems(prev => prev.filter(i => !selectedIds.has(i.id)))
        setSelectedIds(new Set())
      }
      if (e.ctrlKey && e.key === 'z') handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, mutateItems])

  const placedBerthIds = new Set(items.filter(i => i.berthId).map(i => i.berthId))

  const saveLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved'  ? '✓ Saved'
    : saveStatus === 'error'  ? 'Error!'
    : 'Save'

  if (cfgLoading || berthsLoading) {
    return <div style={{ padding: 40, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0a1829' }}>
      <MapBuilderPalette
        customPrefabs={customPrefabs}
        selectedIds={selectedIds}
        drawMode={drawMode}
        onPrefabDragStart={handlePrefabDragStart}
        onStartDraw={() => setDrawMode(true)}
        onGroupToPrefab={() => {}}
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
            <button
              onClick={() => {}}
              style={{ fontSize: 11, padding: '3px 10px', background: '#1e3a5f', border: '1px solid #b8965a', borderRadius: 4, color: '#b8965a', cursor: 'pointer' }}>
              Close Shape
            </button>
          )}
          {drawMode && (
            <button
              onClick={() => { setDrawMode(false); setDrawPoints([]) }}
              style={{ fontSize: 11, padding: '3px 10px', background: 'none', border: '1px solid #3a5a7a', borderRadius: 4, color: '#7a9ab8', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={handleUndo}
              disabled={!historyRef.current.length}
              style={{ fontSize: 11, padding: '4px 12px', background: '#1e3a5f', border: '1px solid #2a5a7a', borderRadius: 4, color: '#c8d8e8', cursor: 'pointer' }}>
              Undo
            </button>
            <button
              onClick={handleSave}
              style={{ fontSize: 11, padding: '4px 14px', background: '#b8965a', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', fontWeight: 600 }}>
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
          onCanvasClick={handleCanvasClick}
          onCanvasPointerMove={handleCanvasPointerMove}
          onCanvasPointerUp={handleCanvasPointerUp}
          onCanvasDragOver={handleCanvasDragOver}
          onCanvasDrop={handleCanvasDrop}
          onCanvasDragLeave={handleCanvasDragLeave}
          onItemPointerDown={handleItemPointerDown}
          onRotateHandlePointerDown={handleRotateHandlePointerDown}
          onWallResizePointerDown={() => {}}
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
