import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import LiveMap from '../LiveMap.jsx'

// ── Mock hooks ────────────────────────────────────────────────────────────────
vi.mock('../../../hooks/usePiers.js', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useBerths.js', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useMapConfig.js', () => ({ default: vi.fn() }))

// Mock CanvasCore to a simple clickable renderer we can control
vi.mock('../CanvasCore.jsx', () => ({
  default: vi.fn(({ shapes, onItemClick }) => (
    <div data-testid="canvas-core">
      {shapes.map(shape => (
        <div
          key={shape.id}
          data-testid={`shape-${shape.id}`}
          data-type={shape.type}
          onClick={e => onItemClick && onItemClick(e, shape)}
        />
      ))}
    </div>
  )),
}))

// Mock BerthDetailPanel to a simple sentinel
vi.mock('../BerthDetailPanel.jsx', () => ({
  default: vi.fn(({ berth, onClose }) =>
    berth ? (
      <div data-testid="berth-detail-panel">
        <span data-testid="berth-code">{berth.code}</span>
        <button data-testid="close-btn" onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Mock mapBuilderUtils to avoid heavy geometry logic
vi.mock('../mapBuilderUtils.js', () => ({
  computeAbsPosition: vi.fn((_pier, berth) => ({
    absX: parseFloat(berth.local_x) + 5,
    absY: parseFloat(berth.local_y) + 5,
  })),
  sortItemsForRender: vi.fn(items => items),
  berthCanvasDims: vi.fn(() => ({ berthW: 1, berthH: 2 })),
  berthDimsForPier: vi.fn(() => ({ berthW: 1, berthH: 2 })),
}))

// ── Mock api.js (needed transitively by BerthDetailPanel real module before mock kicks in)
vi.mock('../../../api.js', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}))

import usePiers from '../../../hooks/usePiers.js'
import useBerths from '../../../hooks/useBerths.js'
import useMapConfig from '../../../hooks/useMapConfig.js'

// ── Default mock data ─────────────────────────────────────────────────────────
const defaultRefetch = vi.fn()

const defaultPier = {
  id: 1,
  code: 'A',
  canvas_x: '5',
  canvas_y: '5',
  canvas_w: 4,
  canvas_h: 8,
  rotation: 0,
}

const defaultBerth = {
  id: 10,
  code: 'A01',
  status: 'available',
  pier: 1,
  local_x: '1',
  local_y: '1',
}

function setupDefaultMocks({ piersLoading = false, berthsLoading = false, cfgLoading = false } = {}) {
  usePiers.mockReturnValue({ piers: [defaultPier], loading: piersLoading, error: null })
  useBerths.mockReturnValue({
    berths: [defaultBerth],
    loading: berthsLoading,
    error: null,
    refetch: defaultRefetch,
  })
  useMapConfig.mockReturnValue({ config: null, loading: cfgLoading, error: null })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('LiveMap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setupDefaultMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows loading message while piers are loading', () => {
      setupDefaultMocks({ piersLoading: true })
      render(<LiveMap />)
      expect(screen.getByText(/loading harbor map/i)).not.toBeNull()
    })

    it('shows loading message while berths are loading', () => {
      setupDefaultMocks({ berthsLoading: true })
      render(<LiveMap />)
      expect(screen.getByText(/loading harbor map/i)).not.toBeNull()
    })

    it('shows loading message while config is loading', () => {
      setupDefaultMocks({ cfgLoading: true })
      render(<LiveMap />)
      expect(screen.getByText(/loading harbor map/i)).not.toBeNull()
    })

    it('does NOT show loading message once all data is loaded', () => {
      render(<LiveMap />)
      expect(screen.queryByText(/loading harbor map/i)).toBeNull()
    })
  })

  describe('renders when all data is loaded', () => {
    it('renders without crashing with empty piers and berths', () => {
      usePiers.mockReturnValue({ piers: [], loading: false, error: null })
      useBerths.mockReturnValue({ berths: [], loading: false, error: null, refetch: defaultRefetch })
      useMapConfig.mockReturnValue({ config: null, loading: false, error: null })

      const { container } = render(<LiveMap />)
      expect(container.querySelector('[data-testid="canvas-core"]')).not.toBeNull()
    })

    it('renders CanvasCore with berth shapes for placed berths', () => {
      render(<LiveMap />)
      expect(screen.getByTestId('shape-berth-10')).not.toBeNull()
    })

    it('renders CanvasCore with pier shapes for placed piers', () => {
      render(<LiveMap />)
      expect(screen.getByTestId('shape-pier-1')).not.toBeNull()
    })

    it('does NOT render BerthDetailPanel when no berth is selected', () => {
      render(<LiveMap />)
      expect(screen.queryByTestId('berth-detail-panel')).toBeNull()
    })
  })

  describe('berth click interaction', () => {
    it('opens BerthDetailPanel when a berth shape is clicked', () => {
      render(<LiveMap />)
      fireEvent.click(screen.getByTestId('shape-berth-10'))
      expect(screen.getByTestId('berth-detail-panel')).not.toBeNull()
      expect(screen.getByTestId('berth-code').textContent).toBe('A01')
    })

    it('does NOT open BerthDetailPanel when a pier shape is clicked', () => {
      render(<LiveMap />)
      fireEvent.click(screen.getByTestId('shape-pier-1'))
      expect(screen.queryByTestId('berth-detail-panel')).toBeNull()
    })

    it('closes BerthDetailPanel when onClose is called', () => {
      render(<LiveMap />)

      // Open panel
      fireEvent.click(screen.getByTestId('shape-berth-10'))
      expect(screen.getByTestId('berth-detail-panel')).not.toBeNull()

      // Close panel
      fireEvent.click(screen.getByTestId('close-btn'))
      expect(screen.queryByTestId('berth-detail-panel')).toBeNull()
    })
  })

  describe('polling', () => {
    it('sets up a poll interval on mount', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      render(<LiveMap />)
      const calls = setIntervalSpy.mock.calls
      const pollCall = calls.find(([_fn, ms]) => ms === 30_000)
      expect(pollCall).not.toBeUndefined()
    })

    it('calls refetchBerths after POLL_INTERVAL_MS elapses', () => {
      render(<LiveMap />)
      expect(defaultRefetch).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(30_000) })
      expect(defaultRefetch).toHaveBeenCalledTimes(1)
    })

    it('clears the poll interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      const { unmount } = render(<LiveMap />)
      unmount()
      expect(clearIntervalSpy).toHaveBeenCalled()
    })
  })
})
