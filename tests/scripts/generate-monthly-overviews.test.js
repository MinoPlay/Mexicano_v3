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

/** Set up listContents to return one month dir with day files, then stub readFile for each day. */
function setupMonth(yearMonth, matches) {
  const year = yearMonth.slice(0, 4);
  const prefix = 'base/backup-data/';

  // listContents call for the month directory
  mockListContents.mockResolvedValue([
    { name: `${yearMonth}-10.json`, type: 'file', path: `${prefix}${year}/${yearMonth}/${yearMonth}-10.json` },
  ]);

  // readFile: prev month overview (none), then day file
  mockReadFile
    .mockResolvedValueOnce(null)                          // prev month overview
    .mockResolvedValueOnce({ content: { matches: [] } }); // day file (raw — bypassed by fromBackupMatch mock)

  // fromBackupMatch returns pre-built match objects directly
  matches.forEach(m => mockFromBackupMatch.mockReturnValueOnce(m));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('base/backup-data');
  mockWriteFile.mockResolvedValue(undefined);
  mockGhLog.mockReturnValue(undefined);
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
    mockReadFile.mockResolvedValueOnce(null); // prev month
    mockListContents.mockResolvedValue([]);   // empty month dir

    await expect(generateMonthlyOverviews('2025-01')).rejects.toThrow('No match files found for 2025-01');
  });

  it('throws when all matches have 0-0 scores', async () => {
    const m = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 0, 0);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: { matches: [{}] } });
    mockFromBackupMatch.mockReturnValueOnce(m);

    await expect(generateMonthlyOverviews('2025-01')).rejects.toThrow('No valid matches found for 2025-01');
  });

  it('counts wins, losses, points correctly', async () => {
    // A&B beat C&D 10-5 → A,B: 1W, C,D: 1L
    const m = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    setupMonth('2025-01', [m]);
    mockReadFile.mockReset();
    mockReadFile
      .mockResolvedValueOnce(null)  // prev month
      .mockResolvedValueOnce({ content: { matches: [{}] } }) // day file
      .mockResolvedValueOnce(null); // existing players_overview.json

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

  it('seeds ELO from previous month overview', async () => {
    const prevOverview = [
      { Name: 'A', ELO: 1100 },
      { Name: 'B', ELO: 900 },
    ];
    mockListContents.mockResolvedValue([
      { name: '2025-02-10.json', type: 'file', path: 'base/backup-data/2025/2025-02/2025-02-10.json' },
    ]);

    // First readFile call = prev month overview (Dec 2025 = 2025-01)
    mockReadFile
      .mockResolvedValueOnce({ content: prevOverview })
      .mockResolvedValueOnce({ content: { matches: [{}] } })
      .mockResolvedValueOnce(null);

    const m = match('2025-02-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    mockFromBackupMatch.mockReturnValueOnce(m);

    // Verify calculateClassicElo is called with seeded ELO for A (1100)
    await generateMonthlyOverviews('2025-02');
    const eloCall = mockCalculateClassicElo.mock.calls[0];
    expect(eloCall[0]).toBe(1100); // A's seeded ELO
  });

  it('result sorted by ELO descending', async () => {
    const m1 = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    const m2 = match('2025-01-10', 2, 'A', 'C', 'B', 'D', 8, 12);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: { matches: [{}, {}] } })
      .mockResolvedValueOnce(null);
    mockFromBackupMatch.mockReturnValueOnce(m1).mockReturnValueOnce(m2);

    // Give each player a distinct ELO via the mock
    let counter = 1000;
    mockCalculateClassicElo.mockImplementation(() => (counter += 5));

    await generateMonthlyOverviews('2025-01');
    const [, payload] = mockWriteFile.mock.calls[0];
    const elos = payload.map(p => p.ELO);

    for (let i = 1; i < elos.length; i++) {
      expect(elos[i]).toBeLessThanOrEqual(elos[i - 1]);
    }
  });

  it('writes to correct path and returns { written, month }', async () => {
    const m = match('2025-01-10', 1, 'A', 'B', 'C', 'D', 10, 5);
    mockListContents.mockResolvedValue([
      { name: '2025-01-10.json', type: 'file', path: 'base/backup-data/2025/2025-01/2025-01-10.json' },
    ]);
    mockReadFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: { matches: [{}] } })
      .mockResolvedValueOnce(null);
    mockFromBackupMatch.mockReturnValueOnce(m);

    const result = await generateMonthlyOverviews('2025-01');
    const [path] = mockWriteFile.mock.calls[0];

    expect(path).toBe('base/backup-data/2025/2025-01/players_overview.json');
    expect(result).toEqual({ written: 1, month: '2025-01' });
  });
});
