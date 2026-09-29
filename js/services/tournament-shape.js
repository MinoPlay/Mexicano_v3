/**
 * Pure tournament-shape helpers.
 *
 * Lives in its own module so `services/supabase.js` can rebuild the in-app
 * tournament object from Supabase rows without importing `services/tournament.js`
 * (which imports `services/backend.js`, which imports `services/supabase.js`).
 */

/** A Mexicano match is played to a fixed 25 points across both teams. */
export function isMatchComplete(match) {
  return match.team1Score + match.team2Score === 25;
}

export function isRoundComplete(round) {
  return round.matches.every(m => isMatchComplete(m));
}

/** Recompute every player's aggregate stats by replaying the completed matches. */
export function recalculateAllPlayerStats(tournament) {
  for (const player of tournament.players) {
    player.totalPoints = 0;
    player.gamesPlayed = 0;
    player.wins = 0;
    player.losses = 0;
  }

  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (!isMatchComplete(match)) continue;

      const team1Won = match.team1Score > match.team2Score;

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

function slotName(slots, team, position, playersById) {
  const slot = slots.find(row => row.team === team && row.position === position);
  return playersById.get(slot?.player_id)?.name || '';
}

/**
 * Rebuild the in-app tournament object from canonical Supabase rows.
 *
 * @param {object}  args
 * @param {object}  args.tournament       - a `tournaments` row
 * @param {Array}   args.tournamentPlayers- `tournament_players` rows for it
 * @param {Array}   args.matches          - `matches` rows for it
 * @param {Array}   args.matchPlayers     - `match_players` rows for those matches
 * @param {Map}     args.playersById      - player id → { id, name }
 * @returns {object|null}
 */
export function buildTournamentFromRows({
  tournament,
  tournamentPlayers = [],
  matches = [],
  matchPlayers = [],
  playersById,
}) {
  if (!tournament) return null;

  const players = [...tournamentPlayers]
    .sort((a, b) => (a.seed_position ?? 0) - (b.seed_position ?? 0))
    .map((row, index) => ({
      id: row.seed_position ?? index + 1,
      name: playersById.get(row.player_id)?.name || '',
      totalPoints: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ...(row.confirmed ? { confirmed: true } : {}),
    }))
    .filter(player => player.name);

  const slotsByMatch = new Map();
  for (const slot of matchPlayers) {
    const slots = slotsByMatch.get(slot.match_id) || [];
    slots.push(slot);
    slotsByMatch.set(slot.match_id, slots);
  }

  const byRound = new Map();
  const ordered = [...matches].sort(
    (a, b) => a.round_number - b.round_number || a.match_order - b.match_order,
  );
  for (const match of ordered) {
    const slots = slotsByMatch.get(match.id) || [];
    const byName = name => players.find(p => p.name === name) || { name };
    const roundMatches = byRound.get(match.round_number) || [];
    roundMatches.push({
      id: match.match_order,
      roundNumber: match.round_number,
      player1: { ...byName(slotName(slots, 1, 1, playersById)) },
      player2: { ...byName(slotName(slots, 1, 2, playersById)) },
      player3: { ...byName(slotName(slots, 2, 1, playersById)) },
      player4: { ...byName(slotName(slots, 2, 2, playersById)) },
      team1Score: match.score_team_1 ?? 0,
      team2Score: match.score_team_2 ?? 0,
      completedAt: match.completed_at ? Date.parse(match.completed_at) : null,
    });
    byRound.set(match.round_number, roundMatches);
  }

  const rounds = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([roundNumber, roundMatches]) => ({
      roundNumber,
      matches: roundMatches,
      completedAt: null,
    }));

  const isCompleted = tournament.is_complete === true || tournament.status === 'completed';
  const built = {
    id: tournament.legacy_id || tournament.id,
    tournamentDate: tournament.tournament_date,
    players,
    rounds,
    currentRoundNumber: tournament.current_round_number
      ?? (rounds.length ? rounds[rounds.length - 1].roundNumber : 0),
    isStarted: rounds.length > 0 || tournament.status === 'active' || isCompleted,
    isCompleted,
    startedAt: null,
    completedAt: tournament.completed_at ? Date.parse(tournament.completed_at) : null,
    accessCode: tournament.access_code ?? null,
    courts: Array.isArray(tournament.courts) ? tournament.courts : null,
  };

  recalculateAllPlayerStats(built);
  return built;
}
