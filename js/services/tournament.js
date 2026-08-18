/**
 * Tournament engine for Mexicano padel.
 * Manages tournament lifecycle: create → start → play rounds → complete.
 */
import { Store } from '../store.js';
import { State } from '../state.js';
import { rankPlayers } from './ranking.js';
import { calculateAllEloRankings, processMatchElo } from './elo.js';
import { logRoundResult } from './round-log.js';
import { ensureAllMatchesLoaded, cancelPendingSync, pushTournamentDayFile } from './github.js';

// ─── Helpers ───

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isMatchComplete(match) {
  return match.team1Score + match.team2Score === 25;
}

export function isRoundComplete(round) {
  return round.matches.every(m => isMatchComplete(m));
}

export function isTournamentEditable(tournament) {
  const tournamentDate = new Date(tournament.tournamentDate + 'T00:00:00');
  const now = new Date();
  const diffMs = now - tournamentDate;
  const oneDayMs = 24 * 60 * 60 * 1000;
  return diffMs <= oneDayMs;
}

// ─── Match generation ───

export function createRound1Matches(players) {
  const matches = [];
  for (let g = 0; g < players.length; g += 4) {
    const group = players.slice(g, g + 4);
    if (group.length < 4) break;
    matches.push({
      id: matches.length + 1,
      roundNumber: 1,
      player1: { ...group[0] },
      player2: { ...group[3] },
      player3: { ...group[1] },
      player4: { ...group[2] },
      team1Score: 0,
      team2Score: 0,
      completedAt: null
    });
  }
  return matches;
}

export function createMexicanoMatches(rankedPlayers) {
  const matches = [];
  for (let g = 0; g < rankedPlayers.length; g += 4) {
    const group = rankedPlayers.slice(g, g + 4);
    if (group.length < 4) break;
    // [0]+[3] vs [1]+[2]
    matches.push({
      id: matches.length + 1,
      roundNumber: 0, // caller sets actual round number
      player1: { ...group[0] },
      player2: { ...group[3] },
      player3: { ...group[1] },
      player4: { ...group[2] },
      team1Score: 0,
      team2Score: 0,
      completedAt: null
    });
  }
  return matches;
}

// ─── Tournament lifecycle ───

export function createTournament(date, playerNames, accessCode = null, courts = null) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid date format, expected yyyy-MM-dd');
  }

  if (!Array.isArray(playerNames) || ![4, 8, 12, 16].includes(playerNames.length)) {
    throw new Error('Player count must be 4, 8, 12, or 16');
  }

  const seen = new Set();
  const players = playerNames.map((name, idx) => {
    if (typeof name !== 'string') throw new Error('Player name must be a string');
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      throw new Error(`Player name must be between 1 and 50 characters: "${name}"`);
    }
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) throw new Error(`Duplicate player name: "${trimmed}"`);
    seen.add(lower);

    return {
      id: idx + 1,
      name: trimmed,
      totalPoints: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0
    };
  });

  const tournament = {
    id: generateUUID(),
    tournamentDate: date,
    players,
    rounds: [],
    currentRoundNumber: 0,
    isStarted: false,
    isCompleted: false,
    startedAt: null,
    completedAt: null,
    accessCode,
    courts: Array.isArray(courts) ? courts : null
  };

  Store.setActiveTournament(tournament);
  State.emit('tournament-changed', tournament);

  return tournament;
}

export function startTournament(tournament) {
  if (tournament.isStarted) throw new Error('Tournament already started');

  tournament.isStarted = true;
  tournament.startedAt = Date.now();
  tournament.currentRoundNumber = 1;

  const matches = createRound1Matches(tournament.players);
  tournament.rounds.push({
    roundNumber: 1,
    matches,
    completedAt: null
  });

  saveTournamentState(tournament);

  return tournament;
}

