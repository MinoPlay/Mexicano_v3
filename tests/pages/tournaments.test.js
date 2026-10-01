import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const loadTournamentResults = vi.fn(async () => true);
const index = [
  { date: '2026-09-24', playerCount: 8, roundCount: 7, matchCount: 14, completedCount: 14, isComplete: true },
  { date: '2025-09-25', playerCount: 8, roundCount: 7, matchCount: 14, completedCount: 14, isComplete: true },
  { date: '2024-09-26', playerCount: 8, roundCount: 7, matchCount: 14, completedCount: 14, isComplete: true },
  { date: '2023-09-28', playerCount: 8, roundCount: 7, matchCount: 14, completedCount: 14, isComplete: true },
];

vi.mock('../../js/store.js', () => ({
  Store: {
    getTournamentsIndex: vi.fn(() => index),
    getMatches: vi.fn(() => []),
    getSupabaseConfig: vi.fn(() => ({ url: 'https://example.test' })),
    isMatchesFullyLoaded: vi.fn(() => false),
  },
}));

vi.mock('../../js/services/backend.js', () => ({
  loadTournamentResults,
}));

import { renderTournaments } from '../../js/pages/tournaments.js';

describe('tournaments year results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    loadTournamentResults.mockClear();
    document.body.innerHTML = '<main id="page"></main>';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to the current year, offers a three-year window, and loads that year automatically', async () => {
    renderTournaments(document.querySelector('#page'), {});

    const yearSelect = document.querySelector('#tournaments-year');
    expect(Array.from(yearSelect.options, option => option.value)).toEqual([
      'all',
      '2026',
      '2025',
      '2024',
    ]);
    expect(yearSelect.value).toBe('2026');
    await vi.waitFor(() => expect(loadTournamentResults).toHaveBeenCalledWith('2026'));
    expect(document.querySelector('#tournaments-load-results')).toBeNull();
  });
});
