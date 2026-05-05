import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlternativesScreen from './AlternativesScreen';

const navigate = vi.fn();

const alternatives = [
  { check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' },
  { check_in: '2027-07-10', check_out: '2027-07-14', nights: 4, price_per_night: '90.00', total: '360.00' },
];

const state = { alternatives };

describe('AlternativesScreen', () => {
  it('renders one card per alternative with correct price and dates', () => {
    render(<AlternativesScreen state={state} navigate={navigate} />);
    expect(screen.getByText(/Jul 11/i)).toBeInTheDocument();
    expect(screen.getByText(/€270/i)).toBeInTheDocument();
    expect(screen.getByText(/€360/i)).toBeInTheDocument();
  });

  it('clicking a card navigates to quote with correct wizard state', () => {
    render(<AlternativesScreen state={state} navigate={navigate} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(navigate).toHaveBeenCalledWith('quote', expect.objectContaining({
      checkIn: '2027-07-11',
      checkOut: '2027-07-14',
      quotedPrice: 90,
      quotedTotal: 270,
    }));
  });

  it('back button navigates to search', () => {
    render(<AlternativesScreen state={state} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: /try different dates/i }));
    expect(navigate).toHaveBeenCalledWith('search');
  });
});
