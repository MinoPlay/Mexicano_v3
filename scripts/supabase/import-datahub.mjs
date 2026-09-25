import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATAHUB_ROOT = path.resolve(process.cwd(), '..', 'DataHub_Mexicano', 'mexicano_v3');
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

function required(source, legacyKey, canonicalKey = legacyKey) {
  const value = source[legacyKey] ?? source[canonicalKey];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required match field: ${legacyKey}`);
  }
  return value;
}

function requiredNumber(source, legacyKey, canonicalKey = legacyKey) {
  const value = required(source, legacyKey, canonicalKey);
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric match field: ${legacyKey}`);
  }
  return number;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseName(value, field) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error(`Missing required match field: ${field}`);
  return name;
}

export function normaliseMatch(source = {}) {
  return {
    match_date: String(required(source, 'Date', 'date')).slice(0, 10),
    round_number: requiredNumber(source, 'RoundNumber', 'roundNumber'),
    score_team_1: requiredNumber(source, 'ScoreTeam1', 'scoreTeam1'),
    score_team_2: requiredNumber(source, 'ScoreTeam2', 'scoreTeam2'),
    players: [
      {
        team: 1,
        position: 1,
        player_name: normaliseName(source.Team1Player1Name ?? source.team1Player1Name, 'Team1Player1Name'),
      },
      {
        team: 1,
        position: 2,
        player_name: normaliseName(source.Team1Player2Name ?? source.team1Player2Name, 'Team1Player2Name'),
      },
      {
        team: 2,
        position: 1,
        player_name: normaliseName(source.Team2Player1Name ?? source.team2Player1Name, 'Team2Player1Name'),
      },
      {
        team: 2,
        position: 2,
        player_name: normaliseName(source.Team2Player2Name ?? source.team2Player2Name, 'Team2Player2Name'),
      },
    ],
  };
}

function backupRoot(rootDir) {
  return path.join(rootDir || process.env.DATAHUB_ROOT || DEFAULT_DATAHUB_ROOT, 'backup-data');
}

function toSourcePath(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
}

export function collectMatchFiles(rootDir) {
  const root = backupRoot(rootDir);
  if (!fs.existsSync(root)) return [];

  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files.sort();
}

function loadPlayers(root) {
  const filePath = path.join(root, 'players.json');
  if (!fs.existsSync(filePath)) return [];
  const payload = readJson(filePath);
  if (!Array.isArray(payload)) throw new Error('players.json must contain an array');

  return payload.map((player, index) => {
    const name = String(player.Name ?? player.name ?? '').trim();
    if (!name) throw new Error(`players.json entry ${index} has no name`);
    return {
      legacy_id: player.Id ?? player.id ?? null,
      name,
      email: player.Email ?? player.email ?? null,
      match_padel_id: nullableNumber(player.MatchPadelId ?? player.matchPadelId),
      source_path: 'players.json',
    };
  });
}

function loadTournamentIndex(root) {
  const filePath = path.join(root, 'tournaments.json');
  if (!fs.existsSync(filePath)) return [];
  const payload = readJson(filePath);
  if (!Array.isArray(payload)) throw new Error('tournaments.json must contain an array');
  return payload.map((entry) => ({
    tournament_date: String(entry.date ?? entry.tournamentDate ?? '').slice(0, 10),
    player_count: nullableNumber(entry.playerCount),
    round_count: nullableNumber(entry.roundCount),
    match_count: nullableNumber(entry.matchCount),
    completed_count: nullableNumber(entry.completedCount),
    is_complete: entry.isComplete === true,
    source_path: 'tournaments.json',
  })).filter((entry) => entry.tournament_date);
}

function normaliseTournament(payload, date, sourcePath) {
  const tournament = payload?.tournament;
  if (!tournament) {
    return {
      tournament_date: date,
      legacy_id: null,
      current_round_number: null,
      status: null,
      is_complete: null,
      completed_at: null,
      source_path: sourcePath,
    };
  }
  return {
    tournament_date: String(tournament.tournamentDate ?? date).slice(0, 10),
    legacy_id: tournament.id ?? null,
    current_round_number: nullableNumber(tournament.currentRoundNumber),
    status: tournament.status ?? (tournament.isCompleted === true ? 'completed' : 'active'),
    is_complete: tournament.isComplete === true,
    completed_at: tournament.completedAt ?? null,
    source_path: sourcePath,
  };
}

