import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchScreen from './SearchScreen';
import api from '../api';

vi.mock('../api');

const marina = { name: 'Test Marina' };
const navigate = vi.fn();

const defaultState = {
  checkIn: '', checkOut: '', boatLoa: '', boatBeam: '', boatDraft: '',
  errorBanner: '',
};

function fillDates() {
  fireEvent.change(screen.getByLabelText(/check.in/i), { target: { value: '2027-07-10' } });
  fireEvent.change(screen.getByLabelText(/check.out/i), { target: { value: '2027-07-13' } });
}

beforeEach(() => {
  navigate.mockClear();
  vi.clearAllMocks();
});

describe('SearchScreen', () => {
  it('calls available-berths with correct params on submit', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [{ id: 1, pricing_tier_unit_price: '90.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.change(screen.getByLabelText(/loa/i), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/available-berths/'));
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('check_in=2027-07-10'));
    });
  });

  it('navigates to quote when berths are available', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [{ id: 1, pricing_tier_unit_price: '90.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('quote', expect.objectContaining({ quotedTotal: 270 }));
    });
  });

  it('calls alternatives endpoint when no berths available', async () => {
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/availability-alternatives/'));
    });
  });

  it('navigates to alternatives when alternatives exist', async () => {
    const alts = [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' }];
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: alts });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('alternatives', expect.objectContaining({ alternatives: alts }));
    });
  });

  it('shows dead-end message when no alternatives available', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(screen.getByText(/no availability/i)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows error banner when passed in state', () => {
    render(<SearchScreen state={{ ...defaultState, errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' }} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/availability changed/i)).toBeInTheDocument();
  });
});
