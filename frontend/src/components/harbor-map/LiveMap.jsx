// frontend/src/components/harbor-map/LiveMap.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import usePiers from '../../hooks/usePiers.js'
import useBerths from '../../hooks/useBerths.js'
import useMapConfig from '../../hooks/useMapConfig.js'
import CanvasCore from './CanvasCore.jsx'
import BerthDetailPanel from './BerthDetailPanel.jsx'
import { computeAbsPosition, sortItemsForRender } from './mapBuilderUtils.js'

const STATUS_COLORS = {
  available:   { fill: 'rgba(26,140,46,0.2)',  stroke: '#1a8c2e' },
  occupied:    { fill: 'rgba(0,117,222,0.2)',   stroke: '#0075de' },
  reserved:    { fill: 'rgba(221,91,0,0.2)',    stroke: '#dd5b00' },
  maintenance: { fill: 'rgba(192,57,43,0.2)',   stroke: '#c0392b' },
}

// Build shapes[] for CanvasCore: env items + piers + berths with status colors
function buildLiveShapes(piers, berths, envItems) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

  const pierShapes = piers
    .filter(p => p.canvas_x != null)
    .map(p => ({
      id: `pier-${p.id}`, type: 'pier',
      absX: parseFloat(p.canvas_x), absY: parseFloat(p.canvas_y),
      w: p.canvas_w, h: p.canvas_h, rotation: p.rotation,
      fill: '#c8b97a', stroke: '#a8994a', label: p.code,
      meta: { pierId: p.id },
    }))

  const berthShapes = berths
    .filter(b => b.pier && b.local_x != null && pierById[b.pier])
    .map(b => {
      const pier = pierById[b.pier]
      const { absX, absY } = computeAbsPosition(
        { canvas_x: parseFloat(pier.canvas_x), canvas_y: parseFloat(pier.canvas_y), rotation: pier.rotation },
        { local_x: parseFloat(b.local_x), local_y: parseFloat(b.local_y) }
      )
      const col = STATUS_COLORS[b.status] ?? STATUS_COLORS.available
      return {
        id: `berth-${b.id}`, type: 'berth',
        absX, absY,
        w: 2, h: 1, rotation: 0,
        fill: col.fill, stroke: col.stroke,
        label: b.code,
        meta: { berthId: b.id, berthData: b },
      }
    })

  const envShapes = (envItems ?? []).map(item => ({
    ...item,
    absX: item.gx + item.w / 2,
    absY: item.gy + item.h / 2,
    fill: item.bg, stroke: item.border,
  }))

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}

const POLL_INTERVAL_MS = 30_000  // refresh berth statuses every 30 seconds

export default function LiveMap() {
  const { piers, loading: piersLoading } = usePiers()
  const { berths, loading: berthsLoading, refetch: refetchBerths } = useBerths()
  const { config, loading: cfgLoading } = useMapConfig()
  const [selectedBerth, setSelectedBerth] = useState(null)

  // Poll for status changes
  useEffect(() => {
    const timer = setInterval(refetchBerths, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refetchBerths])

  function handleItemClick(e, item) {
    if (item.type !== 'berth') return
    const berthData = item.meta?.berthData
    if (!berthData) return
    setSelectedBerth(berthData)
  }

  const envItems = useMemo(
    () => config?.env_items ?? config?.custom_elements ?? [],
    [config]
  )
  const shapes = useMemo(
    () => buildLiveShapes(piers, berths, envItems),
    [piers, berths, envItems]
  )

  if (piersLoading || berthsLoading || cfgLoading) {
    return <div style={{ padding: 40, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Loading harbor map…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0a1829' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <CanvasCore
          shapes={shapes}
          mode="viewer"
          onItemClick={handleItemClick}
        />
      </div>

      <BerthDetailPanel
        berth={selectedBerth}
        onClose={() => setSelectedBerth(null)}
      />
    </div>
  )
}
