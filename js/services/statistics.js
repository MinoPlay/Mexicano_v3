/**
 * Player statistics calculations.
 * Aggregates match data into per-player stats, opponent stats, and partnership stats.
 */
import { Store } from '../store.js';

export function involvesPlayer(match, name) {
  return [
    match.team1Player1Name,
    match.team1Player2Name,
    match.team2Player1Name,
    match.team2Player2Name
  ].includes(name);
}

export function getPlayerTeamScore(match, name) {
  if (match.team1Player1Name === name || match.team1Player2Name === name) {
    return match.scoreTeam1;
  }
  return match.scoreTeam2;
}

export function getOpponentTeamScore(match, name) {
  if (match.team1Player1Name === name || match.team1Player2Name === name) {
    return match.scoreTeam2;
  }
  return match.scoreTeam1;
}

export function getPartner(match, name) {
  if (match.team1Player1Name === name) return match.team1Player2Name;
  if (match.team1Player2Name === name) return match.team1Player1Name;
  if (match.team2Player1Name === name) return match.team2Player2Name;
  if (match.team2Player2Name === name) return match.team2Player1Name;
  return null;
}

export function getOpponents(match, name) {
  if (match.team1Player1Name === name || match.team1Player2Name === name) {
    return [match.team2Player1Name, match.team2Player2Name];
  }
  return [match.team1Player1Name, match.team1Player2Name];
}

export function calculatePlayerStatistics(matches) {
  const validMatches = matches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));

  const playerNames = new Set();
  for (const m of validMatches) {
    playerNames.add(m.team1Player1Name);
    playerNames.add(m.team1Player2Name);
    playerNames.add(m.team2Player1Name);
    playerNames.add(m.team2Player2Name);
  }

  const stats = [];
  for (const name of playerNames) {
    const playerMatches = validMatches.filter(m => involvesPlayer(m, name));
    let wins = 0, losses = 0, points = 0;
    let tightWins = 0, tightLosses = 0, solidWins = 0, dominatingWins = 0;

    for (const m of playerMatches) {
      const myScore = getPlayerTeamScore(m, name);
      const oppScore = getOpponentTeamScore(m, name);
      points += myScore;

      if (myScore > oppScore) {
        wins++;
        if (myScore === 13) tightWins++;
        else if (myScore >= 15 && myScore <= 20) solidWins++;
        else if (myScore > 20) dominatingWins++;
      } else {
        losses++;
        if (oppScore === 13 && myScore === 12) tightLosses++;
      }
    }

    const gamesPlayed = playerMatches.length;
    const average = gamesPlayed > 0 ? Math.round((points / gamesPlayed) * 100) / 100 : 0;
    const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100 * 100) / 100 : 0;

    stats.push({
      rank: 0,
      name,
      wins,
      losses,
      points,
      average,
      winRate,
      change: 0,
      tightWins,
      tightLosses,
      solidWins,
      dominatingWins
    });
  }

  stats.sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    return b.winRate - a.winRate;
  });

  let currentRank = 1;
  for (let i = 0; i < stats.length; i++) {
    if (i > 0 && stats[i].average === stats[i - 1].average && stats[i].winRate === stats[i - 1].winRate) {
      stats[i].rank = stats[i - 1].rank;
    } else {
      currentRank = i + 1;
      stats[i].rank = currentRank;
    }
  }

  return stats;
}

export function calculateOpponentStats(playerName, allMatches) {
  const validMatches = allMatches.filter(m =>
    !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0) && involvesPlayer(m, playerName)
  );

  const opponentMap = {};

  for (const m of validMatches) {
    const opponents = getOpponents(m, playerName);
    const myScore = getPlayerTeamScore(m, playerName);
    const oppScore = getOpponentTeamScore(m, playerName);
    const won = myScore > oppScore;

    for (const opp of opponents) {
      if (!opponentMap[opp]) {
        opponentMap[opp] = { opponentName: opp, gamesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      }
      const s = opponentMap[opp];
      s.gamesPlayed++;
      if (won) s.wins++; else s.losses++;
      s.pointsFor += myScore;
      s.pointsAgainst += oppScore;
    }
  }

  return Object.values(opponentMap).map(s => ({
    ...s,
    winRate: s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 100 * 100) / 100 : 0
  }));
}

