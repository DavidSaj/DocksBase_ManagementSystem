import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ageDays } from './ageDays';

describe('ageDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-03T14:32:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns 0 for today', () => {
    expect(ageDays('2026-05-03')).toBe(0);
  });

  it('returns 2 for two days ago', () => {
    expect(ageDays('2026-05-01')).toBe(2);
  });

  it('returns negative for a future date', () => {
    expect(ageDays('2026-05-10')).toBe(-7);
  });

  it('is not affected by time-of-day (midnight normalization)', () => {
    vi.setSystemTime(new Date('2026-05-03T23:59:59'));
    expect(ageDays('2026-05-01')).toBe(2);

    vi.setSystemTime(new Date('2026-05-03T00:00:01'));
    expect(ageDays('2026-05-01')).toBe(2);
  });
});
