/**
 * Integration test: 2026-05-05 tournament simulation.
 *
 * Uses real backup-data elo_history files as ELO seed source.
 * Simulates all 10 rounds (20 matches) of 2026-05-05, then calls
 * generateMonthlyOverviews for 2026-05 with a mocked GitHub API that
 * returns the real file contents.
 *
 * Validates:
 * 1. Correct ELO values after the tournament (incl. CW seeded from elo_history)
 * 2. Correct per-player stats in the generated overview
 * 3. Only the intended file (players_overview.json) is written
 * 4. No extra files are read/written beyond what is expected
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { calculateAllEloRankings, processMatchElo } from '../../js/services/elo.js';

// ─── Real backup data paths ───────────────────────────────────────────────────

const BACKUP = 'C:/Private/DataHub_Mexicano/mexicano_v3/backup-data';

function loadJson(relPath) {
  return JSON.parse(readFileSync(join(BACKUP, relPath), 'utf8'));
}

const playersJson        = loadJson('players.json');
const may0505TournamentFile = loadJson('2026/2026-05/2026-05-05.json');

// Camelise a raw backup match record
function toMatch(m) {
  return {
    date:               m.Date,
    roundNumber:        m.RoundNumber,
    scoreTeam1:         m.ScoreTeam1,
    scoreTeam2:         m.ScoreTeam2,
    team1Player1Name:   m.Team1Player1Name,
    team1Player2Name:   m.Team1Player2Name,
    team2Player1Name:   m.Team2Player1Name,
    team2Player2Name:   m.Team2Player2Name,
  };
}

const may0505Matches = may0505TournamentFile.matches.map(toMatch);

// Build name→id map from players.json
const playerIdMap = Object.fromEntries(playersJson.map(p => [p.Name, p.Id]));

// Load elo_history for a specific player (by name)
function loadEloHistory(name) {
  const id = playerIdMap[name];
  if (!id) return null;
  try {
    return loadJson(`elo_history/elo_history_${id}.json`);
  } catch {
    return null;
  }
}

// Get last ELO before a given yearMonth from elo_history points
function lastEloBefore(name, yearMonth) {
  const hist = loadEloHistory(name);
  if (!hist?.points?.length) return null;
  let lastElo = null;
  for (const e of hist.points) {
    if (e.date < yearMonth) lastElo = e.elo;
    else break;
  }
  return lastElo;
}

// ─── Expected values (from calculateAllEloRankings, source of truth) ─────────

const EXPECTED_ELO_AFTER_0505 = {
  'Jeremy':               1249.32,
  'Kasper Arp':           1137.07,
  'Mark Brooks':          1190.42,
  'Christian Wennergren': 1128.42,
  'Kikke':                1018.49,
  'Peter':                 990.53,
  'Jonas':                1080.0,
  'Mino':                 1031.35,
};

const EXPECTED_STATS_AFTER_0505 = {
  'Jeremy':               { wins: 7, losses: 3, total_points: 139, avg: 13.9 },
  'Kasper Arp':           { wins: 6, losses: 4, total_points: 134, avg: 13.4 },
  'Mark Brooks':          { wins: 6, losses: 4, total_points: 139, avg: 13.9 },
  'Christian Wennergren': { wins: 5, losses: 5, total_points: 117, avg: 11.7 },
  'Kikke':                { wins: 3, losses: 7, total_points: 108, avg: 10.8 },
  'Peter':                { wins: 4, losses: 6, total_points: 117, avg: 11.7 },
  'Jonas':                { wins: 5, losses: 5, total_points: 125, avg: 12.5 },
  'Mino':                 { wins: 4, losses: 6, total_points: 121, avg: 12.1 },
};

// ─── Mocks for generateMonthlyOverviews ──────────────────────────────────────

const mockGetConfig      = vi.fn();
const mockMatchesBase    = vi.fn();
const mockReadFile       = vi.fn();
const mockListContents   = vi.fn();
const mockWriteFile      = vi.fn();
const mockFromBackupMatch = vi.fn((m) => toMatch(m));
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

import { generateMonthlyOverviews } from '../../js/scripts/generate-monthly-overviews.js';

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'mexicano_v3/backup-data' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('mexicano_v3/backup-data');
  mockWriteFile.mockResolvedValue({ sha: 'new-sha' });
  mockGhLog.mockReturnValue(undefined);

  // Default: any unexpected readFile returns null
  mockReadFile.mockResolvedValue(null);

  // listContents for 2026-05 returns the single tournament file
  mockListContents.mockResolvedValue([
    {
      name: '2026-05-05.json',
      type: 'file',
      path: 'mexicano_v3/backup-data/2026/2026-05/2026-05-05.json',
    },
  ]);

  mockFromBackupMatch.mockImplementation((m) => toMatch(m));

  // readFile routing:
  // 1. players.json → real players array
  // 2. each elo_history_{id}.json → real file from backup-data
  // 3. day file (2026-05-05.json) → real tournament data
  // 4. existing players_overview.json → null (no existing SHA)
  mockReadFile.mockImplementation(async (path) => {
    if (path.endsWith('players.json'))
      return { content: playersJson, sha: 'players-sha' };
    const eloHistMatch = path.match(/elo_history\/(elo_history_[^/]+\.json)$/);
    if (eloHistMatch) {
      try {
        const hist = loadJson(`elo_history/${eloHistMatch[1]}`);
        return { content: hist, sha: 'hist-sha' };
      } catch {
        return null;
      }
    }
    if (path.includes('2026-05-05.json'))
      return { content: may0505TournamentFile, sha: 'match-sha' };
    return null;
  });
});

// ─── Part 1: ELO calculation correctness (processMatchElo) ───────────────────

describe('Part 1 — ELO correctness using real 2026-05-05 data', () => {
  it('Mino seeded at 1039.27 from elo_history (last entry before 2026-05)', () => {
    expect(lastEloBefore('Mino', '2026-05')).toBeCloseTo(1039.27, 1);
  });

  it('Christian Wennergren seeded at 1169.01 from elo_history (last entry before 2026-05)', () => {
    expect(lastEloBefore('Christian Wennergren', '2026-05')).toBeCloseTo(1169.01, 1);
  });

  describe('round-by-round ELO progression for 2026-05-05', () => {
    const players = {};

    // Seed players from elo_history
    const allNames = new Set(may0505Matches.flatMap(m => [
      m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name,
    ]));
    for (const name of allNames) {
      const elo = lastEloBefore(name, '2026-05') ?? 1000;
      players[name] = { name, elo, history: [] };
    }

    const rounds = [...new Set(may0505Matches.map(m => m.roundNumber))].sort((a, b) => a - b);
    const eloAfterRound = {};

    for (const rn of rounds) {
      const roundMatches = may0505Matches.filter(m => m.roundNumber === rn);
      for (const m of roundMatches) {
        processMatchElo(m, players);
      }
      eloAfterRound[rn] = {};
      for (const name of allNames) {
        eloAfterRound[rn][name] = players[name].elo;
      }
    }

    it('Mino ELO after final round matches expected 1031.35', () => {
      const lastRound = rounds[rounds.length - 1];
      expect(eloAfterRound[lastRound]['Mino']).toBeCloseTo(1031.35, 1);
    });

    for (const [name, expected] of Object.entries(EXPECTED_ELO_AFTER_0505)) {
      it(`${name} final ELO = ${expected}`, () => {
        const lastRound = rounds[rounds.length - 1];
        expect(eloAfterRound[lastRound][name]).toBeCloseTo(expected, 1);
      });
    }
  });
});

// ─── Part 2: generateMonthlyOverviews output correctness ─────────────────────

describe('Part 2 — generateMonthlyOverviews produces correct 2026-05 output', () => {
  it('writes players_overview.json exactly once', async () => {
    await generateMonthlyOverviews('2026-05');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath] = mockWriteFile.mock.calls[0];
    expect(writtenPath).toBe('mexicano_v3/backup-data/2026/2026-05/players_overview.json');
  });

  it('written overview contains all 8 players from 2026-05-05', async () => {
    await generateMonthlyOverviews('2026-05');
    const [, payload] = mockWriteFile.mock.calls[0];
    const names = payload.map(p => p.Name);
    for (const name of Object.keys(EXPECTED_ELO_AFTER_0505)) {
      expect(names).toContain(name);
    }
  });

  it('Mino ELO after 2026-05-05 is 1031.35 (not 1016.45 from buggy seed)', async () => {
    await generateMonthlyOverviews('2026-05');
    const [, payload] = mockWriteFile.mock.calls[0];
    const mino = payload.find(p => p.Name === 'Mino');
    expect(mino).toBeDefined();
    const minoElo = Array.isArray(mino.ELO)
      ? mino.ELO.find(e => e.Date === '2026-05-05')?.ELO
      : mino.ELO;
    expect(minoElo).toBeCloseTo(1031.35, 1);
  });

  for (const [name, expected] of Object.entries(EXPECTED_ELO_AFTER_0505)) {
    it(`${name} ELO snapshot for 2026-05-05 = ${expected}`, async () => {
      await generateMonthlyOverviews('2026-05');
      const [, payload] = mockWriteFile.mock.calls[0];
      const player = payload.find(p => p.Name === name);
      expect(player, `${name} missing from overview`).toBeDefined();
      const elo = Array.isArray(player.ELO)
        ? player.ELO.find(e => e.Date === '2026-05-05')?.ELO
        : player.ELO;
      expect(elo).toBeCloseTo(expected, 1);
    });
  }

  for (const [name, s] of Object.entries(EXPECTED_STATS_AFTER_0505)) {
    it(`${name} stats: W${s.wins} L${s.losses} ${s.total_points}pts avg ${s.avg}`, async () => {
      await generateMonthlyOverviews('2026-05');
      const [, payload] = mockWriteFile.mock.calls[0];
      const player = payload.find(p => p.Name === name);
      expect(player).toBeDefined();
      expect(player.Wins).toBe(s.wins);
      expect(player.Losses).toBe(s.losses);
      expect(player.Total_Points).toBe(s.total_points);
      expect(player.Average).toBeCloseTo(s.avg, 1);
    });
  }

  it('overview is sorted by ELO descending', async () => {
    await generateMonthlyOverviews('2026-05');
    const [, payload] = mockWriteFile.mock.calls[0];
    const elos = payload.map(p =>
      Array.isArray(p.ELO) ? p.ELO[p.ELO.length - 1]?.ELO : p.ELO,
    );
    for (let i = 1; i < elos.length; i++) {
      expect(elos[i]).toBeLessThanOrEqual(elos[i - 1]);
    }
  });
});

// ─── Part 3: File write isolation ─────────────────────────────────────────────

describe('Part 3 — only intended files are modified', () => {
  it('no extra writeFile calls beyond players_overview.json', async () => {
    await generateMonthlyOverviews('2026-05');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('listContents called once for the 2026-05 month directory', async () => {
    await generateMonthlyOverviews('2026-05');
    expect(mockListContents).toHaveBeenCalledTimes(1);
    const [listPath] = mockListContents.mock.calls[0];
    expect(listPath).toContain('2026/2026-05');
  });

  it('readFile calls include players.json, day file, and elo_history files', async () => {
    await generateMonthlyOverviews('2026-05');
    const paths = mockReadFile.mock.calls.map(c => c[0]);
    expect(paths.some(p => p.endsWith('players.json'))).toBe(true);
    expect(paths.some(p => p.includes('2026-05-05.json'))).toBe(true);
    expect(paths.some(p => p.includes('elo_history/'))).toBe(true);
  });

  it('reads elo_history file for Christian Wennergren (who skipped April)', async () => {
    await generateMonthlyOverviews('2026-05');
    const paths = mockReadFile.mock.calls.map(c => c[0]);
    const cwId = playerIdMap['Christian Wennergren'];
    expect(paths.some(p => p.includes(`elo_history_${cwId}.json`))).toBe(true);
  });
});
