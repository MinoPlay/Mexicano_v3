import { describe, it, expect } from 'vitest';
import { formatRecentResults } from '../../js/services/statistics.js';

describe('formatRecentResults', () => {
  it('renders W and L badges in order', () => {
    const html = formatRecentResults(['W', 'L', 'W']);
    expect(html).toBe(
      '<span class="recent-results">' +
        '<span class="rr rr-w">W</span>' +
        '<span class="rr rr-l">L</span>' +
        '<span class="rr rr-w">W</span>' +
      '</span>'
    );
  });

  it('renders all wins', () => {
    const html = formatRecentResults(['W', 'W', 'W']);
    expect(html).toBe(
      '<span class="recent-results">' +
        '<span class="rr rr-w">W</span>' +
        '<span class="rr rr-w">W</span>' +
        '<span class="rr rr-w">W</span>' +
      '</span>'
    );
  });

  it('returns dash for empty array', () => {
    expect(formatRecentResults([])).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatRecentResults(undefined)).toBe('—');
  });

  it('ignores unknown values', () => {
    const html = formatRecentResults(['W', 'X', 'L']);
    expect(html).toBe(
      '<span class="recent-results">' +
        '<span class="rr rr-w">W</span>' +
        '<span class="rr rr-l">L</span>' +
      '</span>'
    );
  });
});
