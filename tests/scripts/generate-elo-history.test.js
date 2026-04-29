/**
 * Tests for js/scripts/generate-elo-history.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetConfig      = vi.fn();
const mockMatchesBase    = vi.fn();
const mockListContents   = vi.fn();
const mockReadFile       = vi.fn();
const mockWriteFile      = vi.fn();
const mockGhLog          = vi.fn();
const mockPullAllMatches = vi.fn();

vi.mock('../../js/services/github.js', () => ({
  getConfig:       (...a) => mockGetConfig(...a),
  matchesBase:     (...a) => mockMatchesBase(...a),
  listContents:    (...a) => mockListContents(...a),
  readFile:        (...a) => mockReadFile(...a),
  writeFile:       (...a) => mockWriteFile(...a),
  ghLog:           (...a) => mockGhLog(...a),
  pullAllMatches:  (...a) => mockPullAllMatches(...a),
}));

const mockGetEloHistoryAllTime = vi.fn();

vi.mock('../../js/services/elo.js', () => ({
  getEloHistoryAllTime: (...a) => mockGetEloHistoryAllTime(...a),
}));

import { generateEloHistory } from '../../js/scripts/generate-elo-history.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'base/backup-data' };
}

/** Minimal players_overview.json content with new ELO array format */
const SAMPLE_OVERVIEW_ROWS = [
  { Name: 'Alice', ELO: [{ Date: '2025-01-10', ELO: 1050 }], Wins: 2, Losses: 1, Total_Points: 30, Average: 15 },
  { Name: 'Bob',   ELO: [{ Date: '2025-01-10', ELO: 980  }], Wins: 1, Losses: 2, Total_Points: 20, Average: 10 },
];

/** Setup listContents + readFile mocks to return one year/month with an overview. */
function setupOverviews(rows = SAMPLE_OVERVIEW_ROWS) {
  mockListContents
    .mockResolvedValueOnce([{ name: '2025', type: 'dir' }])            // year dirs
    .mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);        // month dirs

  mockReadFile
    .mockResolvedValueOnce({ content: rows, sha: 'overview-sha' })     // players_overview.json
    .mockResolvedValueOnce({ sha: 'elo-history-sha' });                // existing elo_history.json
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('base/backup-data');
  mockWriteFile.mockResolvedValue(undefined);
  mockGhLog.mockReturnValue(undefined);
  mockPullAllMatches.mockResolvedValue([]);
  mockGetEloHistoryAllTime.mockReturnValue({ players: {}, dates: [] });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateEloHistory', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generateEloHistory()).rejects.toThrow('GitHub not configured');
  });

  it('throws when no overview files found', async () => {
    mockListContents
      .mockResolvedValueOnce([{ name: '2025', type: 'dir' }])
      .mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile.mockResolvedValueOnce(null); // overview missing

    await expect(generateEloHistory()).rejects.toThrow('No players_overview.json files found');
  });

  it('writes to <base>/elo_history.json', async () => {
    setupOverviews();
    await generateEloHistory();
    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toBe('base/backup-data/elo_history.json');
  });

  it('output payload includes generatedAt, players, dates', async () => {
    setupOverviews();
    await generateEloHistory();
    const [, payload] = mockWriteFile.mock.calls[0];

    expect(payload).toHaveProperty('generatedAt');
    expect(payload.players).toHaveProperty('Alice');
    expect(payload.players).toHaveProperty('Bob');
    expect(Array.isArray(payload.dates)).toBe(true);
    expect(payload.dates).toContain('2025-01-10');
  });

  it('extracts ELO entries from array format and builds history', async () => {
    setupOverviews();
    await generateEloHistory();
    const [, payload] = mockWriteFile.mock.calls[0];

    expect(payload.players.Alice).toEqual([{ date: '2025-01-10', elo: 1050, delta: 0 }]);
    expect(payload.players.Bob).toEqual([{ date: '2025-01-10', elo: 980, delta: 0 }]);
  });

  it('passes existing sha to writeFile', async () => {
    setupOverviews();
    await generateEloHistory();
    const [, , sha] = mockWriteFile.mock.calls[0];
    expect(sha).toBe('elo-history-sha');
  });

  it('returns { written: playerCount }', async () => {
    setupOverviews();
    const result = await generateEloHistory();
    expect(result).toEqual({ written: 2 });
  });

  it('forwards progress calls when onProgress provided', async () => {
    setupOverviews();
    const onProgress = vi.fn();
    await generateEloHistory(onProgress);
    expect(onProgress).toHaveBeenCalled();
  });

  it('uses legacy match-file fallback when all overviews have number ELO', async () => {
    const legacyRows = [
      { Name: 'Alice', ELO: 1050, Wins: 2, Losses: 1, Total_Points: 30, Average: 15 },
    ];
    mockListContents
      .mockResolvedValueOnce([{ name: '2025', type: 'dir' }])
      .mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile
      .mockResolvedValueOnce({ content: legacyRows, sha: 'sha1' }) // overview
      .mockResolvedValueOnce({ sha: 'sha2' });                     // existing elo_history

    const legacyHistory = {
      players: { Alice: [{ date: '2025-01-10', elo: 1050, delta: 0 }] },
      dates: ['2025-01-10'],
    };
    mockGetEloHistoryAllTime.mockReturnValue(legacyHistory);

    await generateEloHistory();
    expect(mockPullAllMatches).toHaveBeenCalledOnce();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload.players).toEqual(legacyHistory.players);
  });

  it('computes delta between consecutive ELO points for same player', async () => {
    const rows = [
      {
        Name: 'Alice',
        ELO: [
          { Date: '2025-01-10', ELO: 1000 },
          { Date: '2025-01-17', ELO: 1020 },
        ],
      },
    ];
    setupOverviews(rows);
    await generateEloHistory();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload.players.Alice[0].delta).toBe(0);
    expect(payload.players.Alice[1].delta).toBe(20);
  });
});
