import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import * as migration from '../scripts/supabase/import-datahub.mjs';

const { normaliseMatch } = migration;

const tempRoots = [];

function makeDataHub(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mexicano-supabase-'));
  tempRoots.push(root);
  for (const [relativePath, value] of Object.entries(files)) {
    const target = path.join(root, 'backup-data', relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2));
  }
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Supabase migration helpers', () => {
  it('normalises a match without treating embedded ELO as canonical', () => {
    const source = {
      Date: '2025-03-04',
      RoundNumber: 5,
      ScoreTeam1: 14,
      ScoreTeam2: 11,
      Team1Player1Name: 'Mattijs',
      Team1Player2Name: 'Peter',
      Team2Player1Name: 'Jeremy',
      Team2Player2Name: 'Kikke',
      Team1Player1Elo: 1110.26,
      Team1Player2Elo: 974.37,
      Team2Player1Elo: 1132.09,
      Team2Player2Elo: 1021.97,
    };

    expect(normaliseMatch(source)).toEqual({
      match_date: '2025-03-04',
      round_number: 5,
      score_team_1: 14,
      score_team_2: 11,
      players: [
        { team: 1, position: 1, player_name: 'Mattijs' },
        { team: 1, position: 2, player_name: 'Peter' },
        { team: 2, position: 1, player_name: 'Jeremy' },
        { team: 2, position: 2, player_name: 'Kikke' },
      ],
    });
  });

  it('rejects missing required match data instead of coercing it to zero', () => {
    expect(() => normaliseMatch({
      Date: '2025-03-04',
      RoundNumber: 5,
      ScoreTeam2: 11,
      Team1Player1Name: 'Mattijs',
      Team1Player2Name: 'Peter',
      Team2Player1Name: 'Jeremy',
      Team2Player2Name: 'Kikke',
    })).toThrow('ScoreTeam1');
  });

  it('inventories canonical legacy families and keeps source traceability', () => {
    const root = makeDataHub({
      'players.json': [
        { Id: 'player-1', Name: 'Mattijs', Email: 'm@example.test', ELO: 1100 },
        { Id: 'player-2', Name: 'Peter' },
        { Id: 'player-3', Name: 'Jeremy' },
        { Id: 'player-4', Name: 'Kikke' },
      ],
      'tournaments.json': [
        { date: '2025-03-04', playerCount: 4, isComplete: true },
      ],
      '2025/2025-03/2025-03-04.json': {
        backup_timestamp: '2025-03-04T08:00:00Z',
        match_date: '2025-03-04',
        matches: [{
          Date: '2025-03-04',
          RoundNumber: 1,
          ScoreTeam1: 14,
          ScoreTeam2: 11,
          Team1Player1Name: 'Mattijs',
          Team1Player2Name: 'Peter',
          Team2Player1Name: 'Jeremy',
          Team2Player2Name: 'Kikke',
        }],
      },
      '2025/2025-03/doodle_2025-03.json': [
        { name: 'Mattijs', selectedDates: ['2025-03-04'] },
      ],
      'data/attendance_manual.json': [
        { date: '2025-03-06', players: ['Peter'], note: 'Training' },
      ],
    });

    const dataset = migration.loadDataHubDataset(root);

    expect(dataset.summary).toEqual({
      player_count: 4,
      tournament_count: 1,
      match_count: 1,
      match_player_count: 4,
      doodle_availability_count: 1,
      attendance_record_count: 1,
      attendance_player_count: 1,
    });
    expect(dataset.matches[0].source_path).toBe('2025/2025-03/2025-03-04.json');
    expect(dataset.players[0]).toEqual({
      legacy_id: 'player-1',
      name: 'Mattijs',
      email: 'm@example.test',
      match_padel_id: null,
      source_path: 'players.json',
    });
  });

  it('fails locally when a canonical record references an unmapped player', () => {
    const root = makeDataHub({
      'players.json': [
        { Id: 'player-1', Name: 'Mattijs' },
        { Id: 'player-2', Name: 'Peter' },
        { Id: 'player-3', Name: 'Jeremy' },
      ],
      '2025/2025-03/2025-03-04.json': {
        matches: [{
          Date: '2025-03-04',
          RoundNumber: 1,
          ScoreTeam1: 14,
          ScoreTeam2: 11,
          Team1Player1Name: 'Mattijs',
          Team1Player2Name: 'Peter',
          Team2Player1Name: 'Jeremy',
          Team2Player2Name: 'Unknown Player',
        }],
      },
    });

    expect(() => migration.loadDataHubDataset(root))
      .toThrow('Unmapped player "Unknown Player"');
  });

  it('keeps the tournament index authoritative over stale unfinished day files', () => {
    const players = ['A', 'B', 'C', 'D'].map((Name, index) => ({
      Id: `player-${index + 1}`,
      Name,
    }));
    const staleTournament = (date) => ({
      match_date: date,
      tournament: {
        id: `stale-${date}`,
        tournamentDate: date,
        currentRoundNumber: 1,
        isCompleted: false,
        players: players.map((player, index) => ({ id: index + 1, name: player.Name })),
        rounds: [],
      },
    });
    const root = makeDataHub({
      'players.json': players,
      'tournaments.json': [{
        date: '2026-09-24',
        playerCount: 4,
        roundCount: 1,
        matchCount: 1,
        completedCount: 1,
        isComplete: true,
      }],
      '2026/2026-09/2026-09-15.json': staleTournament('2026-09-15'),
      '2026/2026-09/2026-09-22.json': staleTournament('2026-09-22'),
      '2026/2026-09/2026-09-24.json': {
        match_date: '2026-09-24',
        matches: [{
          Date: '2026-09-24',
          RoundNumber: 1,
          ScoreTeam1: 14,
          ScoreTeam2: 11,
          Team1Player1Name: 'A',
          Team1Player2Name: 'B',
          Team2Player1Name: 'C',
          Team2Player2Name: 'D',
        }],
      },
    });

    const dataset = migration.loadDataHubDataset(root);

    expect(dataset.tournaments.map((tournament) => tournament.tournament_date))
      .toEqual(['2026-09-24']);
    expect(dataset.matches).toHaveLength(1);
    expect(dataset.matches[0].match_date).toBe('2026-09-24');
  });

  it('imports one newer active tournament with its nested round matches', () => {
    const players = ['A', 'B', 'C', 'D'].map((Name, index) => ({
      Id: `player-${index + 1}`,
      Name,
    }));
    const root = makeDataHub({
      'players.json': players,
      'tournaments.json': [{
        date: '2026-09-24',
        playerCount: 4,
        roundCount: 1,
        matchCount: 1,
        completedCount: 1,
        isComplete: true,
      }],
      '2026/2026-09/2026-09-24.json': {
        match_date: '2026-09-24',
        matches: [{
          Date: '2026-09-24',
          RoundNumber: 1,
          ScoreTeam1: 14,
          ScoreTeam2: 11,
          Team1Player1Name: 'A',
          Team1Player2Name: 'B',
          Team2Player1Name: 'C',
          Team2Player2Name: 'D',
        }],
      },
      '2026/2026-09/2026-09-29.json': {
        match_date: '2026-09-29',
        tournament: {
          id: 'active-1',
          tournamentDate: '2026-09-29',
          currentRoundNumber: 1,
          isCompleted: false,
          players: players.map((player, index) => ({ id: index + 1, name: player.Name })),
          rounds: [{
            roundNumber: 1,
            matches: [{
              id: 1,
              roundNumber: 1,
              player1: { name: 'A' },
              player2: { name: 'B' },
              player3: { name: 'C' },
              player4: { name: 'D' },
              team1Score: 13,
              team2Score: 12,
            }],
          }],
        },
      },
    });

    const dataset = migration.loadDataHubDataset(root);

    expect(dataset.tournaments.map((tournament) => tournament.tournament_date))
      .toEqual(['2026-09-24', '2026-09-29']);
    expect(dataset.matches.filter((match) => match.match_date === '2026-09-29')).toEqual([
      expect.objectContaining({
        round_number: 1,
        match_order: 1,
        score_team_1: 13,
        score_team_2: 12,
      }),
    ]);
    expect(dataset.match_players.filter((row) => row.match_key.startsWith('2026-09-29:')))
      .toHaveLength(4);
  });
});
