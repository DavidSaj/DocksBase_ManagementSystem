import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuoteScreen from './QuoteScreen';
import api, { createReservationIntent } from '@docksbase/portal-ui/api';

vi.mock('@docksbase/portal-ui/api', () => ({
  default: { post: vi.fn(), get: vi.fn() },
  createReservationIntent: vi.fn(),
  confirmReservation: vi.fn(),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements:       ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="stripe-element" />,
  useStripe:      () => null,
  useElements:    () => null,
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));

const navigate = vi.fn();
const marina = { name: 'Test Marina', slug: 'test-marina' };

const state = {
  checkIn: '2027-07-10',
  checkOut: '2027-07-13',
  boats: [{ loa: '12.5', beam: '4.2', draft: '', category: null }],
};

function fillContact() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'J. Sailor' } });
  fireEvent.change(screen.getByLabelText(/email/i),     { target: { value: 'sailor@sea.com' } });
  fireEvent.change(screen.getByLabelText(/phone/i),     { target: { value: '+353871234567' } });
}

beforeEach(() => {
  navigate.mockClear();
  vi.clearAllMocks();
});

describe('QuoteScreen', () => {
  it('displays dates and nights from wizard state', () => {
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/3 night/i)).toBeInTheDocument();
    expect(screen.getByText(/10 Jul/i)).toBeInTheDocument();
  });

  it('submitting contact form calls createReservationIntent with all fields', async () => {
    createReservationIntent.mockResolvedValue({
      data: {
        requires_payment: true,
        client_secret: 'pi_test_secret',
        reservation_id: 99,
        total: '270.00',
        reference: 'RES-123',
      },
    });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    await waitFor(() => {
      expect(createReservationIntent).toHaveBeenCalledWith(
        'test-marina',
        expect.objectContaining({
          check_in:    '2027-07-10',
          check_out:   '2027-07-13',
          guest_name:  'J. Sailor',
          guest_email: 'sailor@sea.com',
          guest_phone: '+353871234567',
          items: expect.arrayContaining([
            expect.objectContaining({
              boat_loa:  12.5,
              boat_beam: 4.2,
              vessel_name: '',
            }),
          ]),
        }),
      );
    });
  });

  it('intent success with requires_payment swaps to Stripe PaymentElement', async () => {
    createReservationIntent.mockResolvedValue({
      data: {
        requires_payment: true,
        client_secret: 'pi_test_secret',
        reservation_id: 99,
        total: '270.00',
        reference: 'RES-123',
      },
    });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    await waitFor(() => {
      expect(screen.getByTestId('stripe-element')).toBeInTheDocument();
    });
  });

  it('intent success without requires_payment navigates to pending_review confirmation', async () => {
    createReservationIntent.mockResolvedValue({
      data: {
        requires_payment: false,
        reference: 'RES-456',
      },
    });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('confirmed', expect.objectContaining({
        reservationReference: 'RES-456',
        reservationStatus: 'pending_review',
      }));
    });
  });

  it('intent 409 fetches alternatives and navigates to alternatives screen', async () => {
    createReservationIntent.mockRejectedValue({ response: { status: 409, data: { detail: 'No berth.' } } });
    const alts = [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, total: '270.00' }];
    api.get.mockResolvedValue({ data: alts });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/availability-alternatives/'));
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('alternatives', { alternatives: alts });
    });
  });

  it('intent 503 shows inline error without navigation', async () => {
    createReservationIntent.mockRejectedValue({ response: { status: 503, data: { detail: 'Payment error.' } } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    await waitFor(() => {
      expect(screen.getByText(/payment error/i)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders one vessel-name input per boat', () => {
    const multiBoat = {
      ...state,
      boats: [
        { loa: '10', beam: '', draft: '', category: null },
        { loa: '15', beam: '', draft: '', category: null },
      ],
    };
    render(<QuoteScreen state={multiBoat} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/Boat 1 name/i)).toBeInTheDocument();
    expect(screen.getByText(/Boat 2 name/i)).toBeInTheDocument();
    expect(screen.getByText(/2 boats/i)).toBeInTheDocument();
  });
});
