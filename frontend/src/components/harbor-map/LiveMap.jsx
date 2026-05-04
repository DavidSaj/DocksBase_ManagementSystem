// frontend/src/components/harbor-map/LiveMap.jsx
import { useState, useEffect, useMemo, useRef } from 'react'
import usePiers from '../../hooks/usePiers.js'
import useBerths from '../../hooks/useBerths.js'
import useMapConfig from '../../hooks/useMapConfig.js'
import CanvasCore from './CanvasCore.jsx'
import BerthDetailPanel from './BerthDetailPanel.jsx'
import { computeAbsPosition, sortItemsForRender, berthCanvasDims, berthDimsForPier } from './mapBuilderUtils.js'
import api from '../../api.js'

const WS_BASE = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000')

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
      const col = STATUS_COLORS[b.effective_status ?? b.status] ?? STATUS_COLORS.available
      const { berthW, berthH } = berthCanvasDims(b, pier)
      return {
        id: `berth-${b.id}`, type: 'berth',
        absX, absY,
        w: berthW, h: berthH, rotation: 0,
        fill: col.fill, stroke: col.stroke,
        label: b.code,
        meta: { berthId: b.id, berthData: b },
      }
    })

  const envShapes = (envItems ?? []).map(item => {
    if (item.isPolygon) return { ...item, fill: item.bg, stroke: item.border }
    return { ...item, absX: item.gx + item.w / 2, absY: item.gy + item.h / 2, fill: item.bg, stroke: item.border }
  })

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}

const POLL_INTERVAL_MS = 30_000  // fallback poll when WebSocket is not connected