function normaliseTournamentPlayers(payload, date, sourcePath) {
  const players = Array.isArray(payload?.tournament?.players) ? payload.tournament.players : [];
  return players.map((player, index) => ({
    tournament_date: date,
    player_name: normaliseName(player.name, `tournament.players[${index}].name`),
    seed_position: nullableNumber(player.id) ?? index + 1,
    confirmed: player.confirmed === true,
    source_path: sourcePath,
  }));
}

function nestedTournamentMatches(payload, date) {
  const rounds = Array.isArray(payload?.tournament?.rounds) ? payload.tournament.rounds : [];
  return rounds.flatMap((round) =>
    (Array.isArray(round.matches) ? round.matches : []).map((match, index) => ({
      source: {
        Date: date,
        RoundNumber: match.roundNumber ?? round.roundNumber,
        ScoreTeam1: match.team1Score,
        ScoreTeam2: match.team2Score,
        Team1Player1Name: match.player1?.name,
        Team1Player2Name: match.player2?.name,
        Team2Player1Name: match.player3?.name,
        Team2Player2Name: match.player4?.name,
      },
      matchOrder: index + 1,
    })));
}

function loadMatchData(root, tournamentIndex = []) {
  const tournaments = [];
  const tournamentPlayers = [];
  const matches = [];
  const matchPlayers = [];

  const files = collectMatchFiles(path.dirname(root)).map((filePath) => {
    const sourcePath = toSourcePath(root, filePath);
    const payload = readJson(filePath);
    const date = String(payload.match_date ?? path.basename(filePath, '.json')).slice(0, 10);
    return { filePath, sourcePath, payload, date };
  });

  const indexedDates = new Set(tournamentIndex.map((entry) => entry.tournament_date));
  const historicalDates = indexedDates.size > 0
    ? indexedDates
    : new Set(files.filter(({ payload }) => Array.isArray(payload.matches)).map(({ date }) => date));
  const latestHistoricalDate = [...historicalDates].sort().at(-1) || '';
  const activeDate = files
    .filter(({ payload, date }) =>
      payload?.tournament
      && payload.tournament.isCompleted !== true
      && date > latestHistoricalDate)
    .map(({ date }) => date)
    .sort()
    .at(-1);

  for (const { sourcePath, payload, date } of files) {
    if (!historicalDates.has(date) && date !== activeDate) continue;

    tournaments.push(normaliseTournament(payload, date, sourcePath));
    tournamentPlayers.push(...normaliseTournamentPlayers(payload, date, sourcePath));

    const sourceMatches = Array.isArray(payload.matches)
      ? payload.matches.map((source, fileIndex) => ({ source, matchOrder: fileIndex + 1 }))
      : nestedTournamentMatches(payload, date);
    sourceMatches.forEach(({ source, matchOrder }, fileIndex) => {
      let match;
      try {
        match = normaliseMatch(source);
      } catch (error) {
        throw new Error(`${sourcePath} match ${fileIndex + 1}: ${error.message}`);
      }
      const matchKey = `${match.match_date}:${match.round_number}:${matchOrder}`;
      matches.push({
        match_key: matchKey,
        match_date: match.match_date,
        round_number: match.round_number,
        match_order: matchOrder,
        score_team_1: match.score_team_1,
        score_team_2: match.score_team_2,
        source_path: sourcePath,
      });
      matchPlayers.push(...match.players.map((player) => ({
        match_key: matchKey,
        ...player,
        source_path: sourcePath,
      })));
    });
  }

  return { tournaments, tournamentPlayers, matches, matchPlayers };
}

function loadDoodles(root) {
  const availability = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !/^doodle_\d{4}-\d{2}\.json$/.test(entry.name)) continue;

      const sourcePath = toSourcePath(root, fullPath);
      const payload = readJson(fullPath);
      if (!Array.isArray(payload)) throw new Error(`${sourcePath} must contain an array`);
      for (const player of payload) {
        const playerName = normaliseName(player.name, `${sourcePath}.name`);
        const dates = Array.isArray(player.selectedDates) ? player.selectedDates : [];
        for (const date of dates) {
          availability.push({
            availability_date: String(date).slice(0, 10),
            player_name: playerName,
            source_path: sourcePath,
          });
        }
      }
    }
  };
  walk(root);
  return availability;
}

function loadAttendance(root) {
  const filePath = path.join(root, 'data', 'attendance_manual.json');
  if (!fs.existsSync(filePath)) return { records: [], players: [] };
  const payload = readJson(filePath);
  if (!Array.isArray(payload)) throw new Error('data/attendance_manual.json must contain an array');

  const records = [];
  const players = [];
  for (const entry of payload) {
    const date = String(entry.date ?? '').slice(0, 10);
    if (!date) throw new Error('Manual attendance entry has no date');
    records.push({
      attendance_date: date,
      kind: 'manual',
      note: entry.note ?? null,
      source_path: 'data/attendance_manual.json',
    });
    for (const playerName of Array.isArray(entry.players) ? entry.players : []) {
      players.push({
        attendance_date: date,
        player_name: normaliseName(playerName, 'attendance player'),
        source_path: 'data/attendance_manual.json',
      });
    }
  }
  return { records, players };
}

