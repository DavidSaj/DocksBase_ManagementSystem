import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import QuoteScreen from './QuoteScreen';

vi.mock('@docksbase/portal-ui/api', () => ({
  default: { get: vi.fn() },
  createReservationIntent: vi.fn(),
  confirmReservation: vi.fn(),
  uploadInsuranceCertificate: vi.fn(),
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements:   ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe:  () => ({}),
  useElements:() => ({}),
}));

vi.mock('../components/HarbourScene', () => ({
  HarbourScene: () => null,
  WaveLines: () => null,
}));

const baseMarina = {
  slug: 'demo-marina', name: 'Demo Marina', currency: 'EUR',
  booking_terms_pdf_url: 'https://example.com/tos.pdf',
  booking_terms_version: '1.0',
  requires_air_draft: false,
  requires_insurance_at_booking: false,
};

const baseState = {
  checkIn: '2026-08-01', checkOut: '2026-08-05',
  boats: [{ loa: '12', beam: '4', draft: '1.8', category: null, categories: [] }],
  errorBanner: '',
};

function renderScreen({ marina = baseMarina, state = baseState, navigate = vi.fn() } = {}) {
  return render(<QuoteScreen state={state} marina={marina} navigate={navigate} />);
}

// VesselStep labels are plain text siblings to inputs (no htmlFor/id).
// We query by label text using getByText + closest/nextSibling approach,
// or rely on the fact that RTL getByLabelText also matches when a <label>
// wraps the input. Since labels here are siblings, we use getAllByRole or
// query the inputs by their position relative to the label text.
//
// RTL's getByLabelText uses aria-label, aria-labelledby, htmlFor, or
// wrapper-label. None of those apply here, so we select inputs by
// data order within each field section using getAllByRole.

function getInputAfterLabel(labelText) {
  // Find the label element then get the next sibling input/select
  const labels = screen.getAllByText(labelText);
  const label = labels.find(el =>
    el.tagName === 'LABEL' || el.className?.includes('p-label')
  );
  if (!label) throw new Error(`Label "${labelText}" not found`);
  const field = label.closest('.p-field');
  if (!field) throw new Error(`No .p-field parent for label "${labelText}"`);
  const input = field.querySelector('input, select, textarea');
  if (!input) throw new Error(`No input in .p-field for label "${labelText}"`);
  return input;
}

describe('QuoteScreen multi-step', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts on VesselStep', () => {
    renderScreen();
    // VesselStep renders a "Vessel name *" label
    expect(screen.getByText('Vessel name *')).toBeInTheDocument();
  });

  it('advances to GuestStep when vessel fields are filled', async () => {
    renderScreen();
    fireEvent.change(getInputAfterLabel('Vessel name *'), { target: { value: 'Bella' } });
    fireEvent.change(getInputAfterLabel('Registration # *'), { target: { value: 'GB-123' } });
    fireEvent.change(getInputAfterLabel('Flag *'), { target: { value: 'GB' } });
    fireEvent.change(getInputAfterLabel('Crew aboard *'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText('Full name *')).toBeInTheDocument());
  });

  it('blocks GuestStep submit when T&Cs unchecked', async () => {
    const { createReservationIntent } = await import('@docksbase/portal-ui/api');
    renderScreen();
    fireEvent.change(getInputAfterLabel('Vessel name *'), { target: { value: 'B' } });
    fireEvent.change(getInputAfterLabel('Registration # *'), { target: { value: 'R' } });
    fireEvent.change(getInputAfterLabel('Flag *'), { target: { value: 'GB' } });
    fireEvent.change(getInputAfterLabel('Crew aboard *'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText('Full name *')).toBeInTheDocument());
    fireEvent.change(getInputAfterLabel('Full name *'),  { target: { value: 'A' } });
    fireEvent.change(getInputAfterLabel('Email *'),      { target: { value: 'a@b.test' } });
    fireEvent.change(getInputAfterLabel('Street *'),     { target: { value: 'X' } });
    fireEvent.change(getInputAfterLabel('City *'),       { target: { value: 'Y' } });
    fireEvent.change(getInputAfterLabel('Postcode *'),   { target: { value: 'Z' } });
    fireEvent.change(getInputAfterLabel('Country *'),    { target: { value: 'GB' } });
    // T&Cs checkbox is NOT checked — button should be disabled
    const btn = screen.getByRole('button', { name: /Continue to payment/i });
    expect(btn).toBeDisabled();
    expect(createReservationIntent).not.toHaveBeenCalled();
  });

  it('shows BookingSummary panel in every step', () => {
    renderScreen();
    // Marina name appears in both the nav and the BookingSummary panel
    const marinaTexts = screen.getAllByText(/Demo Marina/i);
    expect(marinaTexts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Check-in/i)).toBeInTheDocument();
  });
});
