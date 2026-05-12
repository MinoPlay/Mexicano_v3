/**
 * Tests for js/scripts/generate-monthly-overviews.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetConfig      = vi.fn();
const mockMatchesBase    = vi.fn();
const mockReadFile       = vi.fn();
const mockListContents   = vi.fn();
const mockWriteFile      = vi.fn();
const mockFromBackupMatch = vi.fn();
const mockGhLog          = vi.fn();

vi.mock('../../js/services/github.js', () => ({
  getConfig:       (...a) => mockGetConfig(...a),
  matchesBase:     (...a) => mockMatchesBase(...a),
  readFile:        (...a) => mockReadFile(...a),
  listContents:    (...a) => mockListContents(...a),
  writeFile:       (...a) => mockWriteFile(...a),
  fromBackupMatch: (...a) => mockFromBackupMatch(...a),
  ghLog:           (...a) => mockGhLog(...a),
}));

const mockCalculateClassicElo = vi.fn();
vi.mock('../../js/services/elo.js', () => ({
  calculateClassicElo: (...a) => mockCalculateClassicElo(...a),
}));

import { generateMonthlyOverviews } from '../../js/scripts/generate-monthly-overviews.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'base/backup-data' };
}

/** Build a camelCase match (post-fromBackupMatch). */
function match(date, round, t1p1, t1p2, t2p1, t2p2, s1, s2) {
  return {
    date, roundNumber: round,
    team1Player1Name: t1p1, team1Player2Name: t1p2,
    team2Player1Name: t2p1, team2Player2Name: t2p2,
    scoreTeam1: s1, scoreTeam2: s2,
  };
}

/** players.json content with given name→id pairs. */
function playersJson(...entries) {
  return { content: entries.map(([Name, Id]) => ({ Name, Id, ELO: 1000 })) };
}

