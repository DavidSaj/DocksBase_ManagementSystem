import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchScreen from './SearchScreen';
import api from '@docksbase/portal-ui/api';

vi.mock('@docksbase/portal-ui/api');

const marina = { name: 'Test Marina' };
const navigate = vi.fn();

// Pass dates via initial state — avoids interacting with the custom calendar widget.
// LOA is now required; tests that omit it will have the button disabled.
const defaultState = {
  checkIn: '2027-07-10', checkOut: '2027-07-13',
  boatLoa: '12', boatBeam: '', boatDraft: '',
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
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('check_in=2027-07-10'));
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('boat_loa=12'));
    });
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
        categories: cats,
      }));
    });
  });

  it('navigates to quote when no categories but berths available', async () => {
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })                                          // categories
      .mockResolvedValueOnce({ data: [{ id: 1, pricing_tier_unit_price: '90.00' }] }); // berths
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('quote', expect.objectContaining({
        checkIn: '2027-07-10',
        checkOut: '2027-07-13',
        quotedPrice: 90,
        quotedTotal: 270,
      }));
    });
  });

  it('calls alternatives endpoint when no berths available', async () => {
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/availability-alternatives/'));
    });
  });

  it('navigates to alternatives when alternatives exist', async () => {
    const alts = [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' }];
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: alts });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('alternatives', expect.objectContaining({ alternatives: alts }));
    });
  });

  it('shows dead-end message when no alternatives available', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(screen.getByText(/no availability/i)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('button is disabled when LOA is missing', () => {
    render(<SearchScreen state={{ ...defaultState, boatLoa: '' }} navigate={navigate} marina={marina} />);
    expect(screen.getByRole('button', { name: /check availability/i })).toBeDisabled();
  });

  it('shows error banner when passed in state', () => {
    render(<SearchScreen state={{ ...defaultState, errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' }} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/availability changed/i)).toBeInTheDocument();
  });
});
