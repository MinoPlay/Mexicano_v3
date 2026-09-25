import { handleOptions, json } from '../_shared/http.ts';
import { requireUser } from '../_shared/access.ts';

type Grant = {
  role: 'member' | 'admin';
  selected_player_id: string | null;
  expires_at: string;
  revoked_at: string | null;
};

async function requireGrant(client: any, userId: string): Promise<Grant> {
  const { data, error } = await client
    .from('app_access_grants')
    .select('role,selected_player_id,expires_at,revoked_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) {
    throw new Error('Active app access is required');
  }
  return data;
}

function requireAdmin(grant: Grant) {
  if (grant.role !== 'admin') throw new Error('Admin access is required');
}

async function audit(client: any, userId: string, grant: Grant, action: string, entityType: string, entityId: string | null, afterData: unknown) {
  const { error } = await client.from('audit_events').insert({
    actor_user_id: userId,
    actor_player_id: grant.selected_player_id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_data: afterData,
  });
  if (error) throw error;
}

async function resolvePlayer(client: any, name: string) {
  const { data, error } = await client.rpc('resolve_legacy_player_id', { p_name: name });
  if (error) throw error;
  return data;
}

async function saveTournament(client: any, userId: string, grant: Grant, payload: any) {
  requireAdmin(grant);
  const dataset = {
    players: [],
    player_aliases: [],
    tournaments: payload.tournaments || [],
    tournament_players: payload.tournament_players || [],
    matches: payload.matches || [],
    match_players: payload.match_players || [],
    doodle_availability: [],
    attendance_records: [],
    attendance_players: [],
  };
  const { data, error } = await client.rpc('import_legacy_dataset', { payload: dataset });
  if (error) throw error;
  const date = payload.tournaments?.[0]?.tournament_date || null;
  await audit(client, userId, grant, 'save', 'tournament', date, {
    matches: dataset.matches.length,
    complete: payload.tournaments?.[0]?.is_complete === true,
  });
  return data;
}

async function confirmAttendance(client: any, userId: string, grant: Grant, payload: any) {
  if (!grant.selected_player_id) throw new Error('Select a player before confirming attendance');
  const playerId = await resolvePlayer(client, payload.player_name);
  if (grant.role !== 'admin' && playerId !== grant.selected_player_id) {
    throw new Error('You can only confirm your own attendance');
  }
  const { data: tournament, error: tournamentError } = await client
    .from('tournaments')
    .select('id')
    .eq('tournament_date', payload.date)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) throw new Error('Tournament not found');
  const { error } = await client
    .from('tournament_players')
    .update({ confirmed: true })
    .eq('tournament_id', tournament.id)
    .eq('player_id', playerId);
  if (error) throw error;
  await audit(client, userId, grant, 'confirm_attendance', 'tournament', tournament.id, {
    player_id: playerId,
  });
  return { changed: true };
}

async function saveDoodle(client: any, userId: string, grant: Grant, payload: any) {
  if (!/^\d{4}-\d{2}$/.test(payload.year_month || '')) throw new Error('Invalid doodle month');
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const selectedName = grant.selected_player_id
    ? (await client.from('players').select('name').eq('id', grant.selected_player_id).single()).data?.name
    : null;
  const writableEntries = grant.role === 'admin'
    ? entries
    : entries.filter((entry: any) => entry.name === selectedName);
  if (grant.role !== 'admin' && writableEntries.length !== entries.length) {
    throw new Error('You can only change your own doodle availability');
  }

  const start = `${payload.year_month}-01`;
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);

  for (const entry of writableEntries) {
    const playerId = await resolvePlayer(client, entry.name);
    const { error: deleteError } = await client
      .from('doodle_availability')
      .delete()
      .eq('player_id', playerId)
      .gte('availability_date', start)
      .lt('availability_date', end);
    if (deleteError) throw deleteError;
    const rows = (entry.selectedDates || []).map((date: string) => ({
      availability_date: date,
      player_id: playerId,
      source_path: 'supabase-app',
    }));
    if (rows.length) {
      const { error: insertError } = await client.from('doodle_availability').insert(rows);
      if (insertError) throw insertError;
    }
  }
  await audit(client, userId, grant, 'save', 'doodle', payload.year_month, {
    entries: writableEntries.length,
    changelog: payload.changelog || [],
  });
  return { saved: true };
}

