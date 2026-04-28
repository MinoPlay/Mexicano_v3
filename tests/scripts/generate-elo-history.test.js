/**
 * Tests for js/scripts/generate-elo-history.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetConfig     = vi.fn();
const mockMatchesBase   = vi.fn();
const mockPullAllMatches = vi.fn();
const mockReadFile      = vi.fn();
const mockWriteFile     = vi.fn();
const mockGhLog         = vi.fn();

vi.mock('../../js/services/github.js', () => ({
  getConfig:      (...a) => mockGetConfig(...a),
  matchesBase:    (...a) => mockMatchesBase(...a),
  pullAllMatches: (...a) => mockPullAllMatches(...a),
  readFile:       (...a) => mockReadFile(...a),
  writeFile:      (...a) => mockWriteFile(...a),
  ghLog:          (...a) => mockGhLog(...a),
}));

const mockGetEloHistoryAllTime = vi.fn();

vi.mock('../../js/services/elo.js', () => ({
  getEloHistoryAllTime: (...a) => mockGetEloHistoryAllTime(...a),
}));

import { generateEloHistory } from '../../js/scripts/generate-elo-history.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub', pat: 'token', basePath: 'base/backup-data' };
}

const SAMPLE_HISTORY = {
  players: { Alice: [{ date: '2025-01-10', elo: 1050 }], Bob: [{ date: '2025-01-10', elo: 980 }] },
  dates: ['2025-01-10'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('base/backup-data');
  mockPullAllMatches.mockResolvedValue([]);
  mockGetEloHistoryAllTime.mockReturnValue(SAMPLE_HISTORY);
  mockReadFile.mockResolvedValue({ sha: 'existing-sha' });
  mockWriteFile.mockResolvedValue(undefined);
  mockGhLog.mockReturnValue(undefined);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateEloHistory', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generateEloHistory()).rejects.toThrow('GitHub not configured');
  });

  it('calls pullAllMatches to load all match data', async () => {
    await generateEloHistory();
    expect(mockPullAllMatches).toHaveBeenCalledOnce();
  });

  it('passes matches to getEloHistoryAllTime', async () => {
    const matches = [{ date: '2025-01-10', scoreTeam1: 10, scoreTeam2: 5 }];
    mockPullAllMatches.mockResolvedValue(matches);

    await generateEloHistory();

    expect(mockGetEloHistoryAllTime).toHaveBeenCalledWith(matches);
  });

  it('writes to <base>/elo_history.json', async () => {
    await generateEloHistory();
    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toBe('base/backup-data/elo_history.json');
  });

  it('output payload includes generatedAt, players, dates', async () => {
    await generateEloHistory();
    const [, payload] = mockWriteFile.mock.calls[0];

    expect(payload).toHaveProperty('generatedAt');
    expect(payload.players).toEqual(SAMPLE_HISTORY.players);
    expect(payload.dates).toEqual(SAMPLE_HISTORY.dates);
  });

  it('passes existing sha to writeFile', async () => {
    mockReadFile.mockResolvedValue({ sha: 'old-sha', content: {} });
    await generateEloHistory();
    const [, , sha] = mockWriteFile.mock.calls[0];
    expect(sha).toBe('old-sha');
  });

  it('returns { written: playerCount }', async () => {
    const result = await generateEloHistory();
    expect(result).toEqual({ written: 2 }); // Alice + Bob in SAMPLE_HISTORY
  });

  it('forwards progress calls when onProgress provided', async () => {
    const onProgress = vi.fn();
    await generateEloHistory(onProgress);
    expect(onProgress).toHaveBeenCalled();
  });
});