function loadAliases() {
  const aliasPath = process.env.PLAYER_ALIASES_PATH
    || path.resolve(process.cwd(), 'scripts', 'supabase', 'player-aliases.json');
  if (!fs.existsSync(aliasPath)) return [];
  const payload = readJson(aliasPath);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('player-aliases.json must contain an object of alias to canonical name');
  }
  return Object.entries(payload).map(([alias, playerName]) => ({
    alias: alias.trim(),
    player_name: String(playerName).trim(),
  }));
}

function validatePlayerReferences(dataset) {
  const canonicalNames = new Map(dataset.players.map((player) => [player.name.toLowerCase(), player.name]));
  const aliases = new Map();
  for (const entry of dataset.player_aliases) {
    const target = canonicalNames.get(entry.player_name.toLowerCase());
    if (!target) {
      throw new Error(`Alias "${entry.alias}" targets unmapped player "${entry.player_name}"`);
    }
    aliases.set(entry.alias.toLowerCase(), target);
  }

  const groups = [
    ['tournament player', dataset.tournament_players],
    ['match player', dataset.match_players],
    ['doodle player', dataset.doodle_availability],
    ['attendance player', dataset.attendance_players],
  ];
  for (const [kind, rows] of groups) {
    for (const row of rows) {
      const key = row.player_name.toLowerCase();
      const resolved = canonicalNames.get(key) || aliases.get(key);
      if (!resolved) {
        throw new Error(`Unmapped player "${row.player_name}" in ${row.source_path} (${kind})`);
      }
      row.player_name = resolved;
    }
  }
}

export function loadDataHubDataset(rootDir) {
  const root = backupRoot(rootDir);
  if (!fs.existsSync(root)) throw new Error(`DataHub backup-data folder not found: ${root}`);

  const players = loadPlayers(root);
  const tournamentIndex = loadTournamentIndex(root);
  const matchData = loadMatchData(root, tournamentIndex);
  const doodleAvailability = loadDoodles(root);
  const attendance = loadAttendance(root);
  const playerAliases = loadAliases();

  const tournamentByDate = new Map();
  for (const tournament of tournamentIndex) {
    tournamentByDate.set(tournament.tournament_date, tournament);
  }
  for (const tournament of matchData.tournaments) {
    tournamentByDate.set(tournament.tournament_date, {
      ...(tournamentByDate.get(tournament.tournament_date) || {}),
      ...Object.fromEntries(Object.entries(tournament).filter(([, value]) => value !== null)),
    });
  }

  const dataset = {
    players,
    player_aliases: playerAliases,
    tournaments: [...tournamentByDate.values()].sort((a, b) => a.tournament_date.localeCompare(b.tournament_date)),
    tournament_players: matchData.tournamentPlayers,
    matches: matchData.matches,
    match_players: matchData.matchPlayers,
    doodle_availability: doodleAvailability,
    attendance_records: attendance.records,
    attendance_players: attendance.players,
    summary: {
      player_count: players.length,
      tournament_count: tournamentByDate.size,
      match_count: matchData.matches.length,
      match_player_count: matchData.matchPlayers.length,
      doodle_availability_count: doodleAvailability.length,
      attendance_record_count: attendance.records.length,
      attendance_player_count: attendance.players.length,
    },
  };
  validatePlayerReferences(dataset);
  return dataset;
}

export function loadDataHubMatches(rootDir) {
  return loadDataHubDataset(rootDir).matches;
}

export async function importDatasetToSupabase(dataset, options = {}) {
  const {
    supabaseUrl = process.env.SUPABASE_URL,
    apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    dryRun = false,
  } = options;

  if (dryRun) return { ...dataset.summary, dry_run: true };
  if (!supabaseUrl || !apiKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to write to Supabase.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/import_legacy_dataset`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payload: dataset }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase import failed (${response.status}): ${text}`);
  }
  return await response.json();
}

export async function main() {
  const datahubRoot = process.env.DATAHUB_ROOT || DEFAULT_DATAHUB_ROOT;
  const dataset = loadDataHubDataset(datahubRoot);
  const result = await importDatasetToSupabase(dataset, {
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(JSON.stringify({
    datahub_root: datahubRoot,
    ...result,
  }, null, 2));
}

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
