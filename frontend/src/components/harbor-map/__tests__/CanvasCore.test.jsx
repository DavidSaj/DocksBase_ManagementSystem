import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import CanvasCore from '../CanvasCore.jsx'

// GRID=24, so a shape at absX=5, absY=5 with w=2, h=1:
//   px=120, py=120, pw=48, ph=24  → rect x=96, y=108
const makeShape = (overrides = {}) => ({
  id: 'shape-1',
  type: 'berth',
  absX: 5,
  absY: 5,
  w: 2,
  h: 1,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#00ff00',
  label: 'A1',
  meta: {},
  ...overrides,
})

describe('CanvasCore', () => {
  describe('basic rendering', () => {
    it('renders without crashing with empty shapes array', () => {
      const { container } = render(<CanvasCore shapes={[]} />)
      expect(container.querySelector('svg.canvas-core')).not.toBeNull()
    })

    it('renders an SVG with the correct canvas dimensions', () => {
      const { container } = render(<CanvasCore shapes={[]} />)
      const svg = container.querySelector('svg.canvas-core')
      // CW = 34*24 = 816, CH = 22*24 = 528
      expect(svg.getAttribute('width')).toBe('816')
      expect(svg.getAttribute('height')).toBe('528')
    })
  })

  describe('shape rendering', () => {
    it('renders a rect for each shape with correct fill and stroke', () => {
      const { container } = render(
        <CanvasCore shapes={[makeShape()]} />
      )
      // The first two rects are the background rects; the shape rect is the third
      const rects = container.querySelectorAll('rect')
      const shapeRect = Array.from(rects).find(
        r => r.getAttribute('fill') === '#ff0000'
      )
      expect(shapeRect).not.toBeNull()
      expect(shapeRect.getAttribute('stroke')).toBe('#00ff00')
    })

    it('renders label text when label is provided', () => {
      const { container } = render(
        <CanvasCore shapes={[makeShape({ label: 'A1' })]} />
      )
      const texts = container.querySelectorAll('text')
      const labelText = Array.from(texts).find(t => t.textContent === 'A1')
      expect(labelText).not.toBeNull()
    })

    it('does NOT render label text when label is empty string', () => {
      const { container } = render(
        <CanvasCore shapes={[makeShape({ label: '' })]} />
      )
      // viewer mode (default): no text elements at all (no label, no rotation handle)
      const texts = container.querySelectorAll('text')
      expect(texts.length).toBe(0)
    })

    it('does NOT render label text when label is missing/undefined', () => {
      const { container } = render(
        <CanvasCore shapes={[makeShape({ label: undefined })]} />
      )
      const texts = container.querySelectorAll('text')
      // viewer mode: no text elements at all (no label, no rotation handle)
      expect(texts.length).toBe(0)
    })
  })

  describe('selection highlight', () => {
    it('renders selection highlight rect when shape id is in selectedIds', () => {
      const { container } = render(
        <CanvasCore
          shapes={[makeShape()]}
          selectedIds={new Set(['shape-1'])}
        />
      )
      // Selection highlight has fill="none" and stroke="#b8965a"
      const rects = container.querySelectorAll('rect')
      const highlight = Array.from(rects).find(
        r => r.getAttribute('stroke') === '#b8965a' && r.getAttribute('fill') === 'none'
      )
      expect(highlight).not.toBeNull()
    })

    it('does NOT render selection highlight when shape id is NOT in selectedIds', () => {
      const { container } = render(
        <CanvasCore
          shapes={[makeShape()]}
          selectedIds={new Set()}
        />
      )
      const rects = container.querySelectorAll('rect')
      const highlight = Array.from(rects).find(
        r => r.getAttribute('stroke') === '#b8965a' && r.getAttribute('fill') === 'none'
      )
      expect(highlight).toBeUndefined()
    })
  })

  describe('snap zones', () => {
    const zone = { absX: 3, absY: 3, w: 2, h: 1 }

    it('renders snap zone rect in builder mode', () => {
      const { container } = render(
        <CanvasCore shapes={[]} mode="builder" snapZones={[zone]} />
      )
      // Snap zone has stroke="#2a9d99" and strokeDasharray="4,3"
      const rects = container.querySelectorAll('rect')
      const snapRect = Array.from(rects).find(
        r => r.getAttribute('stroke') === '#2a9d99'
      )
      expect(snapRect).not.toBeNull()
      expect(snapRect.getAttribute('stroke-dasharray')).toBe('4,3')
    })

    it('does NOT render snap zone rect in viewer mode', () => {
      const { container } = render(
        <CanvasCore shapes={[]} mode="viewer" snapZones={[zone]} />
      )
      const rects = container.querySelectorAll('rect')
      const snapRect = Array.from(rects).find(
        r => r.getAttribute('stroke') === '#2a9d99'
      )
      expect(snapRect).toBeUndefined()
    })
  })

  describe('rotation handles', () => {
    it('renders rotation handle circle for selected item in builder mode', () => {
      const { container } = render(
        <CanvasCore
          shapes={[makeShape()]}
          mode="builder"
          selectedIds={new Set(['shape-1'])}
        />
      )
      // Rotation handle is a circle with fill="#b8965a"
      const circle = container.querySelector('circle[fill="#b8965a"]')
      expect(circle).not.toBeNull()
    })

    it('does NOT render rotation handle in viewer mode', () => {
      const { container } = render(
        <CanvasCore
          shapes={[makeShape()]}
          mode="viewer"
          selectedIds={new Set(['shape-1'])}
        />
      )
      const circle = container.querySelector('circle')
      expect(circle).toBeNull()
    })

    it('does NOT render rotation handle for non-selected item in builder mode', () => {
      const { container } = render(
        <CanvasCore
          shapes={[makeShape()]}
          mode="builder"
          selectedIds={new Set()}
        />
      )
      const circle = container.querySelector('circle')
      expect(circle).toBeNull()
    })

    it('calls onRotateHandlePointerDown and stops propagation so onItemPointerDown is NOT called', () => {
      const onItemPointerDown = vi.fn()
      const onRotateHandlePointerDown = vi.fn()
      const shape = makeShape()
      const { container } = render(
        <CanvasCore
          shapes={[shape]}
          mode="builder"
          selectedIds={new Set(['shape-1'])}
          onItemPointerDown={onItemPointerDown}
          onRotateHandlePointerDown={onRotateHandlePointerDown}
        />
      )
      const circle = container.querySelector('circle[fill="#b8965a"]')
      expect(circle).not.toBeNull()
      circle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(onRotateHandlePointerDown).toHaveBeenCalledTimes(1)
      expect(onRotateHandlePointerDown).toHaveBeenCalledWith(expect.any(Object), shape)
      expect(onItemPointerDown).not.toHaveBeenCalled()
    })
  })

  describe('ghost rect', () => {
    const ghost = { absX: 4, absY: 4, w: 2, h: 1, fill: '#8888ff', stroke: '#4444ff' }

    it('renders ghost rect when ghost prop is provided', () => {
      const { container } = render(
        <CanvasCore shapes={[]} ghost={ghost} />
      )
      // Ghost rect has strokeDasharray="4,3" and fill-opacity="0.45"
      const rects = container.querySelectorAll('rect')
      const ghostRect = Array.from(rects).find(
        r => r.getAttribute('stroke-dasharray') === '4,3'
      )
      expect(ghostRect).not.toBeNull()
      expect(ghostRect.getAttribute('fill')).toBe('#8888ff')
    })

    it('does NOT render ghost rect when ghost prop is null', () => {
      const { container } = render(
        <CanvasCore shapes={[]} ghost={null} />
      )
      const rects = container.querySelectorAll('rect')
      const ghostRect = Array.from(rects).find(
        r => r.getAttribute('stroke-dasharray') === '4,3'
      )
      expect(ghostRect).toBeUndefined()
    })
  })

  describe('event handlers', () => {
    it('calls onItemClick when a berth is clicked in viewer mode', () => {
      const onItemClick = vi.fn()
      const shape = makeShape({ type: 'berth' })
      const { container } = render(
        <CanvasCore
          shapes={[shape]}
          mode="viewer"
          onItemClick={onItemClick}
        />
      )
      // The <g> element for the berth should have the click handler
      const groups = container.querySelectorAll('g')
      // First g is the shape group; find it by checking it contains the fill rect
      const shapeGroup = Array.from(groups).find(g => {
        const rect = g.querySelector('rect[fill="#ff0000"]')
        return rect !== null
      })
      expect(shapeGroup).not.toBeNull()
      shapeGroup.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onItemClick).toHaveBeenCalledTimes(1)
      expect(onItemClick).toHaveBeenCalledWith(expect.any(Object), shape)
    })

    it('does NOT call onItemClick for non-berth shapes in viewer mode', () => {
      const onItemClick = vi.fn()
      const shape = makeShape({ type: 'pier-h' })
      const { container } = render(
        <CanvasCore
          shapes={[shape]}
          mode="viewer"
          onItemClick={onItemClick}
        />
      )
      const groups = container.querySelectorAll('g')
      const shapeGroup = Array.from(groups).find(g =>
        g.querySelector('rect[fill="#ff0000"]') !== null
      )
      shapeGroup.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onItemClick).not.toHaveBeenCalled()
    })

    it('calls onItemPointerDown for any shape in builder mode', () => {
      const onItemPointerDown = vi.fn()
      const shape = makeShape({ type: 'pier-h' })
      const { container } = render(
        <CanvasCore
          shapes={[shape]}
          mode="builder"
          onItemPointerDown={onItemPointerDown}
        />
      )
      const groups = container.querySelectorAll('g')
      const shapeGroup = Array.from(groups).find(g =>
        g.querySelector('rect[fill="#ff0000"]') !== null
      )
      expect(shapeGroup).not.toBeNull()
      shapeGroup.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(onItemPointerDown).toHaveBeenCalledTimes(1)
      expect(onItemPointerDown).toHaveBeenCalledWith(expect.any(Object), shape)
    })

    it('does NOT call onItemPointerDown in viewer mode', () => {
      const onItemPointerDown = vi.fn()
      const shape = makeShape()
      const { container } = render(
        <CanvasCore
          shapes={[shape]}
          mode="viewer"
          onItemPointerDown={onItemPointerDown}
        />
      )
      const groups = container.querySelectorAll('g')
      const shapeGroup = Array.from(groups).find(g =>
        g.querySelector('rect[fill="#ff0000"]') !== null
      )
      shapeGroup.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(onItemPointerDown).not.toHaveBeenCalled()
    })
  })
})
