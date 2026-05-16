import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Mock the api module before importing the component.
vi.mock('../../../api.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import api from '../../../api.js';
import AccountingGLMappingCard from '../AccountingGLMappingCard.jsx';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountingGLMappingCard', () => {
  it('renders rows from mocked /gl-mappings/', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        { id: 1, chargeable_category: 'slip', external_gl_code: '4000', external_gl_name: 'Slip Income', is_active: true },
        { id: 2, chargeable_category: 'fuel', external_gl_code: '4100', external_gl_name: 'Fuel Sales', is_active: true },
      ],
    });

    await act(async () => {
      render(<AccountingGLMappingCard />);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('slip')).toBeTruthy();
    });
    expect(screen.getByText('fuel')).toBeTruthy();
    expect(screen.getByTestId('gl-row-1')).toBeTruthy();
    expect(screen.getByTestId('gl-row-2')).toBeTruthy();
  });

  it('PATCHes /gl-mappings/<id>/ after debounce when editing external_code', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        { id: 5, chargeable_category: 'slip', external_gl_code: '4000', external_gl_name: '', is_active: true },
      ],
    });
    api.patch.mockResolvedValueOnce({ data: {} });

    await act(async () => {
      render(<AccountingGLMappingCard />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('gl-code-5')).toBeTruthy());

    vi.useFakeTimers();
    const input = screen.getByTestId('gl-code-5');
    fireEvent.change(input, { target: { value: '4999' } });

    // Before debounce elapses, no patch yet.
    expect(api.patch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    vi.useRealTimers();

    expect(api.patch).toHaveBeenCalledWith('/accounting/gl-mappings/5/', { external_gl_code: '4999' });
  });

  it('shows empty state with Add button when list is empty', async () => {
    api.get.mockResolvedValueOnce({ data: [] });

    await act(async () => {
      render(<AccountingGLMappingCard />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('gl-empty-state')).toBeTruthy());
    expect(screen.getByTestId('gl-empty-add-btn')).toBeTruthy();
    expect(screen.getByText(/No GL mappings defined/i)).toBeTruthy();
  });
});
