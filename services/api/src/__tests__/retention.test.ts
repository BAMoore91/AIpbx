import { describe, it, expect } from 'vitest';
import { retentionDaysFor } from '../services/retention.js';

describe('retentionDaysFor', () => {
  it('falls back to the platform default (90) when unset', () => {
    expect(retentionDaysFor(null, 90)).toBe(90);
    expect(retentionDaysFor({}, 90)).toBe(90);
    expect(retentionDaysFor({ other: 1 }, 90)).toBe(90);
  });

  it('honors a numeric per-tenant override', () => {
    expect(retentionDaysFor({ retention_days: 30 }, 90)).toBe(30);
    expect(retentionDaysFor({ retention_days: 365 }, 90)).toBe(365);
  });

  it('coerces a numeric string and floors fractions', () => {
    expect(retentionDaysFor({ retention_days: '45' }, 90)).toBe(45);
    expect(retentionDaysFor({ retention_days: 45.9 }, 90)).toBe(45);
  });

  it('ignores invalid / out-of-range overrides', () => {
    expect(retentionDaysFor({ retention_days: 0 }, 90)).toBe(90);
    expect(retentionDaysFor({ retention_days: -5 }, 90)).toBe(90);
    expect(retentionDaysFor({ retention_days: 'soon' }, 90)).toBe(90);
  });
});
