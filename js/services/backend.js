/**
 * Backend switch facade.
 *
 * Delegates the data-access surface to the active backend chosen at call time:
 *   - Supabase  when a Supabase config (url + anonKey) is present
 *   - GitHub    otherwise (legacy fallback)
 *
 * All app modules import data functions from HERE (not github.js/supabase.js
 * directly), so switching backends is transparent. Selection is dynamic per
 * call, so setting Supabase config in Settings takes effect immediately.
 */
import { Store } from '../store.js';
import * as github from './github.js';
import * as supabase from './supabase.js';

function impl() {
  return Store.activeBackend() === 'supabase' ? supabase : github;
}

// Async delegations
export const getConfig = (...a) => impl().getConfig(...a);
export const pullForRoute = (...a) => impl().pullForRoute(...a);
export const refreshCurrentPage = (...a) => impl().refreshCurrentPage(...a);
export const ensureAllMatchesLoaded = (...a) => impl().ensureAllMatchesLoaded(...a);
export const readDayMatches = (...a) => impl().readDayMatches(...a);
export const ensureDayMatchesLoaded = (...a) => impl().ensureDayMatchesLoaded(...a);
export const pullMonthlyOverview = (...a) => impl().pullMonthlyOverview(...a);
export const pullMonthlyOverviewRaw = (...a) => impl().pullMonthlyOverviewRaw(...a);
export const pullAllOverviews = (...a) => impl().pullAllOverviews(...a);
export const fetchTournamentsIndexPublic = (...a) => impl().fetchTournamentsIndexPublic(...a);
export const fetchActiveTournamentJson = (...a) => impl().fetchActiveTournamentJson(...a);
export const pullEloHistoryForPlayerIds = (...a) => impl().pullEloHistoryForPlayerIds(...a);
export const readPlayerSummary = (...a) => impl().readPlayerSummary(...a);
export const pullDoodleMonth = (...a) => impl().pullDoodleMonth(...a);
export const pushDoodleNow = (...a) => impl().pushDoodleNow(...a);
export const addPlayerToPlayersJson = (...a) => impl().addPlayerToPlayersJson(...a);
export const testConnection = (...a) => impl().testConnection(...a);
export const flushPush = (...a) => impl().flushPush(...a);
export const pushTournamentDayFile = (...a) => impl().pushTournamentDayFile(...a);
export const updateTournamentIndexEntry = (...a) => impl().updateTournamentIndexEntry(...a);
export const removeTournamentIndexEntry = (...a) => impl().removeTournamentIndexEntry(...a);
export const deleteTournamentDayFile = (...a) => impl().deleteTournamentDayFile(...a);
export const listBackupFiles = (...a) => impl().listBackupFiles(...a);

// Sync delegations
export const getCachedEloHistoryForPlayerIds = (...a) => impl().getCachedEloHistoryForPlayerIds(...a);
export const clearSessionTTL = (...a) => impl().clearSessionTTL(...a);
export const markMatchDateDirty = (...a) => impl().markMatchDateDirty(...a);
export const getSyncStatus = (...a) => impl().getSyncStatus(...a);
export const schedulePush = (...a) => impl().schedulePush(...a);
export const cancelPendingSync = (...a) => impl().cancelPendingSync(...a);

/** Subscribe to sync-status from BOTH backends so listeners survive a switch. */
export function onSyncStatus(fn) {
  const off1 = github.onSyncStatus(fn);
  const off2 = supabase.onSyncStatus(fn);
  return () => { off1(); off2(); };
}
