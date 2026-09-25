import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { processMatchElo } from '../../js/services/elo.js';
import { loadDataHubDataset } from './import-datahub.mjs';

const DEFAULT_DATAHUB_ROOT = path.resolve(process.cwd(), '..', 'DataHub_Mexicano', 'mexicano_v3');
const DEFAULT_VERSION = 'mexicano-v1';
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

function toAppMatches(dataset) {
  const playersByMatch = new Map();
  for (const participant of dataset.match_players || []) {
    const participants = playersByMatch.get(participant.match_key) || [];
    participants.push(participant);
    playersByMatch.set(participant.match_key, participants);
  }

  return (dataset.matches || []).map((match) => {
    const participants = playersByMatch.get(match.match_key) || [];
    const getName = (team, position) =>
      participants.find((player) => player.team === team && player.position === position)?.player_name;
    if (participants.length !== 4) {
      throw new Error(`Match ${match.match_key} must have exactly four player slots`);
    }
    return {
      date: match.match_date,
      roundNumber: match.round_number,
      matchOrder: match.match_order,
      scoreTeam1: match.score_team_1,
      scoreTeam2: match.score_team_2,
      team1Player1Name: getName(1, 1),
      team1Player2Name: getName(1, 2),
      team2Player1Name: getName(2, 1),
      team2Player2Name: getName(2, 2),
    };
  });
}

function matchSort(a, b) {
  return a.date.localeCompare(b.date)
    || a.roundNumber - b.roundNumber
    || a.matchOrder - b.matchOrder;
}

export function buildEloProjection(dataset, calculationVersion = DEFAULT_VERSION) {
  const matches = toAppMatches(dataset)
    .filter((match) => !(match.scoreTeam1 === 0 && match.scoreTeam2 === 0))
    .sort(matchSort);

  const players = {};
  const snapshots = [];
  let sourceMatchCount = 0;

  const matchesByDate = new Map();
  for (const match of matches) {
    const dayMatches = matchesByDate.get(match.date) || [];
    dayMatches.push(match);
    matchesByDate.set(match.date, dayMatches);
  }

  for (const [date, dayMatches] of [...matchesByDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const participantNames = [...new Set(dayMatches.flatMap((match) => [
      match.team1Player1Name,
      match.team1Player2Name,
      match.team2Player1Name,
      match.team2Player2Name,
    ]))].sort();
    const previous = Object.fromEntries(
      participantNames.map((name) => [name, players[name]?.elo ?? 1000]),
    );

    for (const match of dayMatches) {
      processMatchElo(match, players);
      sourceMatchCount += 1;
    }

    for (const playerName of participantNames) {
      snapshots.push({
        tournament_date: date,
        player_name: playerName,
        previous_elo: previous[playerName],
        elo: players[playerName].elo,
        source_match_count: sourceMatchCount,
      });
    }
  }

  return {
    calculation_version: calculationVersion,
    source_match_count: sourceMatchCount,
    snapshots,
  };
}

export async function replaceSupabaseEloProjection(projection, options = {}) {
  const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL;
  const apiKey = options.apiKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryRun = options.dryRun === true;
  if (dryRun) return projection;
  if (!supabaseUrl || !apiKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/replace_elo_projection`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payload: projection }),
  });
  if (!response.ok) {
    throw new Error(`Supabase ELO projection failed (${response.status}): ${await response.text()}`);
  }
  return await response.json();
}

async function main() {
  const dataset = loadDataHubDataset(process.env.DATAHUB_ROOT || DEFAULT_DATAHUB_ROOT);
  const projection = buildEloProjection(dataset, process.env.ELO_CALCULATION_VERSION || DEFAULT_VERSION);
  await replaceSupabaseEloProjection(projection, {
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(JSON.stringify({
    calculation_version: projection.calculation_version,
    source_match_count: projection.source_match_count,
    snapshot_count: projection.snapshots.length,
    dry_run: process.argv.includes('--dry-run'),
  }, null, 2));
}

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
