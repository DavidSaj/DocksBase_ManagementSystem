import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchScreen from './SearchScreen';
import api from '@docksbase/portal-ui/api';

vi.mock('@docksbase/portal-ui/api');

const marina = { name: 'Test Marina' };
const navigate = vi.fn();

// Pass dates and boats via initial state — avoids interacting with the custom calendar widget.
// LOA is now required; tests that omit it will have the button disabled.
const defaultState = {
  checkIn: '2027-07-10',
  checkOut: '2027-07-13',
  boats: [{ loa: '12', beam: '', draft: '' }],
  errorBanner: '',
};

beforeEach(() => {
  navigate.mockClear();
  vi.clearAllMocks();
});

describe('SearchScreen', () => {
  it('calls berth-categories with correct params on submit', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/berth-categories/'));
    });
    const calledUrl = api.get.mock.calls[0][0];
    expect(calledUrl).toContain('check_in=2027-07-10');
    expect(calledUrl).toContain('check_out=2027-07-13');
    expect(calledUrl).toContain('boat_loa=12');
  });

  it('navigates to options when categories are available', async () => {
    const cats = [{ id: 1, name: 'Standard', price_per_night: '90.00', available_count: 3, amenities: [], tier_note: null }];
    api.get = vi.fn().mockResolvedValue({ data: cats });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('options', expect.objectContaining({
        checkIn: '2027-07-10',
        checkOut: '2027-07-13',
        boats: expect.arrayContaining([
          expect.objectContaining({ loa: '12', categories: cats }),
        ]),
      }));
    });
  });

  it('navigates to quote when no categories are available', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('quote', expect.objectContaining({
        checkIn: '2027-07-10',
        checkOut: '2027-07-13',
        boats: expect.arrayContaining([
          expect.objectContaining({ loa: '12', categories: [] }),
        ]),
      }));
    });
  });

  it('calls berth-categories once per boat when multiple boats present', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    const state = {
      ...defaultState,
      boats: [
        { loa: '10', beam: '', draft: '' },
        { loa: '15', beam: '', draft: '' },
      ],
    };
    render(<SearchScreen state={state} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
    const urls = api.get.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('boat_loa=10'))).toBe(true);
    expect(urls.some(u => u.includes('boat_loa=15'))).toBe(true);
  });

  it('button is disabled when LOA is missing', () => {
    render(<SearchScreen state={{ ...defaultState, boats: [{ loa: '', beam: '', draft: '' }] }} navigate={navigate} marina={marina} />);
    expect(screen.getByRole('button', { name: /check availability/i })).toBeDisabled();
  });

  it('shows error banner when passed in state', () => {
    render(<SearchScreen state={{ ...defaultState, errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' }} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/availability changed/i)).toBeInTheDocument();
  });
});
