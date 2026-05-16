import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('../../../api.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import api from '../../../api.js';
import AccountingTaxCodesCard from '../AccountingTaxCodesCard.jsx';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountingTaxCodesCard', () => {
  it('renders rows from mocked /tax-codes/', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        {
          id: 1, name: 'Standard VAT', rate: '20.00',
          jurisdiction_country: 'GB',
          reportable_category: 'vat_standard',
          external_qbo_code: 'TAX-S', external_xero_code: 'OUTPUT2',
          is_active: true,
        },
        {
          id: 2, name: 'Reduced VAT', rate: '5.00',
          jurisdiction_country: 'GB',
          reportable_category: 'vat_reduced',
          external_qbo_code: '', external_xero_code: '',
          is_active: true,
        },
      ],
    });

    await act(async () => {
      render(<AccountingTaxCodesCard />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('tax-row-1')).toBeTruthy());
    expect(screen.getByTestId('tax-row-2')).toBeTruthy();
    expect(screen.getByTestId('tax-name-1').value).toBe('Standard VAT');
    expect(screen.getByTestId('tax-qbo-1').value).toBe('TAX-S');
  });

  it('PATCHes /tax-codes/<id>/ after debounce when editing external_qbo_code', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        {
          id: 7, name: 'Standard VAT', rate: '20.00',
          jurisdiction_country: 'GB', reportable_category: 'vat_standard',
          external_qbo_code: '', external_xero_code: '', is_active: true,
        },
      ],
    });
    api.patch.mockResolvedValueOnce({ data: {} });

    await act(async () => {
      render(<AccountingTaxCodesCard />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('tax-qbo-7')).toBeTruthy());

    vi.useFakeTimers();
    fireEvent.change(screen.getByTestId('tax-qbo-7'), { target: { value: 'TAX-NEW' } });

    expect(api.patch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    vi.useRealTimers();

    expect(api.patch).toHaveBeenCalledWith('/accounting/tax-codes/7/', { external_qbo_code: 'TAX-NEW' });
  });

  it('shows empty state with Add button when list is empty', async () => {
    api.get.mockResolvedValueOnce({ data: [] });

    await act(async () => {
      render(<AccountingTaxCodesCard />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('tax-empty-state')).toBeTruthy());
    expect(screen.getByTestId('tax-empty-add-btn')).toBeTruthy();
    expect(screen.getByText(/No tax codes defined/i)).toBeTruthy();
  });
});
