/**
 * Player ranking algorithm per the Mexicano spec.
 * Sort by totalPoints DESC, wins DESC, pointsPerGame DESC, name ASC.
 * Tied players share rank; next rank skips by group size.
 */

export function rankPlayers(players) {
  if (!players || players.length === 0) return [];

  const sorted = [...players].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.wins !== a.wins) return b.wins - a.wins;

    const ppgA = a.gamesPlayed > 0 ? a.totalPoints / a.gamesPlayed : 0;
    const ppgB = b.gamesPlayed > 0 ? b.totalPoints / b.gamesPlayed : 0;
    if (ppgB !== ppgA) return ppgB - ppgA;

    return a.name.localeCompare(b.name);
  });

  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.totalPoints === prev.totalPoints && curr.wins === prev.wins) {
        sorted[i] = { ...curr, rank: prev.rank };
      } else {
        currentRank = i + 1;
        sorted[i] = { ...curr, rank: currentRank };
      }
    } else {
      sorted[i] = { ...sorted[i], rank: currentRank };
    }
  }

  return sorted;
}
