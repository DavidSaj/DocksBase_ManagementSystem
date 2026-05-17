import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../api.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  sendMagicLink: vi.fn(),
}));

vi.mock('../../hooks/useMembers.js', () => ({
  default: () => ({
    members: [
      { id: 1, name: 'Alice Carpenter', email: 'alice@example.com', vessel: 'Lady Katherine', member_type: 'seasonal', insurance_status: 'valid', docs_status: 'complete', joined_at: '2024-01-01' },
      { id: 2, name: 'Bob Phoneman',   email: 'bob@example.com',   vessel: 'Sea Otter',       member_type: 'transient', insurance_status: 'valid', docs_status: 'complete', joined_at: '2024-02-01' },
      { id: 3, name: 'Quentin Overlord', email: 'q@example.com',  vessel: 'Silver Streak',   member_type: 'seasonal', insurance_status: 'valid', docs_status: 'complete', joined_at: '2024-03-01' },
    ],
    loading: false,
    createMember: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMemberDocuments.js', () => ({
  default: () => ({
    memberDocs: [],
    loading: false,
    uploadDoc: vi.fn(),
    updateDoc: vi.fn(),
  }),
}));

import Members from '../Members.jsx';

describe('Members search input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters the displayed list when the user types into the search input', async () => {
    render(<Members setScreen={vi.fn()} />);

    // All three members present initially
    expect(screen.getByText('Alice Carpenter')).toBeTruthy();
    expect(screen.getByText('Bob Phoneman')).toBeTruthy();
    expect(screen.getByText('Quentin Overlord')).toBeTruthy();

    const input = screen.getByLabelText('Search members');
    expect(input).toBeTruthy();

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Overlord' } });
    });

    // Only Quentin's row should remain
    expect(screen.queryByText('Alice Carpenter')).toBeNull();
    expect(screen.queryByText('Bob Phoneman')).toBeNull();
    expect(screen.getByText('Quentin Overlord')).toBeTruthy();
  });

  it('matches by email substring', async () => {
    render(<Members setScreen={vi.fn()} />);
    const input = screen.getByLabelText('Search members');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'bob@example' } });
    });

    expect(screen.queryByText('Alice Carpenter')).toBeNull();
    expect(screen.getByText('Bob Phoneman')).toBeTruthy();
  });

  it('matches by vessel name substring', async () => {
    render(<Members setScreen={vi.fn()} />);
    const input = screen.getByLabelText('Search members');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Silver' } });
    });

    expect(screen.queryByText('Alice Carpenter')).toBeNull();
    expect(screen.getByText('Quentin Overlord')).toBeTruthy();
  });
});