export function calculatePartnershipStats(playerName, allMatches) {
  const validMatches = allMatches.filter(m =>
    !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0) && involvesPlayer(m, playerName)
  );

  const partnerMap = {};

  for (const m of validMatches) {
    const partner = getPartner(m, playerName);
    if (!partner) continue;

    if (!partnerMap[partner]) {
      partnerMap[partner] = { partnerName: partner, gamesPlayed: 0, wins: 0, losses: 0, totalPoints: 0 };
    }
    const s = partnerMap[partner];
    const myScore = getPlayerTeamScore(m, playerName);
    const oppScore = getOpponentTeamScore(m, playerName);
    s.gamesPlayed++;
    if (myScore > oppScore) s.wins++; else s.losses++;
    s.totalPoints += myScore;
  }

  return Object.values(partnerMap).map(s => ({
    partnerName: s.partnerName,
    gamesPlayed: s.gamesPlayed,
    wins: s.wins,
    losses: s.losses,
    winRate: s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 100 * 100) / 100 : 0,
    averagePointsPerGame: s.gamesPlayed > 0 ? Math.round((s.totalPoints / s.gamesPlayed) * 100) / 100 : 0
  }));
}

export function generatePlayerSummary(playerName, allMatches) {
  const validMatches = allMatches.filter(m =>
    !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0) && involvesPlayer(m, playerName)
  );

  const tournamentDates = [...new Set(validMatches.map(m => m.date))];
  let totalWins = 0, totalLosses = 0;
  let tightWins = 0, solidWins = 0, dominatingWins = 0;
  let firstPlaceFinishes = 0, secondPlaceFinishes = 0, thirdPlaceFinishes = 0;

  for (const m of validMatches) {
    const myScore = getPlayerTeamScore(m, playerName);
    const oppScore = getOpponentTeamScore(m, playerName);
    if (myScore > oppScore) {
      totalWins++;
      if (myScore === 13) tightWins++;
      else if (myScore >= 15 && myScore <= 20) solidWins++;
      else if (myScore > 20) dominatingWins++;
    } else {
      totalLosses++;
    }
  }

  // Calculate tournament placements
  for (const date of tournamentDates) {
    const tournamentMatches = allMatches.filter(m =>
      m.date === date && !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0)
    );
    const playerStats = {};

    for (const m of tournamentMatches) {
      const names = [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name];
      for (const n of names) {
        if (!playerStats[n]) playerStats[n] = { points: 0, wins: 0, gamesPlayed: 0 };
        const score = getPlayerTeamScore(m, n);
        const oppScore = getOpponentTeamScore(m, n);
        playerStats[n].points += score;
        playerStats[n].gamesPlayed++;
        if (score > oppScore) playerStats[n].wins++;
      }
    }

    const rankings = Object.entries(playerStats)
      .sort(([, a], [, b]) => b.points - a.points || b.wins - a.wins)
      .map(([name], idx) => ({ name, place: idx + 1 }));

    const myPlace = rankings.find(r => r.name === playerName);
    if (myPlace) {
      if (myPlace.place === 1) firstPlaceFinishes++;
      else if (myPlace.place === 2) secondPlaceFinishes++;
      else if (myPlace.place === 3) thirdPlaceFinishes++;
    }
  }

  return {
    playerName,
    totalTournaments: tournamentDates.length,
    totalWins,
    totalLosses,
    tightWins,
    solidWins,
    dominatingWins,
    firstPlaceFinishes,
    secondPlaceFinishes,
    thirdPlaceFinishes
  };
}