/**
 * Trigger #1: create the tournament day file (YYYY/YYYY-MM/YYYY-MM-DD.json).
 * Writes the day file directly and verifies it (with retries) so it cannot be
 * lost in a burst of other commits. Returns a promise that resolves once the
 * file is verified on GitHub. Logged on trigger and on result.
 */
export function triggerNewTournamentDayFile(tournament) {
  const date = tournament.tournamentDate;
  console.log('[tournament] trigger day file:', date);
  return import('./github.js').then(({ cancelPendingSync, pushTournamentDayFile }) => {
    cancelPendingSync();
    return pushTournamentDayFile(tournament);
  })
    .then(() => console.log('[tournament] day file created:', date))
    .catch(e => { console.warn('[tournament] day file failed:', date, e); throw e; });
}

/**
 * Trigger #2: add/update the tournaments.json index entry for a new tournament.
 * Fire-and-forget. Logged on trigger and on result.
 */
export function triggerTournamentIndexEntry(tournament) {
  const date = tournament.tournamentDate;
  console.log('[tournament] trigger tournaments.json:', date);
  import('./github.js').then(({ updateTournamentIndexEntry }) =>
    updateTournamentIndexEntry({
      date,
      playerCount: tournament.players.length,
      roundCount: 0,
      matchCount: 0,
      completedCount: 0,
      isComplete: false,
    }))
    .then(() => console.log('[tournament] tournaments.json updated:', date))
    .catch(e => console.warn('[tournament] tournaments.json failed:', date, e));
}

export function setMatchScore(tournament, roundNumber, matchId, team1Score, team2Score) {
  if (Store.getCurrentUser() && !Store.isAdministrator()) throw new Error("Tournament mutations require admin access");
  if (team1Score + team2Score !== 25) {
    throw new Error('Scores must sum to 25');
  }
  if (team1Score < 0 || team2Score < 0) {
    throw new Error('Scores must be non-negative');
  }

  const roundIdx = tournament.rounds.findIndex(r => r.roundNumber === roundNumber);
  if (roundIdx === -1) throw new Error(`Round ${roundNumber} not found`);

  const round = tournament.rounds[roundIdx];
  const match = round.matches.find(m => m.id === matchId);
  if (!match) throw new Error(`Match ${matchId} not found in round ${roundNumber}`);

  match.team1Score = team1Score;
  match.team2Score = team2Score;
  match.completedAt = Date.now();

  if (roundNumber < tournament.currentRoundNumber) {
    // Editing a previous round — cascade: delete later rounds, recalculate, regenerate one round
    tournament.rounds = tournament.rounds.filter(r => r.roundNumber <= roundNumber);
    tournament.currentRoundNumber = roundNumber;

    recalculateAllPlayerStats(tournament);

    // If this round is now complete, auto-advance
    if (isRoundComplete(round)) {
      const ranked = rankPlayers(tournament.players);
      const nextRoundNumber = roundNumber + 1;
      const nextMatches = createMexicanoMatches(ranked);
      nextMatches.forEach(m => { m.roundNumber = nextRoundNumber; });
      tournament.rounds.push({
        roundNumber: nextRoundNumber,
        matches: nextMatches,
        completedAt: null
      });
      tournament.currentRoundNumber = nextRoundNumber;
    }
  } else {
    // Current round — just recalculate
    recalculateAllPlayerStats(tournament);
  }

  saveTournamentState(tournament);
  // Suppress auto-push on individual score updates — only push on round advance / end tournament
  import('./github.js').then(({ cancelPendingSync }) => cancelPendingSync()).catch(() => {});
  return tournament;
}

