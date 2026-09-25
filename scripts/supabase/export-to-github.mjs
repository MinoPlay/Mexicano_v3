import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_GITHUB_ROOT = path.resolve(process.cwd(), '..', 'DataHub_Mexicano', 'mexicano_v3');
const SCHEMA_VERSION = '20260924120000';
const PAGE_SIZE = 1000;
const SAFE_TABLES = [
  'players',
  'player_aliases',
  'player_roles',
  'tournaments',
  'tournament_players',
  'matches',
  'match_players',
  'doodle_availability',
  'attendance_records',
  'attendance_players',
  'app_settings',
  'audit_events',
  'elo_calculation_versions',
  'elo_snapshots',
  'projection_runs',
];
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function stableRows(rows) {
  return [...(rows || [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function writeJson(rootDir, relativePath, value, files) {
  const target = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(target, content, 'utf8');
  files.push({
    path: relativePath.replaceAll('\\', '/'),
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
  });
}

function removeStaleDayFiles(rootDir, expectedPaths) {
  const backupRoot = path.join(rootDir, 'backup-data');
  if (!fs.existsSync(backupRoot)) return [];
  const removed = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
      } else if (/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) {
        const relative = path.relative(rootDir, target).replaceAll('\\', '/');
        if (!expectedPaths.has(relative)) {
          fs.unlinkSync(target);
          removed.push(relative);
        }
      }
    }
  };
  visit(backupRoot);
  return removed;
}

function activeProjectionVersion(snapshot) {
  return snapshot.elo_calculation_versions?.find((version) => version.active)?.id
    || snapshot.elo_calculation_versions?.[0]?.id
    || null;
}

function buildLegacy(snapshot, generatedAt) {
  const playersById = new Map((snapshot.players || []).map((player) => [player.id, player]));
  const tournamentsById = new Map((snapshot.tournaments || []).map((tournament) => [tournament.id, tournament]));
  const matchPlayersByMatch = new Map();
  for (const row of snapshot.match_players || []) {
    const current = matchPlayersByMatch.get(row.match_id) || [];
    current.push(row);
    matchPlayersByMatch.set(row.match_id, current);
  }
  const rosterByTournament = new Map();
  for (const row of snapshot.tournament_players || []) {
    const current = rosterByTournament.get(row.tournament_id) || [];
    current.push(row);
    rosterByTournament.set(row.tournament_id, current);
  }
  const snapshots = new Map((snapshot.elo_snapshots || []).map((row) => [
    `${row.tournament_id}:${row.player_id}`,
    row,
  ]));

  const dayFiles = new Map();
  for (const match of snapshot.matches || []) {
    const tournament = tournamentsById.get(match.tournament_id);
    if (!tournament) throw new Error(`Match ${match.id} references missing tournament ${match.tournament_id}`);
    const slots = [...(matchPlayersByMatch.get(match.id) || [])]
      .sort((a, b) => a.team - b.team || a.position - b.position);
    if (slots.length !== 4) throw new Error(`Match ${match.id} does not have exactly four player slots`);
    const player = (team, position) => {
      const slot = slots.find((row) => row.team === team && row.position === position);
      const resolved = playersById.get(slot?.player_id);
      if (!resolved) throw new Error(`Match ${match.id} references missing player`);
      return { slot, resolved, elo: snapshots.get(`${match.tournament_id}:${slot.player_id}`)?.elo ?? null };
    };
    const p11 = player(1, 1);
    const p12 = player(1, 2);
    const p21 = player(2, 1);
    const p22 = player(2, 2);
    const date = tournament.tournament_date;
    const rows = dayFiles.get(date) || [];
    rows.push({
      Date: date,
      RoundNumber: match.round_number,
      ScoreTeam1: match.score_team_1,
      ScoreTeam2: match.score_team_2,
      Team1Player1Name: p11.resolved.name,
      Team1Player2Name: p12.resolved.name,
      Team2Player1Name: p21.resolved.name,
      Team2Player2Name: p22.resolved.name,
      Team1Player1Elo: p11.elo,
      Team1Player2Elo: p12.elo,
      Team2Player1Elo: p21.elo,
      Team2Player2Elo: p22.elo,
    });
    dayFiles.set(date, rows);
  }

  const latestSnapshotByPlayer = new Map();
  for (const row of snapshot.elo_snapshots || []) {
    const tournament = tournamentsById.get(row.tournament_id);
    const current = latestSnapshotByPlayer.get(row.player_id);
    if (!current || tournament?.tournament_date > current.date) {
      latestSnapshotByPlayer.set(row.player_id, { ...row, date: tournament?.tournament_date || '' });
    }
  }
  const legacyPlayers = stableRows(snapshot.players || []).map((player) => {
    const elo = latestSnapshotByPlayer.get(player.id);
    return {
      Id: player.legacy_id || player.id,
      Name: player.name,
      MatchPadelId: player.match_padel_id || 0,
      ELO: elo?.elo ?? 1000,
      PreviousELO: elo?.previous_elo ?? 1000,
      Wins: 0,
      Losses: 0,
      TotalPoints: 0,
      Average: 0,
      Tournaments: (snapshot.tournament_players || []).filter((row) => row.player_id === player.id).length,
    };
  });
  const legacyTournaments = stableRows(snapshot.tournaments || []).map((tournament) => {
    const matches = (snapshot.matches || []).filter((match) => match.tournament_id === tournament.id);
    const roster = rosterByTournament.get(tournament.id) || [];
    return {
      date: tournament.tournament_date,
      playerCount: roster.length,
      roundCount: new Set(matches.map((match) => match.round_number)).size,
      matchCount: matches.length,
      completedCount: matches.filter((match) => Number(match.score_team_1) + Number(match.score_team_2) > 0).length,
      isComplete: tournament.is_complete === true || tournament.status === 'completed',
    };
  });

  const doodles = new Map();
  for (const row of snapshot.doodle_availability || []) {
    const player = playersById.get(row.player_id);
    if (!player) throw new Error(`Doodle row references missing player ${row.player_id}`);
    const month = row.availability_date.slice(0, 7);
    const perPlayer = doodles.get(month) || new Map();
    const dates = perPlayer.get(player.name) || [];
    dates.push(row.availability_date);
    perPlayer.set(player.name, dates);
    doodles.set(month, perPlayer);
  }

  const attendancePlayers = new Map();
  for (const row of snapshot.attendance_players || []) {
    const player = playersById.get(row.player_id);
    if (!player) throw new Error(`Attendance row references missing player ${row.player_id}`);
    const names = attendancePlayers.get(row.attendance_id) || [];
    names.push(player.name);
    attendancePlayers.set(row.attendance_id, names);
  }
  const manualAttendance = stableRows(
    (snapshot.attendance_records || []).filter((record) => record.kind === 'manual'),
  ).map((record) => ({
    date: record.attendance_date,
    players: (attendancePlayers.get(record.id) || []).sort((a, b) => a.localeCompare(b)),
  }));

  return { dayFiles, legacyPlayers, legacyTournaments, doodles, manualAttendance, generatedAt };
}

export function writeBackupSnapshot(snapshot, rootDir = DEFAULT_GITHUB_ROOT, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const schemaVersion = options.schemaVersion || SCHEMA_VERSION;
  const files = [];
  const legacy = buildLegacy(snapshot, generatedAt);
  const expectedDayPaths = new Set();

  writeJson(rootDir, 'backup-data/players.json', legacy.legacyPlayers, files);
  writeJson(rootDir, 'backup-data/tournaments.json', legacy.legacyTournaments, files);
  writeJson(rootDir, 'backup-data/data/attendance_manual.json', legacy.manualAttendance, files);

  for (const [date, rows] of [...legacy.dayFiles].sort(([a], [b]) => a.localeCompare(b))) {
    const relativePath = `backup-data/${date.slice(0, 4)}/${date.slice(0, 7)}/${date}.json`;
    expectedDayPaths.add(relativePath);
    writeJson(rootDir, relativePath, {
      backup_timestamp: generatedAt,
      match_date: date,
      match_count: rows.length,
      matches: rows.sort((a, b) => a.RoundNumber - b.RoundNumber),
    }, files);
  }
  for (const [month, perPlayer] of [...legacy.doodles].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = [...perPlayer].sort(([a], [b]) => a.localeCompare(b)).map(([name, dates]) => ({
      name,
      selectedDates: [...dates].sort(),
    }));
    writeJson(rootDir, `backup-data/${month.slice(0, 4)}/${month}/doodle_${month}.json`, rows, files);
  }
  const staleFilesRemoved = removeStaleDayFiles(rootDir, expectedDayPaths);

  for (const table of SAFE_TABLES) {
    writeJson(rootDir, `supabase-backup/tables/${table}.json`, stableRows(snapshot[table]), files);
  }
  const manifest = {
    generated_at: generatedAt,
    schema_version: schemaVersion,
    projection_version: activeProjectionVersion(snapshot),
    source_watermark: options.sourceWatermark || generatedAt,
    record_counts: Object.fromEntries(SAFE_TABLES.map((table) => [table, (snapshot[table] || []).length])),
    stale_files_removed: staleFilesRemoved,
    files,
  };
  writeJson(rootDir, 'supabase-backup/manifest.json', manifest, []);
  return { filesWritten: files.length + 1, manifest, staleFilesRemoved };
}

async function supabaseRequest({ supabaseUrl, apiKey }, pathname, options = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}${pathname}`, {
    ...options,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || '',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

async function loadTable(config, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await supabaseRequest(
      config,
      `/rest/v1/${table}?select=*&offset=${offset}&limit=${PAGE_SIZE}`,
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function loadSupabaseSnapshot(config) {
  const entries = await Promise.all(SAFE_TABLES.map(async (table) => [table, await loadTable(config, table)]));
  return Object.fromEntries(entries);
}

async function createBackupRun(config) {
  const rows = await supabaseRequest(config, '/rest/v1/backup_runs', {
    method: 'POST',
    body: JSON.stringify({ status: 'running' }),
    prefer: 'return=representation',
  });
  return rows[0].id;
}

async function finishBackupRun(config, id, patch) {
  await supabaseRequest(config, `/rest/v1/backup_runs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, completed_at: new Date().toISOString() }),
    prefer: 'return=minimal',
  });
}

