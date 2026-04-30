/**
 * Tests for js/scripts/generate-players-json.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetConfig  = vi.fn();
const mockMatchesBase = vi.fn();
const mockListContents = vi.fn();
const mockReadFile   = vi.fn();
const mockWriteFile  = vi.fn();
const mockGhLog      = vi.fn();

vi.mock('../../js/services/github.js', () => ({
  getConfig:    (...a) => mockGetConfig(...a),
  matchesBase:  (...a) => mockMatchesBase(...a),
  listContents: (...a) => mockListContents(...a),
  readFile:     (...a) => mockReadFile(...a),
  writeFile:    (...a) => mockWriteFile(...a),
  ghLog:        (...a) => mockGhLog(...a),
}));

import { generatePlayersJson } from '../../js/scripts/generate-players-json.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'base/backup-data' };
}

function makeOverviewRow(name, elo, wins = 5, losses = 3, points = 80) {
  return { Name: name, ELO: elo, Wins: wins, Losses: losses, Total_Points: points };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue(cfg());
  mockMatchesBase.mockReturnValue('base/backup-data');
  mockWriteFile.mockResolvedValue(undefined);
  mockGhLog.mockReturnValue(undefined);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generatePlayersJson', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generatePlayersJson()).rejects.toThrow('GitHub not configured');
  });

  it('throws when no overview files exist', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile.mockResolvedValue(null); // no content
    await expect(generatePlayersJson()).rejects.toThrow('No players_overview.json files found');
  });

  it('aggregates wins/losses/points across months', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([
      { name: '2025-01', type: 'dir' },
      { name: '2025-02', type: 'dir' },
    ]);
    // Jan overview
    mockReadFile.mockResolvedValueOnce({
      content: [makeOverviewRow('Alice', 1050, 3, 2, 50)],
      sha: 'sha1',
    });
    // Feb overview
    mockReadFile.mockResolvedValueOnce({
      content: [makeOverviewRow('Alice', 1100, 4, 1, 60)],
      sha: 'sha2',
    });
    // existing players.json
    mockReadFile.mockResolvedValueOnce(null);

    let written;
    await generatePlayersJson((label) => {});
    const [path, payload] = mockWriteFile.mock.calls[0];

    const alice = payload.find(p => p.Name === 'Alice');
    expect(alice.Wins).toBe(7);
    expect(alice.Losses).toBe(3);
    expect(alice.TotalPoints).toBe(110);
  });

  it('ELO = last month, PreviousELO = second-to-last', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([
      { name: '2025-01', type: 'dir' },
      { name: '2025-02', type: 'dir' },
    ]);
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Bob', 1000)], sha: 'a' });
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Bob', 1080)], sha: 'b' });
    mockReadFile.mockResolvedValueOnce(null);

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const bob = payload.find(p => p.Name === 'Bob');

    expect(bob.ELO).toBe(1080);
    expect(bob.PreviousELO).toBe(1000);
  });

  it('PreviousELO uses second-to-last tournament day when player plays multiple days in one month', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2026', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([
      { name: '2026-03', type: 'dir' },
      { name: '2026-04', type: 'dir' },
    ]);
    // March: single day, ELO 1138.49
    mockReadFile.mockResolvedValueOnce({
      content: [{
        Name: 'Mino',
        ELO: [{ Date: '2026-03-24', ELO: 1138.49 }],
        Wins: 5, Losses: 2, Total_Points: 90,
      }],
      sha: 'sha-mar',
    });
    // April: TWO days in the same month
    mockReadFile.mockResolvedValueOnce({
      content: [{
        Name: 'Mino',
        ELO: [
          { Date: '2026-04-28', ELO: 968.13 },
          { Date: '2026-04-30', ELO: 1040.11 },
        ],
        Wins: 4, Losses: 3, Total_Points: 70,
      }],
      sha: 'sha-apr',
    });
    mockReadFile.mockResolvedValueOnce(null);

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const mino = payload.find(p => p.Name === 'Mino');

    expect(mino.ELO).toBe(1040.11);
    // Must be second-to-last DAY (Apr 28), NOT second-to-last month (Mar → 1138.49)
    expect(mino.PreviousELO).toBe(968.13);
  });
  it('PreviousELO equals ELO when player appears in only one month', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Carol', 1200)], sha: 'a' });
    mockReadFile.mockResolvedValueOnce(null);

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const carol = payload.find(p => p.Name === 'Carol');

    expect(carol.ELO).toBe(1200);
    expect(carol.PreviousELO).toBe(1200);
  });

  it('result sorted by ELO descending', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile.mockResolvedValueOnce({
      content: [
        makeOverviewRow('Low',  900),
        makeOverviewRow('High', 1200),
        makeOverviewRow('Mid',  1050),
      ],
      sha: 'a',
    });
    mockReadFile.mockResolvedValueOnce(null);

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    const elos = payload.map(p => p.ELO);

    expect(elos).toEqual([1200, 1050, 900]);
  });

  it('Average = TotalPoints / (Wins + Losses) rounded to 2dp', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    // 10 games total (7W + 3L), 157 points → avg 15.7
    mockReadFile.mockResolvedValueOnce({
      content: [makeOverviewRow('Dave', 1000, 7, 3, 157)],
      sha: 'a',
    });
    mockReadFile.mockResolvedValueOnce(null);

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload[0].Average).toBeCloseTo(15.7, 2);
  });

  it('Tournaments = number of months player appeared in', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([
      { name: '2025-01', type: 'dir' },
      { name: '2025-02', type: 'dir' },
      { name: '2025-03', type: 'dir' },
    ]);
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Eve', 1000)], sha: 'a' });
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Eve', 1010)], sha: 'b' });
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Eve', 1020)], sha: 'c' });
    mockReadFile.mockResolvedValueOnce(null);

    await generatePlayersJson();
    const [, payload] = mockWriteFile.mock.calls[0];
    expect(payload[0].Tournaments).toBe(3);
  });

  it('writes to <base>/players.json and returns { written }', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([{ name: '2025-01', type: 'dir' }]);
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Frank', 1000)], sha: 'a' });
    mockReadFile.mockResolvedValueOnce(null);

    const result = await generatePlayersJson();
    const [path] = mockWriteFile.mock.calls[0];

    expect(path).toBe('base/backup-data/players.json');
    expect(result).toEqual({ written: 1 });
  });

  it('skips months where overview is null or empty array', async () => {
    mockListContents.mockResolvedValueOnce([{ name: '2025', type: 'dir' }]);
    mockListContents.mockResolvedValueOnce([
      { name: '2025-01', type: 'dir' },
      { name: '2025-02', type: 'dir' },
    ]);
    // Jan: null (no file)
    mockReadFile.mockResolvedValueOnce(null);
    // Feb: valid
    mockReadFile.mockResolvedValueOnce({ content: [makeOverviewRow('Grace', 1050)], sha: 'b' });
    mockReadFile.mockResolvedValueOnce(null);

    const result = await generatePlayersJson();
    expect(result.written).toBe(1);
  });
});
