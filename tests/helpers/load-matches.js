/**
 * Helper: load the frozen ELO parity match set.
 *
 * tests/fixtures/elo-matches.json is a snapshot of Supabase matches up to and
 * including 2026-05-12 (6452 matches, 66 players) — the same cutoff the C#
 * source-of-truth used to generate elo-expected.json and
 * monthly-elo-expected.json. Rows are
 * [date, roundNumber, scoreTeam1, scoreTeam2, t1p1, t1p2, t2p1, t2p2].
 * Do not regenerate without regenerating the expected fixtures for the same cutoff.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FIXTURE = resolve('tests/fixtures/elo-matches.json');

export function loadAllMatches(fixturePath = FIXTURE) {
  return JSON.parse(readFileSync(fixturePath, 'utf8')).map(
    ([date, roundNumber, scoreTeam1, scoreTeam2, team1Player1Name, team1Player2Name, team2Player1Name, team2Player2Name]) => ({
      date,
      roundNumber,
      scoreTeam1,
      scoreTeam2,
      team1Player1Name,
      team1Player2Name,
      team2Player1Name,
      team2Player2Name,
    }),
  );
}

export function loadMatchesForDate(date, fixturePath = FIXTURE) {
  return loadAllMatches(fixturePath).filter(m => m.date === date);
}
