/**
 * Tests for js/scripts/generate-player-summary.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── localStorage stub (Store reads from it) ──────────────────────────────────

function makeLocalStorage() {
  let store = {};
  return {
    getItem:    (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear:      () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key:        (i) => Object.keys(store)[i] ?? null,
  };
}
const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetConfig             = vi.fn();
const mockReadFile              = vi.fn();
const mockWriteFile             = vi.fn();
const mockReadDayMatches        = vi.fn();
const mockFetchTournamentsIndex = vi.fn();
const mockPlayerSummaryPath     = vi.fn();
const mockMergeSummary          = vi.fn();

vi.mock('../../js/services/github.js', () => ({
  getConfig:             (...a) => mockGetConfig(...a),
  readFile:              (...a) => mockReadFile(...a),
  writeFile:             (...a) => mockWriteFile(...a),
  readDayMatches:        (...a) => mockReadDayMatches(...a),
  fetchTournamentsIndex: (...a) => mockFetchTournamentsIndex(...a),
  playerSummaryPath:     (...a) => mockPlayerSummaryPath(...a),
  mergeSummary:          (...a) => mockMergeSummary(...a),
}));

const mockGeneratePlayerSummary    = vi.fn();
const mockCalculateOpponentStats   = vi.fn();
const mockCalculatePartnershipStats = vi.fn();

vi.mock('../../js/services/statistics.js', () => ({
  generatePlayerSummary:      (...a) => mockGeneratePlayerSummary(...a),
  calculateOpponentStats:     (...a) => mockCalculateOpponentStats(...a),
  calculatePartnershipStats:  (...a) => mockCalculatePartnershipStats(...a),
}));

import { generateOrUpdatePlayerSummary } from '../../js/scripts/generate-player-summary.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg() {
  return { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'token', basePath: 'base/backup-data' };
}

const SUMMARY_PATH = 'base/backup-data/players_summaries/summary_Alice.json';

const DELTA_SUMMARY = {
  totalTournaments: 2,
  totalWins: 8,
  totalLosses: 4,
  totalPoints: 120,
  tightWins: 1,
  solidWins: 4,
  dominatingWins: 3,
  firstPlaceFinishes: 1,
  secondPlaceFinishes: 0,
  thirdPlaceFinishes: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorageStub.clear();

  mockGetConfig.mockReturnValue(cfg());
  mockPlayerSummaryPath.mockReturnValue(SUMMARY_PATH);
  mockReadFile.mockResolvedValue(null);           // no existing summary by default
  mockWriteFile.mockResolvedValue(undefined);
  mockReadDayMatches.mockResolvedValue([]);
  mockFetchTournamentsIndex.mockResolvedValue([]);
  mockGeneratePlayerSummary.mockReturnValue(DELTA_SUMMARY);
  mockCalculateOpponentStats.mockReturnValue([]);
  mockCalculatePartnershipStats.mockReturnValue([]);
  mockMergeSummary.mockReturnValue({ merged: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateOrUpdatePlayerSummary', () => {
  it('throws when GitHub not configured', async () => {
    mockGetConfig.mockReturnValue(null);
    await expect(generateOrUpdatePlayerSummary('Alice')).rejects.toThrow('GitHub not configured');
  });

  it('returns upToDate=true when all dates already processed', async () => {
    // Existing summary already processed up to '2025-03-10'
    mockReadFile.mockResolvedValue({
      content: { playerName: 'Alice', lastProcessedDate: '2025-03-10' },
      sha: 'sha1',
    });
    // Tournaments index has dates up to and including that date
    localStorageStub.setItem(
      'mexicano_tournaments_index',
      JSON.stringify([{ date: '2025-01-10' }, { date: '2025-03-10' }])
    );

    const result = await generateOrUpdatePlayerSummary('Alice');
    expect(result).toEqual({ newDates: 0, upToDate: true });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('creates a new summary when no existing file', async () => {
    localStorageStub.setItem(
      'mexicano_tournaments_index',
      JSON.stringify([{ date: '2025-01-10' }])
    );
    mockReadDayMatches.mockResolvedValue([{ date: '2025-01-10' }]);

    const result = await generateOrUpdatePlayerSummary('Alice');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [path, payload] = mockWriteFile.mock.calls[0];
    expect(path).toBe(SUMMARY_PATH);
    expect(payload.playerName).toBe('Alice');
    expect(payload.lastProcessedDate).toBe('2025-01-10');
    expect(result).toEqual({ newDates: 1, upToDate: false });
  });

  it('uses mergeSummary for incremental update', async () => {
    mockReadFile.mockResolvedValue({
      content: { playerName: 'Alice', lastProcessedDate: '2025-01-10', totalTournaments: 1 },
      sha: 'sha-old',
    });
    localStorageStub.setItem(
      'mexicano_tournaments_index',
      JSON.stringify([{ date: '2025-01-10' }, { date: '2025-02-10' }])
    );
    mockReadDayMatches.mockResolvedValue([]);
    mockMergeSummary.mockReturnValue({ playerName: 'Alice', totalTournaments: 3, merged: true });

    const result = await generateOrUpdatePlayerSummary('Alice');

    expect(mockMergeSummary).toHaveBeenCalledOnce();
    const [path, payload] = mockWriteFile.mock.calls[0];
    expect(payload.merged).toBe(true);
    expect(result).toEqual({ newDates: 1, upToDate: false });
  });

  it('passes existing sha to writeFile', async () => {
    localStorageStub.setItem(
      'mexicano_tournaments_index',
      JSON.stringify([{ date: '2025-01-10' }])
    );
    mockReadFile.mockResolvedValue({ content: { playerName: 'Alice', lastProcessedDate: '2024-12-01' }, sha: 'my-sha' });

    await generateOrUpdatePlayerSummary('Alice');
    const [, , sha] = mockWriteFile.mock.calls[0];
    expect(sha).toBe('my-sha');
  });

  it('fetches only dates newer than lastProcessedDate', async () => {
    mockReadFile.mockResolvedValue({
      content: { playerName: 'Alice', lastProcessedDate: '2025-01-10' },
      sha: 'sha1',
    });
    localStorageStub.setItem(
      'mexicano_tournaments_index',
      JSON.stringify([
        { date: '2025-01-10' }, // already processed
        { date: '2025-02-10' }, // new
        { date: '2025-03-10' }, // new
      ])
    );

    await generateOrUpdatePlayerSummary('Alice');

    expect(mockReadDayMatches).toHaveBeenCalledTimes(2);
    expect(mockReadDayMatches).toHaveBeenCalledWith('2025-02-10');
    expect(mockReadDayMatches).toHaveBeenCalledWith('2025-03-10');
  });

  it('falls back to fetchTournamentsIndex when Store is empty', async () => {
    // localStorage empty → Store.getTournamentsIndex() returns []
    mockFetchTournamentsIndex.mockResolvedValue([{ date: '2025-06-01' }]);

    await generateOrUpdatePlayerSummary('Alice');

    expect(mockFetchTournamentsIndex).toHaveBeenCalled();
    expect(mockReadDayMatches).toHaveBeenCalledWith('2025-06-01');
  });

  it('new summary shape includes all expected fields', async () => {
    localStorageStub.setItem(
      'mexicano_tournaments_index',
      JSON.stringify([{ date: '2025-01-10' }])
    );

    await generateOrUpdatePlayerSummary('Alice');
    const [, payload] = mockWriteFile.mock.calls[0];

    expect(payload).toMatchObject({
      playerName:         'Alice',
      lastProcessedDate:  '2025-01-10',
      totalTournaments:   DELTA_SUMMARY.totalTournaments,
      totalWins:          DELTA_SUMMARY.totalWins,
      totalLosses:        DELTA_SUMMARY.totalLosses,
      totalPoints:        DELTA_SUMMARY.totalPoints,
      tightWins:          DELTA_SUMMARY.tightWins,
      solidWins:          DELTA_SUMMARY.solidWins,
      dominatingWins:     DELTA_SUMMARY.dominatingWins,
      firstPlaceFinishes: DELTA_SUMMARY.firstPlaceFinishes,
    });
    expect(payload).toHaveProperty('generatedAt');
    expect(payload).toHaveProperty('opponents');
    expect(payload).toHaveProperty('partners');
  });
});