export function recalculateAllPlayerStats(tournament) {
  // Reset all player stats
  for (const player of tournament.players) {
    player.totalPoints = 0;
    player.gamesPlayed = 0;
    player.wins = 0;
    player.losses = 0;
  }

  // Replay every completed match
  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (!isMatchComplete(match)) continue;

      const team1Won = match.team1Score > match.team2Score;

      // Update each player
      const updatePlayer = (playerRef, teamScore, isWinner) => {
        const player = tournament.players.find(p => p.name === playerRef.name);
        if (!player) return;
        player.totalPoints += teamScore;
        player.gamesPlayed++;
        if (isWinner) player.wins++;
        else player.losses++;
      };

      updatePlayer(match.player1, match.team1Score, team1Won);
      updatePlayer(match.player2, match.team1Score, team1Won);
      updatePlayer(match.player3, match.team2Score, !team1Won);
      updatePlayer(match.player4, match.team2Score, !team1Won);
    }
  }
}

export function startNextRound(tournament) {
  if (Store.getCurrentUser() && !Store.isAdministrator()) throw new Error("Tournament mutations require admin access");
  const currentRound = tournament.rounds.find(r => r.roundNumber === tournament.currentRoundNumber);
  if (!currentRound) throw new Error('No current round found');
  if (!isRoundComplete(currentRound)) throw new Error('Current round is not complete');

  currentRound.completedAt = Date.now();

  recalculateAllPlayerStats(tournament);

  // Log completed round results before advancing
  logRoundResult(tournament, tournament.currentRoundNumber);

  const ranked = rankPlayers(tournament.players);

  const nextRoundNumber = tournament.currentRoundNumber + 1;
  const nextMatches = createMexicanoMatches(ranked);
  nextMatches.forEach(m => { m.roundNumber = nextRoundNumber; });

  tournament.rounds.push({
    roundNumber: nextRoundNumber,
    matches: nextMatches,
    completedAt: null
  });
  tournament.currentRoundNumber = nextRoundNumber;

  saveTournamentState(tournament);
  // Push all scores for this round in one commit
  import('./github.js').then(({ cancelPendingSync, flushPush }) => {
    cancelPendingSync();
    flushPush();
  }).catch(() => {});
  return tournament;
}

export function completeTournament(tournament, onProgress) {
  if (Store.getCurrentUser() && !Store.isAdministrator()) throw new Error("Tournament mutations require admin access");
  // Idempotent guard: if already completed, just retry the push
  if (tournament.isCompleted && tournament.completedAt) {
    retryCompletedTournamentPush();
    return Promise.resolve(tournament);
  }

  tournament.isCompleted = true;
  tournament.completedAt = Date.now();

  // Log final round results
  logRoundResult(tournament, tournament.currentRoundNumber);

  return finalizeCompletedTournament(tournament, onProgress);
}

/**
 * Merge post-tournament ELO values into a players summary array.
 * Participants get elo (post) + previousElo (pre-tournament); everyone else is
 * untouched. Players missing from the summary are appended.
 */
export function applyTournamentEloToSummary(summary, playerNames, eloBefore, eloAfter) {
  const result = (summary || []).map(p => ({ ...p }));
  const byName = new Map(result.map(p => [p.name, p]));
  for (const name of playerNames || []) {
    const elo = eloAfter?.[name];
    if (elo == null) continue;
    const previousElo = eloBefore?.[name] ?? 1000;
    const existing = byName.get(name);
    if (existing) {
      existing.elo = elo;
      existing.previousElo = previousElo;
    } else {
      result.push({ id: null, name, elo, previousElo });
    }
  }
  return result;
}

