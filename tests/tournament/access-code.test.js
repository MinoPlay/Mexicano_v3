/**
 * Tournament access code tests.
 * Verifies that accessCode property is created, persisted, and editable.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mock dynamic imports used by store.js and tournament.js ───

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
}));

// ─── In-memory localStorage stub ───

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}

const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

// ─── Imports after mocks/stubs ───

import {
  createTournament,
  updateAccessCode,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

// ─── Helpers ───

const DATE = '2025-06-01';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

// ─── Reset state between tests ───

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
});

// ─── Tests ───

describe('tournament accessCode', () => {
  it('createTournament with accessCode sets accessCode property', () => {
    const accessCode = 'ABC-123';
    const t = createTournament(DATE, PLAYERS_4, accessCode);

    expect(t.accessCode).toBe('ABC-123');
  });

  it('createTournament with accessCode persists in Store', () => {
    const accessCode = 'ABC-123';
    const t = createTournament(DATE, PLAYERS_4, accessCode);

    const stored = Store.getActiveTournament();
    expect(stored.accessCode).toBe('ABC-123');
  });

  it('createTournament without accessCode sets accessCode to null', () => {
    const t = createTournament(DATE, PLAYERS_4);

    expect(t.accessCode).toBe(null);
  });

  it('createTournament without accessCode persists accessCode as null in Store', () => {
    const t = createTournament(DATE, PLAYERS_4);

    const stored = Store.getActiveTournament();
    expect(stored.accessCode).toBe(null);
  });

  it('updateAccessCode changes tournament accessCode in-memory', () => {
    const t = createTournament(DATE, PLAYERS_4, 'ABC-123');
    
    updateAccessCode(DATE, 'XYZ-789');
    
    const stored = Store.getActiveTournament();
    expect(stored.accessCode).toBe('XYZ-789');
  });

  it('updateAccessCode persists to Store', () => {
    const t = createTournament(DATE, PLAYERS_4, 'ABC-123');
    
    updateAccessCode(DATE, 'XYZ-789');
    
    const stored = Store.getActiveTournament();
    expect(stored.accessCode).toBe('XYZ-789');
  });

  it('updateAccessCode triggers markMatchDateDirty and flushPush', async () => {
    const github = await import('../../js/services/github.js');
    
    const t = createTournament(DATE, PLAYERS_4, 'ABC-123');
    
    updateAccessCode(DATE, 'XYZ-789');
    
    // markMatchDateDirty and flushPush should be called
    expect(github.markMatchDateDirty).toHaveBeenCalledWith(DATE);
    expect(github.flushPush).toHaveBeenCalled();
  });
});
