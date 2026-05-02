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

  const [items,         setItems]         = useState([])
  const [customPrefabs, setCustomPrefabs] = useState([])
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [ghost,         setGhost]         = useState(null)
  const [drawMode,      setDrawMode]      = useState(false)
  const [drawPoints,    setDrawPoints]    = useState([])
  const [hoverG,        setHoverG]        = useState(null)
  const [saveStatus,    setSaveStatus]    = useState(null)
  const historyRef = useRef([])

  useEffect(() => {
    if (!config) return
    if (config.custom_elements) setItems(config.custom_elements)
    if (config.custom_prefabs)  setCustomPrefabs(config.custom_prefabs)
  }, [config])

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
        onPrefabDragStart={() => {}}
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
          onCanvasClick={() => {}}
          onCanvasPointerMove={() => {}}
          onCanvasPointerUp={() => {}}
          onCanvasDragOver={() => {}}
          onCanvasDrop={() => {}}
          onCanvasDragLeave={() => {}}
          onItemPointerDown={() => {}}
          onRotateHandlePointerDown={() => {}}
          onWallResizePointerDown={() => {}}
        />
      </div>

      <MapBuilderBerthPanel
        berths={berths}
        placedBerthIds={placedBerthIds}
        onBerthDragStart={() => {}}
      />
    </div>
  )
}