async function finalizeCompletedTournament(tournament, onProgress) {
  // Optional progress reporter. Never allowed to throw into the completion flow.
  const report = (id, status, detail) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(id, status, detail); } catch { /* ignore reporter errors */ }
  };

  report('finalize', 'running');
  // The pre-tournament ELO baseline is derived by replaying the ENTIRE match
  // history from scratch (calculateAllEloRankings starts every player at 1000).
  // If the local cache is only partially loaded (lazy loading), that baseline
  // — and therefore every embedded Team*Elo value — would be wrong. Ensure the
  // full history is loaded first. Falls back to the local cache when offline.
  let allMatches;
  try {
    const loaded = await ensureAllMatchesLoaded();
    if (Array.isArray(loaded)) allMatches = loaded;
  } catch (e) {
    console.warn('[tournament] ensureAllMatchesLoaded failed; using local cache:', e);
  }
  if (!allMatches) allMatches = Store.getMatches();

  // Compute starting player ELO states from all matches BEFORE this tournament
  const { players: playerStates } = calculateAllEloRankings(allMatches);

  // Snapshot pre-tournament ELO so the refreshed summary reports a correct ±ELO
  const eloBefore = {};
  for (const [name, p] of Object.entries(playerStates)) eloBefore[name] = p.elo;

  // Process rounds in order to chain ELO correctly
  const sortedRounds = [...tournament.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  for (const round of sortedRounds) {
    for (const match of round.matches) {
      if (!isMatchComplete(match)) continue;
      const matchForElo = {
        team1Player1Name: match.player1.name,
        team1Player2Name: match.player2.name,
        team2Player1Name: match.player3.name,
        team2Player2Name: match.player4.name,
        scoreTeam1: match.team1Score,
        scoreTeam2: match.team2Score,
        date: tournament.tournamentDate,
        roundNumber: round.roundNumber,
      };
      processMatchElo(matchForElo, playerStates);
      match._eloAfter = {
        p1: playerStates[match.player1.name]?.elo,
        p2: playerStates[match.player2.name]?.elo,
        p3: playerStates[match.player3.name]?.elo,
        p4: playerStates[match.player4.name]?.elo,
      };
    }
  }

  for (const round of tournament.rounds) {
    for (let i = 0; i < round.matches.length; i++) {
      const match = round.matches[i];
      if (!isMatchComplete(match)) continue;

      const entity = {
        date: tournament.tournamentDate,
        roundNumber: round.roundNumber,
        team1Player1Name: match.player1.name,
        team1Player2Name: match.player2.name,
        team2Player1Name: match.player3.name,
        team2Player2Name: match.player4.name,
        scoreTeam1: match.team1Score,
        scoreTeam2: match.team2Score,
        ...(match._eloAfter && {
          team1Player1Elo: match._eloAfter.p1,
          team1Player2Elo: match._eloAfter.p2,
          team2Player1Elo: match._eloAfter.p3,
          team2Player2Elo: match._eloAfter.p4,
        }),
      };

      const key = `${tournament.tournamentDate}_R${round.roundNumber}M${i + 1}`;
      // Remove existing entry with same key if any
      const existingIdx = allMatches.findIndex(m =>
        m.date === entity.date &&
        m.roundNumber === entity.roundNumber &&
        m._key === key
      );
      entity._key = key;

      if (existingIdx >= 0) {
        allMatches[existingIdx] = entity;
      } else {
        allMatches.push(entity);
      }
    }
  }

  Store.setMatches(allMatches);

  // Refresh the cached players summary with the ELOs just computed, so the
  // Latest Tournament / Statistics tables show correct values immediately
  // instead of the stale cache until a manual app refresh.
  const eloAfter = {};
  for (const [name, p] of Object.entries(playerStates)) eloAfter[name] = p.elo;
  Store.setPlayersSummaryCache(applyTournamentEloToSummary(
    Store.getPlayersSummary(),
    tournament.players.map(p => p.name),
    eloBefore,
    eloAfter,
  ));

  localStorage.setItem('mexicano_completion_marker', tournament.tournamentDate);
  // Keep active_tournament in localStorage until GitHub push succeeds.
  // Mark completed so UI shows correct state, but don't remove yet.
  Store.setActiveTournament(tournament);
  State.emit('tournament-changed', tournament);

  // Compute tournament index entry before async operations so it can be used
  // in both the GitHub write and the local backup write.
  const indexPlayers = new Set();
  const indexRoundNums = new Set();
  let indexMatchCount = 0;
  let indexCompletedCount = 0;
  for (const round of tournament.rounds) {
    for (const m of round.matches) {
      if (m.player1?.name) indexPlayers.add(m.player1.name);
      if (m.player2?.name) indexPlayers.add(m.player2.name);
      if (m.player3?.name) indexPlayers.add(m.player3.name);
      if (m.player4?.name) indexPlayers.add(m.player4.name);
      indexRoundNums.add(round.roundNumber);
      indexMatchCount++;
      if (isMatchComplete(m)) indexCompletedCount++;
    }
  }
  const indexEntry = {
    date: tournament.tournamentDate,
    playerCount: indexPlayers.size,
    roundCount: indexRoundNums.size,
    matchCount: indexMatchCount,
    completedCount: indexCompletedCount,
    isComplete: indexMatchCount > 0 && indexCompletedCount === indexMatchCount,
  };

  // Update tournaments index immediately so UI reflects completion status
  const currentEntries = Store.getTournamentsIndex();
  const idx = currentEntries.findIndex(e => e.date === indexEntry.date);
  const updatedEntries = [...currentEntries];
  if (idx >= 0) {
    updatedEntries[idx] = { ...updatedEntries[idx], ...indexEntry };
  } else {
    updatedEntries.push(indexEntry);
  }
  updatedEntries.sort((a, b) => a.date.localeCompare(b.date));
  Store.setTournamentsIndex(updatedEntries);

  report('finalize', 'success');

  // Write completed tournament day + tournaments index to local dev server
  import('./local.js').then(({ writeTournamentDay, writeTournamentsIndex }) => {
    const dateMatches = allMatches.filter(m => m.date === tournament.tournamentDate);
    writeTournamentDay(tournament.tournamentDate, dateMatches)
      .catch(e => console.warn('[local] tournament write failed:', e));

    const currentEntries = Store.getTournamentsIndex();
    const idx = currentEntries.findIndex(e => e.date === indexEntry.date);
    const updatedEntries = [...currentEntries];
    if (idx >= 0) {
      updatedEntries[idx] = { ...updatedEntries[idx], ...indexEntry };
    } else {
      updatedEntries.push(indexEntry);
    }
    updatedEntries.sort((a, b) => a.date.localeCompare(b.date));
    writeTournamentsIndex(updatedEntries)
      .catch(e => console.warn('[local] tournaments index write failed:', e));
  }).catch(() => {});

  // Immediately sync completed tournament to GitHub. When a progress reporter is
  // supplied (finish-tournament dialog), the caller awaits this promise so the
  // dialog can show live per-step status; otherwise it stays fire-and-forget.
  report('push', 'pending');
  report('index', 'pending');
  const syncPromise = import('./github.js').then(async ({ flushPush, markMatchDateDirty, updateTournamentIndexEntry }) => {
    markMatchDateDirty(tournament.tournamentDate);

    // Serialize commits: day file first, then index — concurrent writes to the
    // same branch cause GitHub 409 fast-forward conflicts.
    report('push', 'running');
    try {
      await flushPush();
      report('push', 'success');
    } catch (e) {
      report('push', 'error', e);
      console.warn('[tournament] post-complete push failed:', e);
      // Surface in the Logs tab: this is the silent, mobile-only failure mode
      // where the tournament looks finished locally but never reached GitHub.
      import('./round-log.js')
        .then(({ logError }) => logError('post-complete GitHub push', e))
        .catch(() => {});
      // Push failed — local data preserved. Will retry on reconnect.
      throw e;
    }

    report('index', 'running');
    try {
      await updateTournamentIndexEntry(indexEntry);
      report('index', 'success');
    } catch (e) {
      report('index', 'error', e);
      console.warn('[tournament] post-complete index update failed:', e);
      import('./round-log.js')
        .then(({ logError }) => logError('post-complete tournaments index update', e))
        .catch(() => {});
      throw e;
    }

    // Push succeeded — safe to clear local tournament data
    Store.clearActiveTournament();
    localStorage.removeItem('mexicano_completion_marker');
  }).catch((e) => {
    // Module-load or push/index failure already reported above; report here only
    // for the module-load case where no step-level report fired.
    report('push', 'error', e);
    import('./round-log.js')
      .then(({ logError }) => logError('post-complete GitHub push (module load)', e))
      .catch(() => {});
  });

  // Only make callers wait for the sync when they asked for progress. Existing
  // callers keep the original fire-and-forget timing.
  if (typeof onProgress === 'function') {
    await syncPromise;
  }

  return tournament;
}

