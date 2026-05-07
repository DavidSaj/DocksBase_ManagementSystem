import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from '../api.js';
import usePortalInvoices from './usePortalInvoices.js';

const SAMPLE_INVOICES = [
  { id: 1, invoice_number: 'INV-001', status: 'open', total: '150.00' },
  { id: 2, invoice_number: 'INV-002', status: 'open', total: '80.00' },
];

describe('usePortalInvoices', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({ data: SAMPLE_INVOICES });
  });

  it('loads invoices on mount', async () => {
    const { result } = renderHook(() => usePortalInvoices());
    expect(result.current.loading).toBe(true);
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.invoices).toEqual(SAMPLE_INVOICES);
  });

  it('markPaid updates the target invoice status to paid', async () => {
    const { result } = renderHook(() => usePortalInvoices());
    await act(async () => {});
    act(() => { result.current.markPaid(1); });
    const updated = result.current.invoices.find(inv => inv.id === 1);
    expect(updated.status).toBe('paid');
    // other invoice unchanged
    expect(result.current.invoices.find(inv => inv.id === 2).status).toBe('open');
  });

  it('refetch calls the API again', async () => {
    const { result } = renderHook(() => usePortalInvoices());
    await act(async () => {});
    api.get.mockResolvedValue({ data: [{ id: 3, invoice_number: 'INV-003', status: 'open', total: '200.00' }] });
    await act(async () => { result.current.refetch(); });
    expect(result.current.invoices).toHaveLength(1);
    expect(result.current.invoices[0].id).toBe(3);
  });
});