async function saveManualAttendance(client: any, userId: string, grant: Grant, payload: any) {
  requireAdmin(grant);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const { error: deletePlayersError } = await client
    .from('attendance_players')
    .delete()
    .in('attendance_id',
      (await client.from('attendance_records').select('id').eq('kind', 'manual')).data?.map((row: any) => row.id) || []);
  if (deletePlayersError) throw deletePlayersError;
  const { error: deleteRecordsError } = await client.from('attendance_records').delete().eq('kind', 'manual');
  if (deleteRecordsError) throw deleteRecordsError;

  for (const entry of entries) {
    const { data: record, error } = await client.from('attendance_records').insert({
      attendance_date: entry.date,
      kind: 'manual',
      note: entry.note || null,
      source_path: 'supabase-app',
    }).select('id').single();
    if (error) throw error;
    const rows = [];
    for (const name of entry.players || []) {
      rows.push({
        attendance_id: record.id,
        player_id: await resolvePlayer(client, name),
        source_path: 'supabase-app',
      });
    }
    if (rows.length) {
      const { error: playersError } = await client.from('attendance_players').insert(rows);
      if (playersError) throw playersError;
    }
  }
  await audit(client, userId, grant, 'save', 'manual_attendance', null, { count: entries.length });
  return { saved: entries.length };
}

async function addPlayer(client: any, userId: string, grant: Grant, payload: any) {
  requireAdmin(grant);
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Player name is required');
  const { data, error } = await client.from('players').insert({ name }).select('id,name').single();
  if (error) throw error;
  await audit(client, userId, grant, 'create', 'player', data.id, data);
  return data;
}

async function deleteTournament(client: any, userId: string, grant: Grant, payload: any) {
  requireAdmin(grant);
  const { data, error } = await client
    .from('tournaments')
    .delete()
    .eq('tournament_date', payload.date)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  await audit(client, userId, grant, 'delete', 'tournament', data?.id || payload.date, null);
  return { deleted: Boolean(data) };
}

async function enqueue(client: any, userId: string, grant: Grant, payload: any) {
  const correlationId = crypto.randomUUID();
  const { data, error } = await client.rpc('enqueue_notification', {
    p_idempotency_key: payload.idempotency_key,
    p_channel: payload.channel,
    p_event_type: payload.event_type,
    p_payload: payload.payload,
    p_correlation_id: correlationId,
  });
  if (error) throw error;
  await audit(client, userId, grant, 'enqueue', 'notification', data, {
    channel: payload.channel,
    event_type: payload.event_type,
    correlation_id: correlationId,
  });
  return { id: data, correlation_id: correlationId };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    const { client, user } = await requireUser(request);
    const grant = await requireGrant(client, user.id);
    const { operation, payload = {} } = await request.json();
    const handlers: Record<string, () => Promise<unknown>> = {
      'save_tournament': () => saveTournament(client, user.id, grant, payload),
      'confirm_attendance': () => confirmAttendance(client, user.id, grant, payload),
      'save_doodle': () => saveDoodle(client, user.id, grant, payload),
      'save_manual_attendance': () => saveManualAttendance(client, user.id, grant, payload),
      'add_player': () => addPlayer(client, user.id, grant, payload),
      'delete_tournament': () => deleteTournament(client, user.id, grant, payload),
      'enqueue_notification': () => enqueue(client, user.id, grant, payload),
    };
    const handler = handlers[operation];
    if (!handler) return json({ message: `Unsupported operation: ${operation}` }, 400);
    return json(await handler());
  } catch (error) {
    return json({ message: error.message || 'Mutation failed' }, 400);
  }
});