/**
 * Retry pushing a completed tournament that failed to sync to GitHub.
 * Called on reconnect or when completeTournament is called again on
 * an already-completed tournament.
 */
export function retryCompletedTournamentPush() {
  const tournament = Store.getActiveTournament();
  if (!tournament || !tournament.isCompleted) return;

  const marker = localStorage.getItem('mexicano_completion_marker');
  if (!marker) return; // no pending push

  console.log('[tournament] retrying push for completed tournament:', marker);

  import('./github.js').then(({ flushPush, markMatchDateDirty, updateTournamentIndexEntry }) => {
    markMatchDateDirty(tournament.tournamentDate);

    const indexPlayers = new Set();
    const indexRoundNums = new Set();
    let indexMatchCount = 0;
    let indexCompletedCount = 0;
    for (const round of tournament.rounds || []) {
      for (const m of round.matches || []) {
        if (m.player1?.name) indexPlayers.add(m.player1.name);
        if (m.player2?.name) indexPlayers.add(m.player2.name);
        if (m.player3?.name) indexPlayers.add(m.player3.name);
        if (m.player4?.name) indexPlayers.add(m.player4.name);
        indexRoundNums.add(round.roundNumber);
        indexMatchCount++;
        if (isMatchComplete(m)) indexCompletedCount++;
      }
    }
    const indexEntry = {
      date: tournament.tournamentDate,
      playerCount: indexPlayers.size,
      roundCount: indexRoundNums.size,
      matchCount: indexMatchCount,
      completedCount: indexCompletedCount,
      isComplete: indexMatchCount > 0 && indexCompletedCount === indexMatchCount,
    };

    Promise.resolve(flushPush())
      .then(async () => {
        await updateTournamentIndexEntry(indexEntry).catch(() => {});
        Store.clearActiveTournament();
        localStorage.removeItem('mexicano_completion_marker');
        console.log('[tournament] retry push succeeded, local data cleared');
      })
      .catch(e => {
        console.warn('[tournament] retry push failed, will try again on next reconnect:', e);
        import('./round-log.js')
          .then(({ logError }) => logError('retry GitHub push', e))
          .catch(() => {});
      });
  }).catch(() => {});
}