export async function main() {
  const rootDir = process.env.DATAHUB_ROOT || process.env.GITHUB_TARGET_REPO_PATH || DEFAULT_GITHUB_ROOT;
  const config = {
    supabaseUrl: process.env.SUPABASE_URL,
    apiKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (!config.supabaseUrl || !config.apiKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const runId = await createBackupRun(config);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `backup_run_id=${runId}\n`, 'utf8');
  }
  try {
    const snapshot = await loadSupabaseSnapshot(config);
    const result = writeBackupSnapshot(snapshot, rootDir);
    const manifestContent = fs.readFileSync(path.join(rootDir, 'supabase-backup', 'manifest.json'));
    await finishBackupRun(config, runId, {
      status: 'succeeded',
      source_watermark: result.manifest.source_watermark,
      record_counts: result.manifest.record_counts,
      manifest_sha256: sha256(manifestContent),
    });
    console.log(JSON.stringify({
      root_dir: rootDir,
      files_written: result.filesWritten,
      record_counts: result.manifest.record_counts,
      stale_files_removed: result.staleFilesRemoved,
    }, null, 2));
  } catch (error) {
    await finishBackupRun(config, runId, {
      status: 'failed',
      error: error.message || String(error),
    }).catch(() => {});
    throw error;
  }
}

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
