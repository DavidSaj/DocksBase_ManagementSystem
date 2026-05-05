import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuoteScreen from './QuoteScreen';
import api from '../api';

vi.mock('../api');

const navigate = vi.fn();
const marina = { name: 'Test Marina' };

const state = {
  checkIn: '2027-07-10',
  checkOut: '2027-07-13',
  boatLoa: '12.5',
  boatBeam: '4.2',
  boatDraft: '',
  quotedPrice: 90,
  quotedTotal: 270,
  guestName: '',
  guestEmail: '',
  guestPhone: '',
};

function fillContact() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'J. Sailor' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sailor@sea.com' } });
  fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+353871234567' } });
}

beforeEach(() => {
  navigate.mockClear();
  vi.clearAllMocks();
  delete window.location;
  window.location = { href: '' };
});

describe('QuoteScreen', () => {
  it('displays dates, nights, and total price from wizard state', () => {
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/3 nights/i)).toBeInTheDocument();
    expect(screen.getByText(/€270/i)).toBeInTheDocument();
    expect(screen.getByText(/10 Jul/i)).toBeInTheDocument();
  });

  it('submitting contact form calls engine-request with all fields', async () => {
    api.post = vi.fn().mockResolvedValue({ data: { booking: { id: 1 }, checkout_url: 'https://stripe.test/pay' } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/public/bookings/engine-request/', expect.objectContaining({
        check_in: '2027-07-10',
        check_out: '2027-07-13',
        guest_name: 'J. Sailor',
        guest_email: 'sailor@sea.com',
        guest_phone: '+353871234567',
      }));
    });
  });

  it('engine success redirects to checkout_url', async () => {
    api.post = vi.fn().mockResolvedValue({ data: { booking: { id: 1 }, checkout_url: 'https://stripe.test/pay' } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(window.location.href).toBe('https://stripe.test/pay');
    });
  });

  it('engine 409 navigates back to search with banner', async () => {
    api.post = vi.fn().mockRejectedValue({ response: { status: 409, data: { detail: 'No berth.' } } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('search', expect.objectContaining({
        errorBanner: 'Availability changed while you were reviewing. Please check your dates again.',
      }));
    });
  });

  it('engine 503 shows inline error without navigation', async () => {
    api.post = vi.fn().mockRejectedValue({ response: { status: 503, data: { detail: 'Payment error.' } } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});