// Auto-retry on network reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const marker = localStorage.getItem('mexicano_completion_marker');
    if (marker) {
      console.log('[tournament] network restored, retrying pending push...');
      retryCompletedTournamentPush();
    }
  });
}

export function getActiveTournament() {
  return Store.getActiveTournament();
}

/**
 * Pure helper: mark a player as having confirmed attendance.
 * Case-insensitive name match. Mutates the passed tournament in place.
 * Returns { tournament, changed }. `changed` is false when the name is not a
 * player or was already confirmed.
 */
export function markPlayerConfirmed(tournament, name) {
  if (!tournament || !Array.isArray(tournament.players) || !name) {
    return { tournament, changed: false };
  }
  const target = String(name).trim().toLowerCase();
  const player = tournament.players.find(
    p => String(p.name || '').trim().toLowerCase() === target
  );
  if (!player || player.confirmed) {
    return { tournament, changed: false };
  }
  player.confirmed = true;
  return { tournament, changed: true };
}

/**
 * Confirm attendance for `playerName` on the active tournament.
 * Self-confirmation is allowed for EVERYONE (not admin-gated). Persists via
 * saveTournamentState (which marks the day file dirty for GitHub push).
 * Returns true when a change was made, false otherwise (no active tournament,
 * name not a player, or already confirmed).
 */