function BroadcastModal({ piers, onClose }) {
  const [pierId, setPierId] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  async function send() {
    if (!message.trim()) return
    setSending(true)
    setResult(null)
    try {
      const body = { message: message.trim() }
      if (pierId) body.pier_id = Number(pierId)
      const { data } = await api.post('/broadcast/', body)
      setResult({ ok: true, text: data.detail })
    } catch (err) {
      setResult({ ok: false, text: err.response?.data?.detail || err.message || 'Broadcast failed.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: 28, width: 420, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: '#c0392b' }}>
          Emergency Broadcast
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.55)', marginBottom: 4 }}>Send to</div>
          <select
            value={pierId}
            onChange={e => setPierId(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
          >
            <option value=''>All occupied berths</option>
            {piers.map(p => (
              <option key={p.id} value={p.id}>Pier {p.code}{p.label ? ` — ${p.label}` : ''}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.55)', marginBottom: 4 }}>Message</div>
          <textarea
            rows={4}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder='Type your emergency message here…'
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd',
              fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 3 }}>{message.length} / 160 chars (1 SMS)</div>
        </div>

        {result && (
          <div style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
            background: result.ok ? '#e8f7ec' : '#fdecea',
            color: result.ok ? '#1a7a32' : '#c0392b',
          }}>
            {result.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #ddd',
            background: '#fff', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button onClick={send} disabled={sending || !message.trim()} style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: '#c0392b', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            opacity: (sending || !message.trim()) ? 0.6 : 1,
          }}>
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LiveMap({ onBerthsChange, focusBerth } = {}) {
  const { piers, loading: piersLoading } = usePiers()
  const { berths: initialBerths, loading: berthsLoading, refetch: refetchBerths } = useBerths()
  const { config, loading: cfgLoading } = useMapConfig()
  const [selectedBerth, setSelectedBerth] = useState(null)
  const [broadcastOpen, setBroadcastOpen] = useState(false)

  // Pan/zoom
  const [zoom, setZoom] = useState(0.10)
  const [pan,  setPan]  = useState({ x: 0, y: 0 })
  const viewRef      = useRef({ zoom: 0.10, pan: { x: 0, y: 0 } })
  const panDragRef   = useRef(null)
  const containerRef = useRef(null)

  // Local berth state — starts from API, updated in real-time via WebSocket
  const [berths, setBerths] = useState([])
  useEffect(() => { setBerths(initialBerths) }, [initialBerths])

  // WebSocket — connect on mount, fall back to 30s polling if unavailable
  const wsRef = useRef(null)
  const wsConnected = useRef(false)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/ws/berths/?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => { wsConnected.current = true }

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type !== 'berth_update') return
          setBerths(prev => prev.map(b =>
            b.id === msg.berth_id
              ? { ...b, status: msg.status, pier: msg.pier, local_x: msg.local_x, local_y: msg.local_y }
              : b
          ))
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = () => {
        wsConnected.current = false
        wsRef.current = null
      }

      ws.onerror = () => { ws.close() }
    }

    connect()
    return () => { wsRef.current?.close() }
  }, [])

  // Fallback polling — only runs if WebSocket is not connected
  useEffect(() => {
    const timer = setInterval(() => {
      if (!wsConnected.current) refetchBerths()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refetchBerths])

  // Notify parent whenever berths data changes
  useEffect(() => {
    if (onBerthsChange) onBerthsChange(berths)
  }, [berths, onBerthsChange])

  // Pan/zoom to a focused berth when focusBerth prop changes
  useEffect(() => {
    if (!focusBerth || !containerRef.current) return
    const pier = piers.find(p => p.id === focusBerth.pier)
    if (!pier) return
    const { absX, absY } = computeAbsPosition(
      { canvas_x: parseFloat(pier.canvas_x), canvas_y: parseFloat(pier.canvas_y), rotation: pier.rotation },
      { local_x: parseFloat(focusBerth.local_x), local_y: parseFloat(focusBerth.local_y) }
    )
    const targetZoom = 0.6
    const rect = containerRef.current.getBoundingClientRect()
    const GRID = 32
    const newPan = {
      x: rect.width  / 2 - absX * GRID * targetZoom,
      y: rect.height / 2 - absY * GRID * targetZoom,
    }
    viewRef.current = { zoom: targetZoom, pan: newPan }
    setZoom(targetZoom)
    setPan(newPan)
    setSelectedBerth(focusBerth)
  }, [focusBerth, piers])

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
        // Pinch-to-zoom on trackpad (sent as ctrlKey + deltaY)
        const factor = e.deltaY < 0 ? 1.03 : 1 / 1.03
        const newZoom = Math.max(0.08, Math.min(5, viewRef.current.zoom * factor))
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const { pan } = viewRef.current
        const ratio = newZoom / viewRef.current.zoom
        const newPan = { x: mx - (mx - pan.x) * ratio, y: my - (my - pan.y) * ratio }
        viewRef.current = { zoom: newZoom, pan: newPan }
        setZoom(newZoom)
        setPan(newPan)
      } else {
        // Two-finger scroll on trackpad = pan
        const newPan = { x: viewRef.current.pan.x - e.deltaX, y: viewRef.current.pan.y - e.deltaY }
        viewRef.current.pan = newPan
        setPan(newPan)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

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
    return <div style={{ padding: 40, color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>Loading harbor map…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>
      {/* Pan/zoom viewport */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: 'grab' }}
        onPointerDown={e => {
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
        <div style={{
          transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0', display: 'inline-block',
        }}>
          <CanvasCore
            shapes={shapes}
            mode="viewer"
            zoom={zoom}
            onItemClick={handleItemClick}
          />
        </div>

        {/* Zoom controls — inside containerRef so they're not clipped by the card wrapper */}
        <div style={{
          position: 'absolute', bottom: 16, right: 16, zIndex: 10,
          display: 'flex', alignItems: 'center',
          background: 'rgba(255,255,255,0.93)', borderRadius: 20,
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)', border: '1px solid rgba(0,0,0,0.1)',
          pointerEvents: 'auto',
        }}>
          <button
            onClick={e => { e.stopPropagation(); const z = Math.max(0.08, viewRef.current.zoom / 1.2); viewRef.current.zoom = z; setZoom(z) }}
            style={{ width: 32, height: 32, borderRadius: '20px 0 0 20px', border: 'none', cursor: 'pointer', background: 'none', fontSize: 18, color: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', minWidth: 40, textAlign: 'center', padding: '0 4px', borderLeft: '1px solid rgba(0,0,0,0.08)', borderRight: '1px solid rgba(0,0,0,0.08)' }}>{Math.round(zoom * 100)}%</span>
          <button
            onClick={e => { e.stopPropagation(); const z = Math.min(5, viewRef.current.zoom * 1.2); viewRef.current.zoom = z; setZoom(z) }}
            style={{ width: 32, height: 32, borderRadius: '0 20px 20px 0', border: 'none', cursor: 'pointer', background: 'none', fontSize: 18, color: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
        </div>

        {/* Emergency broadcast — bottom-left, inside containerRef so it's not clipped */}
        <button
          className="btn btn-danger"
          onClick={e => { e.stopPropagation(); setBroadcastOpen(true) }}
          title="Emergency SMS broadcast to all boaters"
          style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 10,
            pointerEvents: 'auto',
            background: 'rgba(255,255,255,0.93)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1,5 L1,9 L4,9 L8,12 L8,2 L4,5 Z" />
            <path d="M10,4.5 Q12,7 10,9.5" />
            <path d="M11.5,3 Q14.5,7 11.5,11" />
          </svg>
          Emergency Broadcast
        </button>
      </div>

      <BerthDetailPanel
        berth={selectedBerth}
        onClose={() => setSelectedBerth(null)}
      />

      {broadcastOpen && (
        <BroadcastModal piers={piers} onClose={() => setBroadcastOpen(false)} />
      )}
    </div>
  )
}