/** elo_history file content for a player with given points array. */
function eloHistoryFile(playerId, playerName, points) {
  return { content: { playerId, playerName, points } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('base/backup-data');
  mockWriteFile.mockResolvedValue(undefined);
  mockGhLog.mockReturnValue(undefined);
  // Default: any unspecified readFile call returns null
  mockReadFile.mockResolvedValue(null);
  // By default ELO calculation returns a fixed value
  mockCalculateClassicElo.mockImplementation((elo) => elo + 10);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateMonthlyOverviews', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generateMonthlyOverviews('2025-01')).rejects.toThrow('GitHub not configured');
  });

  it('throws when yearMonth format is invalid', async () => {
    await expect(generateMonthlyOverviews('2025/01')).rejects.toThrow('yearMonth must be YYYY-MM');
    await expect(generateMonthlyOverviews('January')).rejects.toThrow('yearMonth must be YYYY-MM');
    await expect(generateMonthlyOverviews('')).rejects.toThrow('yearMonth must be YYYY-MM');
  });

  it('throws when no match files exist for the month', async () => {
    mockListContents.mockResolvedValue([]);
    await expect(generateMonthlyOverviews('2025-01')).rejects.toThrow('No match files found for 2025-01');
  });

  it('throws when all matches have 0-0 scores', async () => {
    const m = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 0, 0);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json')) return playersJson();
      if (path.includes('2025-01-10.json')) return { content: { matches: [{}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m);
    await expect(generateMonthlyOverviews('2025-01')).rejects.toThrow('No valid matches found for 2025-01');
  });

  it('counts wins, losses, points correctly', async () => {
    const m = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json')) return playersJson();
      if (path.includes('2025-01-10.json')) return { content: { matches: [{}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m);

    await generateMonthlyOverviews('2025-01');
    const [, payload] = mockWriteFile.mock.calls[0];

    const a = payload.find(p => p.Name === 'A');
    const c = payload.find(p => p.Name === 'C');
    expect(a.Wins).toBe(1);
    expect(a.Losses).toBe(0);
    expect(a.Total_Points).toBe(10);
    expect(c.Wins).toBe(0);
    expect(c.Losses).toBe(1);
    expect(c.Total_Points).toBe(5);
  });

  it('seeds ELO from individual elo_history file', async () => {
    const m = match('2025-02-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    mockListContents.mockResolvedValue([
      { name: '2025-02-10.json', type: 'file', path: 'base/backup-data/2025/2025-02/2025-02-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json'))
        return playersJson(['A', 'id-a'], ['B', 'id-b'], ['C', 'id-c'], ['D', 'id-d']);
      if (path.includes('elo_history_id-a.json'))
        return eloHistoryFile('id-a', 'A', [{ date: '2025-01-15', elo: 1100, delta: 0 }]);
      if (path.includes('2025-02-10.json'))
        return { content: { matches: [{}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m);

    await generateMonthlyOverviews('2025-02');
    // First calculateClassicElo call is for t1p1 = A — seeded from history at 1100
    const eloCall = mockCalculateClassicElo.mock.calls[0];
    expect(eloCall[0]).toBe(1100);
  });

  it('correctly picks last ELO before yearMonth from history', async () => {
    // Player C has entries before and after 2025-02 — should use last before
    const m = match('2025-02-10', 1, 'A', 'C', 'B', 'D', 10, 5);
    mockListContents.mockResolvedValue([
      { name: '2025-02-10.json', type: 'file', path: 'base/backup-data/2025/2025-02/2025-02-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json'))
        return playersJson(['A', 'id-a'], ['C', 'id-c'], ['B', 'id-b'], ['D', 'id-d']);
      if (path.includes('elo_history_id-c.json'))
        return eloHistoryFile('id-c', 'C', [
          { date: '2024-11-01', elo: 1100, delta: 0 },
          { date: '2025-01-15', elo: 1250, delta: 150 },
          { date: '2025-02-20', elo: 900,  delta: -350 }, // after yearMonth — must be ignored
        ]);
      if (path.includes('2025-02-10.json'))
        return { content: { matches: [{}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m);

    await generateMonthlyOverviews('2025-02');
    // t1p2 = C → 2nd calculateClassicElo call
    const callForC = mockCalculateClassicElo.mock.calls[1];
    expect(callForC[0]).toBe(1250);
  });

  it('defaults to 1000 when player absent from all elo_history', async () => {
    const m = match('2025-02-10', 1, 'Known', 'BrandNew', 'X', 'Y', 10, 5);
    mockListContents.mockResolvedValue([
      { name: '2025-02-10.json', type: 'file', path: 'base/backup-data/2025/2025-02/2025-02-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json'))
        return playersJson(['Known', 'id-known']); // BrandNew not in players.json
      if (path.includes('elo_history_id-known.json'))
        return eloHistoryFile('id-known', 'Known', [{ date: '2025-01-01', elo: 1200, delta: 0 }]);
      if (path.includes('2025-02-10.json'))
        return { content: { matches: [{}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m);

    await generateMonthlyOverviews('2025-02');
    // t1p2 = BrandNew → 2nd call → should be seeded at 1000
    const callForBrandNew = mockCalculateClassicElo.mock.calls[1];
    expect(callForBrandNew[0]).toBe(1000);
  });

  it('result sorted by ELO descending', async () => {
    const m1 = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    const m2 = match('2025-01-10', 2, 'A', 'C', 'B', 'D', 8, 12);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json')) return playersJson();
      if (path.includes('2025-01-10.json')) return { content: { matches: [{}, {}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m1).mockReturnValueOnce(m2);

    let counter = 1000;
    mockCalculateClassicElo.mockImplementation(() => (counter += 5));

    await generateMonthlyOverviews('2025-01');
    const [, payload] = mockWriteFile.mock.calls[0];

    const elos = payload.map(p => Array.isArray(p.ELO) ? p.ELO[p.ELO.length - 1].ELO : p.ELO);
    for (let i = 1; i < elos.length; i++) {
      expect(elos[i]).toBeLessThanOrEqual(elos[i - 1]);
    }
  });

  it('writes to correct path and returns { written, month }', async () => {
    const m = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile.mockImplementation(async (path) => {
      if (path.includes('players.json')) return playersJson();
      if (path.includes('2025-01-10.json')) return { content: { matches: [{}] } };
      return null;
    });
    mockFromBackupMatch.mockReturnValueOnce(m);

    const result = await generateMonthlyOverviews('2025-01');
    const [path] = mockWriteFile.mock.calls[0];

    expect(path).toBe('base/backup-data/2025/2025-01/players_overview.json');
    expect(result).toEqual({ written: 1, month: '2025-01' });
  });
});