export function confirmAttendance(playerName) {
  const tournament = Store.getActiveTournament();
  if (!tournament || tournament.isCompleted) return false;
  const { changed } = markPlayerConfirmed(tournament, playerName);
  if (!changed) return false;
  saveTournamentState(tournament);
  return true;
}

/**
 * Confirm attendance AND persist it immediately to GitHub (verified, retried)
 * instead of relying on the debounced auto-push, which can be lost if the app
 * is closed or the route changes within the debounce window. Resolves only
 * after the day file is verified on GitHub, so callers can fire the Telegram
 * alert strictly after the backend is actually updated. Rejects if the push
 * fails so the caller can withhold the alert.
 *
 * @param {string} playerName
 * @returns {Promise<{changed: boolean, pushed: boolean}>}
 */
export async function confirmAttendanceAndPush(playerName) {
  const changed = confirmAttendance(playerName);
  if (!changed) return { changed: false, pushed: false };
  const tournament = Store.getActiveTournament();
  cancelPendingSync();
  await pushTournamentDayFile(tournament);
  return { changed: true, pushed: true };
}

export function loadTournamentByDate(date) {
  const allMatches = Store.getMatches();
  const dateMatches = allMatches
    .filter(m => m.date === date)
    .sort((a, b) => a.roundNumber - b.roundNumber);

  if (dateMatches.length === 0) return null;

  // Collect unique player names
  const playerNamesSet = new Set();
  for (const m of dateMatches) {
    playerNamesSet.add(m.team1Player1Name);
    playerNamesSet.add(m.team1Player2Name);
    playerNamesSet.add(m.team2Player1Name);
    playerNamesSet.add(m.team2Player2Name);
  }

  const players = [...playerNamesSet].map((name, idx) => ({
    id: idx + 1,
    name,
    totalPoints: 0,
    gamesPlayed: 0,
    wins: 0,
    losses: 0
  }));

  // Group matches by round
  const roundMap = {};
  for (const m of dateMatches) {
    if (!roundMap[m.roundNumber]) roundMap[m.roundNumber] = [];
    roundMap[m.roundNumber].push(m);
  }

  const rounds = Object.entries(roundMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([rn, matches]) => ({
      roundNumber: Number(rn),
      matches: matches.map((m, idx) => ({
        id: idx + 1,
        roundNumber: Number(rn),
        player1: { name: m.team1Player1Name },
        player2: { name: m.team1Player2Name },
        player3: { name: m.team2Player1Name },
        player4: { name: m.team2Player2Name },
        team1Score: m.scoreTeam1,
        team2Score: m.scoreTeam2,
        completedAt: (m.scoreTeam1 + m.scoreTeam2 === 25) ? 1 : null
      })),
      completedAt: null
    }));

  // Mark rounds as complete
  for (const round of rounds) {
    if (isRoundComplete(round)) round.completedAt = 1;
  }

  const maxRound = Math.max(...rounds.map(r => r.roundNumber));

  const tournament = {
    id: generateUUID(),
    tournamentDate: date,
    players,
    rounds,
    currentRoundNumber: maxRound,
    isStarted: true,
    isCompleted: true,
    startedAt: null,
    completedAt: null
  };

  recalculateAllPlayerStats(tournament);
  return tournament;
}

export function getLatestCompleteTournamentDate() {
  const index = Store.getTournamentsIndex();
  if (index.length > 0) {
    const complete = index.filter(e => e.isComplete).sort((a, b) => b.date.localeCompare(a.date));
    if (complete.length > 0) return complete[0].date;
  }
  // Fallback: no index data yet — exclude active (in-progress) tournament date
  // so we don't show an incomplete tournament on first render
  const active = Store.getActiveTournament();
  const activeDate = (active && !active.isCompleted) ? active.tournamentDate : null;
  const all = getAllTournamentDates().filter(d => d !== activeDate);
  return all.length > 0 ? all[0] : null;
}

