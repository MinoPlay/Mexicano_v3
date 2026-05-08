/**
 * Tests for js/scripts/generate-players-json.js
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

import { generatePlayersJson } from '../../js/scripts/generate-players-json.js';

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'base/backup-data' };
}

function makeOverviewRow(name, elo, wins = 5, losses = 3, points = 80) {
  return { Name: name, ELO: elo, Wins: wins, Losses: losses, Total_Points: points };
}

function setupRepo({ months = {}, existingPlayers = null } = {}) {
  const monthNames = Object.keys(months).sort();
  mockListContents
    .mockResolvedValueOnce([{ name: '2025', type: 'dir' }])
    .mockResolvedValueOnce(monthNames.map(name => ({ name, type: 'dir' })));

  mockReadFile.mockImplementation(async (path) => {
    if (path === 'base/backup-data/players.json') {
      if (existingPlayers == null) return null;
      return { content: existingPlayers, sha: 'players-sha' };
    }
    const m = path.match(/base\/backup-data\/2025\/(2025-\d{2})\/players_overview\.json$/);
    if (m) return { content: months[m[1]] ?? null, sha: `sha-${m[1]}` };
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

describe('generatePlayersJson', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generatePlayersJson()).rejects.toThrow('GitHub not configured');
  });

  it('throws when no overview files exist', async () => {
    setupRepo({ months: { '2025-01': null } });
    await expect(generatePlayersJson()).rejects.toThrow('No players_overview.json files found');
  });

  it('aggregates wins/losses/points across months', async () => {
    setupRepo({
      months: {
        '2025-01': [makeOverviewRow('Alice', 1050, 3, 2, 50)],
        '2025-02': [makeOverviewRow('Alice', 1100, 4, 1, 60)],
      },
    });

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const alice = payload.find(p => p.Name === 'Alice');
    expect(alice.Wins).toBe(7);
    expect(alice.Losses).toBe(3);
    expect(alice.TotalPoints).toBe(110);
  });

  it('ELO = last month, PreviousELO = second-to-last', async () => {
    setupRepo({
      months: {
        '2025-01': [makeOverviewRow('Bob', 1000)],
        '2025-02': [makeOverviewRow('Bob', 1080)],
      },
    });

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const bob = payload.find(p => p.Name === 'Bob');
    expect(bob.ELO).toBe(1080);
    expect(bob.PreviousELO).toBe(1000);
  });

  it('PreviousELO uses second-to-last tournament day in ELO array format', async () => {
    setupRepo({
      months: {
        '2025-01': [{
          Name: 'Mino',
          ELO: [{ Date: '2025-01-10', ELO: 1000 }, { Date: '2025-01-20', ELO: 1020 }],
          Wins: 4,
          Losses: 1,
          Total_Points: 80,
        }],
      },
    });

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const mino = payload.find(p => p.Name === 'Mino');
    expect(mino.ELO).toBe(1020);
    expect(mino.PreviousELO).toBe(1000);
  });

  it('result sorted by ELO descending', async () => {
    setupRepo({
      months: {
        '2025-01': [
          makeOverviewRow('Low', 900),
          makeOverviewRow('High', 1200),
          makeOverviewRow('Mid', 1050),
        ],
      },
    });

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload.map(p => p.ELO)).toEqual([1200, 1050, 900]);
  });

  it('Average = TotalPoints / (Wins + Losses) rounded to 2dp', async () => {
    setupRepo({
      months: {
        '2025-01': [makeOverviewRow('Dave', 1000, 7, 3, 157)],
      },
    });
    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload[0].Average).toBeCloseTo(15.7, 2);
  });

  it('Tournaments = number of months player appeared in', async () => {
    setupRepo({
      months: {
        '2025-01': [makeOverviewRow('Eve', 1000)],
        '2025-02': [makeOverviewRow('Eve', 1010)],
        '2025-03': [makeOverviewRow('Eve', 1020)],
      },
    });
    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload[0].Tournaments).toBe(3);
  });

  it('writes to <base>/players.json and returns { written }', async () => {
    setupRepo({ months: { '2025-01': [makeOverviewRow('Frank', 1000)] } });
    const result = await generatePlayersJson();
    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toBe('base/backup-data/players.json');
    expect(result).toEqual({ written: 1 });
  });

  it('adds Id and reuses existing Id from players.json', async () => {
    setupRepo({
      months: { '2025-01': [makeOverviewRow('Alice', 1050)] },
      existingPlayers: [{ Id: 'alice-existing-id', Name: 'Alice', ELO: 1000 }],
    });

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload[0].Id).toBe('alice-existing-id');
  });

  it('throws on normalized player name collision', async () => {
    setupRepo({
      months: {
        '2025-01': [makeOverviewRow('Alice', 1000), makeOverviewRow(' alice ', 1010)],
      },
    });
    await expect(generatePlayersJson()).rejects.toThrow('collision');
  });
});
