import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BerthDetailPanel from '../BerthDetailPanel.jsx'

vi.mock('../../../api.js', () => ({
  default: {
    get: vi.fn(),
  }
}))

import api from '../../../api.js'

const makeBerth = (overrides = {}) => ({
  id: 1,
  code: 'A01',
  status: 'available',
  length_m: 12,
  max_draft_m: 2.5,
  max_beam_m: 4,
  price_per_night: null,
  amenities: [],
  ...overrides,
})

const makeBooking = (overrides = {}) => ({
  id: 99,
  vessel_name: 'Sea Breeze',
  guest_name: null,
  check_in: '2026-05-01',
  check_out: '2026-05-05',
  nights: 4,
  amount: 240,
  ...overrides,
})

describe('BerthDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: api.get never resolves (keeps loading state unless test overrides)
    api.get.mockReturnValue(new Promise(() => {}))
  })

  it('returns null when berth is null', () => {
    const { container } = render(<BerthDetailPanel berth={null} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders berth code in the header', () => {
    render(<BerthDetailPanel berth={makeBerth({ code: 'B07' })} onClose={vi.fn()} />)
    expect(screen.getByText('Berth B07')).toBeTruthy()
  })

  it('renders status text in the header', () => {
    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)
    expect(screen.getByText(/occupied/i)).toBeTruthy()
  })

  it('renders status badge with correct class for available berth', () => {
    const { container } = render(
      <BerthDetailPanel berth={makeBerth({ status: 'available' })} onClose={vi.fn()} />
    )
    const badge = container.querySelector('span.badge.badge-green')
    expect(badge).not.toBeNull()
    expect(badge.textContent).toBe('available')
  })

  it('renders dimensions section with length, max draft, max beam', () => {
    render(
      <BerthDetailPanel
        berth={makeBerth({ length_m: 15, max_draft_m: 3, max_beam_m: 5 })}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('15 m')).toBeTruthy()
    expect(screen.getByText('3 m')).toBeTruthy()
    expect(screen.getByText('5 m')).toBeTruthy()
  })

  it('renders — for missing dimensions', () => {
    render(
      <BerthDetailPanel
        berth={makeBerth({ length_m: null, max_draft_m: null, max_beam_m: null })}
        onClose={vi.fn()}
      />
    )
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('renders amenities chips', () => {
    render(
      <BerthDetailPanel
        berth={makeBerth({ amenities: ['electricity', 'water', 'wifi'] })}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('electricity')).toBeTruthy()
    expect(screen.getByText('water')).toBeTruthy()
    expect(screen.getByText('wifi')).toBeTruthy()
  })

  it('does not render amenities section when amenities is empty', () => {
    render(
      <BerthDetailPanel berth={makeBerth({ amenities: [] })} onClose={vi.fn()} />
    )
    expect(screen.queryByText('AMENITIES')).toBeNull()
  })

  it('shows "No active booking" message and Create Booking button for available berth', () => {
    render(
      <BerthDetailPanel berth={makeBerth({ status: 'available', id: 42 })} onClose={vi.fn()} />
    )
    expect(screen.getByText(/no active booking/i)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /create booking/i })
    expect(btn).toBeTruthy()
  })

  it('does NOT fetch bookings for available berth', () => {
    render(<BerthDetailPanel berth={makeBerth({ status: 'available' })} onClose={vi.fn()} />)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('does NOT fetch bookings for maintenance berth', () => {
    render(<BerthDetailPanel berth={makeBerth({ status: 'maintenance' })} onClose={vi.fn()} />)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('shows "Loading booking…" while fetching for occupied berth', async () => {
    // Return a promise that never resolves so we stay in loading state
    api.get.mockReturnValue(new Promise(() => {}))

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    expect(screen.getByText('Loading booking…')).toBeTruthy()
  })

  it('shows "Loading booking…" while fetching for reserved berth', async () => {
    api.get.mockReturnValue(new Promise(() => {}))

    render(<BerthDetailPanel berth={makeBerth({ status: 'reserved' })} onClose={vi.fn()} />)

    expect(screen.getByText('Loading booking…')).toBeTruthy()
  })

  it('shows booking details after loading for occupied berth', async () => {
    const booking = makeBooking()
    api.get.mockResolvedValue({ data: { results: [booking] } })

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Sea Breeze')).toBeTruthy()
    })
    expect(screen.getByText('2026-05-01')).toBeTruthy()
    expect(screen.getByText('2026-05-05')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('€240.00')).toBeTruthy()
  })

  it('falls back to guest_name when vessel_name is null', async () => {
    const booking = makeBooking({ vessel_name: null, guest_name: 'John Doe' })
    api.get.mockResolvedValue({ data: { results: [booking] } })

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeTruthy()
    })
  })

  it('shows "No checked-in booking found." when API returns empty results', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('No checked-in booking found.')).toBeTruthy()
    })
  })

  it('shows "No checked-in booking found." when API returns flat empty array', async () => {
    api.get.mockResolvedValue({ data: [] })

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('No checked-in booking found.')).toBeTruthy()
    })
  })

  it('shows "No checked-in booking found." when API call fails', async () => {
    api.get.mockRejectedValue(new Error('Network error'))

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('No checked-in booking found.')).toBeTruthy()
    })
  })

  it('renders View Booking button after booking loads', async () => {
    const booking = makeBooking({ id: 99 })
    api.get.mockResolvedValue({ data: { results: [booking] } })

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied' })} onClose={vi.fn()} />)

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /view booking/i })
      expect(btn).toBeTruthy()
    })
  })

  it('calls onClose when × button is clicked', () => {
    const onClose = vi.fn()
    render(<BerthDetailPanel berth={makeBerth()} onClose={onClose} />)

    const closeBtn = screen.getByRole('button', { name: '×' })
    fireEvent.click(closeBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fetches bookings for occupied berth with correct params', () => {
    api.get.mockReturnValue(new Promise(() => {}))

    render(<BerthDetailPanel berth={makeBerth({ status: 'occupied', id: 7 })} onClose={vi.fn()} />)

    expect(api.get).toHaveBeenCalledWith('/bookings/', expect.objectContaining({
      params: { berth: 7, status: 'checked_in' },
    }))
  })
})