export function getAllTournamentDates() {
  // Prefer pre-computed dates from pullAll summary
  const storedDates = Store.getTournamentDates();
  if (storedDates.length > 0) {
    return [...storedDates].sort((a, b) => b.localeCompare(a));
  }
  // Fall back to deriving from locally cached matches
  const allMatches = Store.getMatches();
  const dates = [...new Set(allMatches.map(m => m.date))];
  return dates.sort((a, b) => b.localeCompare(a));
}

export function saveTournamentState(tournament) {
  Store.setActiveTournament(tournament);

  // Also persist completed matches as MatchEntities
  const allMatches = Store.getMatches();

  // Remove existing matches for this tournament date
  const otherMatches = allMatches.filter(m => m.date !== tournament.tournamentDate);

  for (const round of tournament.rounds) {
    for (let i = 0; i < round.matches.length; i++) {
      const match = round.matches[i];
      if (!isMatchComplete(match)) continue;

      const entity = {
        date: tournament.tournamentDate,
        roundNumber: round.roundNumber,
        team1Player1Name: match.player1.name,
        team1Player2Name: match.player2.name,
        team2Player1Name: match.player3.name,
        team2Player2Name: match.player4.name,
        scoreTeam1: match.team1Score,
        scoreTeam2: match.team2Score,
        _key: `${tournament.tournamentDate}_R${round.roundNumber}M${i + 1}`
      };

      otherMatches.push(entity);
    }
  }

  Store.setMatches(otherMatches);
  State.emit('tournament-changed', tournament);

  // Mark this date dirty so only its match file is pushed
  import('./github.js').then(({ markMatchDateDirty }) => {
    markMatchDateDirty(tournament.tournamentDate);
  }).catch(() => {});
}

export async function deleteTournament(date) {
  if (Store.getCurrentUser() && !Store.isAdministrator()) throw new Error("Tournament mutations require admin access");

  const index = Store.getTournamentsIndex();
  const entry = index.find(e => e.date === date);
  const active = Store.getActiveTournament();
  const isActiveDate = !!(active && active.tournamentDate === date);

  const completed = (entry && entry.isComplete) || (isActiveDate && active.isCompleted);
  if (completed) throw new Error('Cannot delete a completed tournament');

  // Drop the entry from the in-memory index
  Store.setTournamentsIndex(index.filter(e => e.date !== date));

  // Purge match entities for this date
  Store.setMatches(Store.getMatches().filter(m => m.date !== date));

  // Clear active tournament if it is the one being deleted
  if (isActiveDate) Store.clearActiveTournament();

  State.emit('tournament-changed', null);

  // Remove remote copies: tournaments.json entry + the generated date file
  try {
    const { removeTournamentIndexEntry, deleteTournamentDayFile, cancelPendingSync } = await import('./github.js');
    cancelPendingSync();
    await removeTournamentIndexEntry(date);
    await deleteTournamentDayFile(date);
  } catch (e) {
    console.warn('[tournament] failed to delete remote tournament:', e);
  }

  return true;
}

export function updateAccessCode(date, code) {
  if (Store.getCurrentUser() && !Store.isAdministrator()) throw new Error("Tournament mutations require admin access");
  const tournament = Store.getActiveTournament();
  if (!tournament || tournament.tournamentDate !== date) {
    throw new Error('No active tournament for date: ' + date);
  }

  tournament.accessCode = code;
  Store.setActiveTournament(tournament);
  State.emit('tournament-changed', tournament);

  // Push to GitHub with same pattern as other mutations
  import('./github.js').then(({ markMatchDateDirty, flushPush }) => {
    markMatchDateDirty(date);
    flushPush();
  }).catch(() => {});
}

