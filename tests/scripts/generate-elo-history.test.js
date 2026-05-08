/**
 * Tests for js/scripts/generate-elo-history.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGetConfig    = vi.fn();
const mockMatchesBase  = vi.fn();
const mockListContents = vi.fn();
const mockReadFile     = vi.fn();
const mockWriteFile    = vi.fn();
const mockGhLog        = vi.fn();

vi.mock('../../js/services/github.js', () => ({
  getConfig:    (...a) => mockGetConfig(...a),
  matchesBase:  (...a) => mockMatchesBase(...a),
  listContents: (...a) => mockListContents(...a),
  readFile:     (...a) => mockReadFile(...a),
  writeFile:    (...a) => mockWriteFile(...a),
  ghLog:        (...a) => mockGhLog(...a),
}));

import { generateEloHistory } from '../../js/scripts/generate-elo-history.js';

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'base/backup-data' };
}

const PLAYERS_JSON = [
  { Id: 'p-alice', Name: 'Alice', ELO: 1050 },
  { Id: 'p-bob', Name: 'Bob', ELO: 980 },
];

const OVERVIEW_ROWS = [
  { Name: 'Alice', ELO: [{ Date: '2025-01-10', ELO: 1050 }, { Date: '2025-01-17', ELO: 1070 }] },
  { Name: 'Bob',   ELO: [{ Date: '2025-01-10', ELO: 980 }] },
];

function setupRepo({ players = PLAYERS_JSON, overviewRows = OVERVIEW_ROWS, existing = {} } = {}) {
  mockListContents
    .mockResolvedValueOnce([{ name: '2025', type: 'dir' }])
    .mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);

  mockReadFile.mockImplementation(async (path) => {
    if (path === 'base/backup-data/players.json') {
      return { content: players, sha: 'players-sha' };
    }
    if (path === 'base/backup-data/2025/2025-01/players_overview.json') {
      return { content: overviewRows, sha: 'overview-sha' };
    }
    if (Object.prototype.hasOwnProperty.call(existing, path)) {
      return existing[path];
    }
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('base/backup-data');
  mockWriteFile.mockResolvedValue(undefined);
  mockGhLog.mockReturnValue(undefined);
});

describe('generateEloHistory', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generateEloHistory()).rejects.toThrow('GitHub not configured');
  });

  it('throws when players.json has missing Id', async () => {
    setupRepo({ players: [{ Name: 'Alice', ELO: 1000 }] });
    await expect(generateEloHistory()).rejects.toThrow('players.json missing Id');
  });

  it('throws when no overview files found', async () => {
    mockListContents
      .mockResolvedValueOnce([{ name: '2025', type: 'dir' }])
      .mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile.mockImplementation(async (path) => {
      if (path === 'base/backup-data/players.json') return { content: PLAYERS_JSON, sha: 'players-sha' };
      return null;
    });
    await expect(generateEloHistory()).rejects.toThrow('No players_overview.json files found');
  });

  it('writes one file per player Id', async () => {
    setupRepo();
    await generateEloHistory();
    const paths = mockWriteFile.mock.calls.map(c => c[0]).sort();
    expect(paths).toEqual([
      'base/backup-data/elo_history/elo_history_p-alice.json',
      'base/backup-data/elo_history/elo_history_p-bob.json',
    ]);
  });

  it('writes payload with player info and points', async () => {
    setupRepo();
    await generateEloHistory();
    const aliceCall = mockWriteFile.mock.calls.find(c => c[0].endsWith('elo_history_p-alice.json'));
    const [, payload] = aliceCall;
    expect(payload).toHaveProperty('generatedAt');
    expect(payload.playerId).toBe('p-alice');
    expect(payload.playerName).toBe('Alice');
    expect(payload.points).toEqual([
      { date: '2025-01-10', elo: 1050, delta: 0 },
      { date: '2025-01-17', elo: 1070, delta: 20 },
    ]);
    expect(payload.dates).toEqual(['2025-01-10', '2025-01-17']);
  });

  it('passes existing sha to writeFile when file exists', async () => {
    setupRepo({
      existing: {
        'base/backup-data/elo_history/elo_history_p-alice.json': { sha: 'sha-alice' },
      },
    });
    await generateEloHistory();
    const aliceCall = mockWriteFile.mock.calls.find(c => c[0].endsWith('elo_history_p-alice.json'));
    expect(aliceCall[2]).toBe('sha-alice');
  });

  it('supports targeted playerIds', async () => {
    setupRepo();
    const result = await generateEloHistory(undefined, { playerIds: ['p-bob'] });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile.mock.calls[0][0]).toBe('base/backup-data/elo_history/elo_history_p-bob.json');
    expect(result).toEqual({ written: 1, playerIds: ['p-bob'] });
  });

  it('returns written playerIds for full rebuild', async () => {
    setupRepo();
    const result = await generateEloHistory();
    expect(result.written).toBe(2);
    expect(result.playerIds).toEqual(expect.arrayContaining(['p-alice', 'p-bob']));
  });

  it('throws when overview player is missing in players.json', async () => {
    setupRepo({
      overviewRows: [{ Name: 'Ghost', ELO: [{ Date: '2025-01-10', ELO: 1000 }] }],
    });
    await expect(generateEloHistory()).rejects.toThrow('missing in players.json');
  });

  it('forwards progress calls when onProgress provided', async () => {
    setupRepo();
    const onProgress = vi.fn();
    await generateEloHistory(onProgress);
    expect(onProgress).toHaveBeenCalled();
  });
});
