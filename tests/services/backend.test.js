import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../../js/cache.js';
import { Store } from '../../js/store.js';

describe('backend selection', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of Cache.keys()) Cache.del(key);
    vi.restoreAllMocks();
  });

  it('does not import the legacy GitHub service', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const source = await readFile(resolve('js/services/backend.js'), 'utf8');
    expect(source).not.toContain("from './github.js'");
  });

  it('uses Supabase whenever public project configuration exists', async () => {
    const specifier = '../../js/services/' + 'backend.js';
    const backend = await import(specifier).catch(() => null);
    expect(backend).not.toBeNull();

    expect(backend.getBackendKind()).toBe('unconfigured');
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    expect(backend.getBackendKind()).toBe('supabase');
  });

  it('does not force a full Supabase reload when the snapshot is already cached', async () => {
    Cache.set('supabase_snapshot_loaded', true);
    const backend = await import('../../js/services/backend.js');
    const supabase = await import('../../js/services/supabase.js');
    const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

    await backend.pullMonthlyOverview('2026-09');

    expect(pullSpy).not.toHaveBeenCalledWith('', { force: true });
    expect(pullSpy).not.toHaveBeenCalled();
  });

  it('keeps explicit full-history helpers separate from the Home route', async () => {
    const backend = await import('../../js/services/backend.js');
    const supabase = await import('../../js/services/supabase.js');
    const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

    await backend.ensureAllMatchesLoaded();

    expect(pullSpy).toHaveBeenCalledWith('#/__full__', { force: true });
  });

  describe('readPlayerSummary (player profile)', () => {
    const match = (date, roundNumber, t1, t2, scoreTeam1, scoreTeam2) => ({
      date, roundNumber,
      team1Player1Name: t1[0], team1Player2Name: t1[1],
      team2Player1Name: t2[0], team2Player2Name: t2[1],
      scoreTeam1, scoreTeam2,
    });
    const matches = [
      match('2026-01-05', 1, ['Alice', 'Bob'], ['Carl', 'Dan'], 15, 10),
      match('2026-01-05', 2, ['Alice', 'Carl'], ['Bob', 'Dan'], 12, 13),
      match('2026-02-02', 1, ['Alice', 'Bob'], ['Carl', 'Dan'], 20, 5),
      match('2026-02-02', 2, ['Carl', 'Dan'], ['Eve', 'Bob'], 0, 0),
    ];
    const byName = (key) => (a, b) => a[key].localeCompare(b[key]);

    it('builds overview, head-to-head and partners from loaded Supabase matches', async () => {
      Store.setMatches(matches);
      Store.setMatchesFullyLoaded(true);
      const backend = await import('../../js/services/backend.js');
      const supabase = await import('../../js/services/supabase.js');
      const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

      const s = await backend.readPlayerSummary('Alice');

      expect(pullSpy).not.toHaveBeenCalled();
      expect(s).toMatchObject({
        playerName: 'Alice', totalTournaments: 2, totalWins: 2, totalLosses: 1, totalPoints: 47,
        tightWins: 0, solidWins: 1, dominatingWins: 1,
        firstPlaceFinishes: 1, secondPlaceFinishes: 1, thirdPlaceFinishes: 0,
      });
      expect([...s.opponents].sort(byName('opponentName'))).toEqual([
        { opponentName: 'Bob', gamesPlayed: 1, wins: 0, losses: 1, pointsFor: 12, pointsAgainst: 13, winRate: 0, recentResults: ['L'] },
        { opponentName: 'Carl', gamesPlayed: 2, wins: 2, losses: 0, pointsFor: 35, pointsAgainst: 15, winRate: 100, recentResults: ['W', 'W'] },
        { opponentName: 'Dan', gamesPlayed: 3, wins: 2, losses: 1, pointsFor: 47, pointsAgainst: 28, winRate: 66.67, recentResults: ['W', 'L', 'W'] },
      ]);
      expect([...s.partners].sort(byName('partnerName'))).toEqual([
        { partnerName: 'Bob', gamesPlayed: 2, wins: 2, losses: 0, winRate: 100, averagePointsPerGame: 17.5, recentResults: ['W', 'W'] },
        { partnerName: 'Carl', gamesPlayed: 1, wins: 0, losses: 1, winRate: 0, averagePointsPerGame: 12, recentResults: ['L'] },
      ]);
    });

    it('loads full match history from Supabase first when not yet loaded', async () => {
      Store.setMatches([]);
      Store.setMatchesFullyLoaded(false);
      const backend = await import('../../js/services/backend.js');
      const supabase = await import('../../js/services/supabase.js');
      const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockImplementation(async () => {
        Store.setMatches(matches);
        Store.setMatchesFullyLoaded(true);
        return true;
      });

      const s = await backend.readPlayerSummary('Alice');

      expect(pullSpy).toHaveBeenCalledWith('#/__full__', { force: true });
      expect(s.totalWins).toBe(2);
      expect(s.partners).toHaveLength(2);
    });
  });

  it('does not start full hydration for a Home monthly refresh', async () => {
    Cache.del('supabase_snapshot_loaded');
    const backend = await import('../../js/services/backend.js');
    const supabase = await import('../../js/services/supabase.js');
    const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

    const monthSpy = vi.spyOn(supabase, 'loadMonth').mockResolvedValue(true);

    await backend.pullMonthlyOverview('2099-12', { route: '#/' });

    expect(monthSpy).toHaveBeenCalledWith('2099-12');
    expect(pullSpy).not.toHaveBeenCalled();
  });
});
