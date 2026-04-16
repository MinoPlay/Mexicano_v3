/**
 * Tournament engine for Mexicano padel.
 * Manages tournament lifecycle: create → start → play rounds → complete.
 */
import { Store } from '../store.js';
import { State } from '../state.js';
import { rankPlayers } from './ranking.js';

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

export function createTournament(date, playerNames) {
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
    completedAt: null
  };

  Store.setActiveTournament(tournament);
  State.emit('tournament-changed', tournament);

  // Immediately sync to GitHub for reliable backup
  import('./github.js').then(({ flushPush }) => flushPush()).catch(() => {});

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

export function setMatchScore(tournament, roundNumber, matchId, team1Score, team2Score) {
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
  const currentRound = tournament.rounds.find(r => r.roundNumber === tournament.currentRoundNumber);
  if (!currentRound) throw new Error('No current round found');
  if (!isRoundComplete(currentRound)) throw new Error('Current round is not complete');

  currentRound.completedAt = Date.now();

  recalculateAllPlayerStats(tournament);
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
  return tournament;
}

export function completeTournament(tournament) {
  // Safety check: all matches must be scored
  const hasUnscoredMatches = tournament.rounds.some(r =>
    r.matches.some(m => !isMatchComplete(m))
  );
  if (hasUnscoredMatches) {
    throw new Error('Cannot end tournament: some matches have no scores set');
  }

  tournament.isCompleted = true;
  tournament.completedAt = Date.now();

  // Persist all matches as MatchEntities
  const allMatches = Store.getMatches();

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
        scoreTeam2: match.team2Score
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
  Store.clearActiveTournament();
  State.emit('tournament-changed', tournament);

  // Immediately sync completed tournament to GitHub
  import('./github.js').then(({ flushPush }) => flushPush()).catch(() => {});

  return tournament;
}

export function getActiveTournament() {
  return Store.getActiveTournament();
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
}
