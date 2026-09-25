import { handleOptions, json } from '../_shared/http.ts';
import {
  assertRateLimit,
  constantTimeEqual,
  recordAttempt,
  requireUser,
  sha256Hex,
} from '../_shared/access.ts';

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    const { client, user } = await requireUser(request);
    await assertRateLimit(client, user.id, 'admin');

    const { data: grant, error: grantError } = await client
      .from('app_access_grants')
      .select('selected_player_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (grantError) throw grantError;
    if (!grant?.selected_player_id) return json({ message: 'Select a player before admin elevation' }, 403);

    const { count, error: roleError } = await client
      .from('player_roles')
      .select('player_id', { count: 'exact', head: true })
      .eq('player_id', grant.selected_player_id)
      .eq('role', 'admin');
    if (roleError) throw roleError;
    if (!count) return json({ message: 'Selected player is not an administrator' }, 403);

    const body = await request.json();
    const suppliedHash = await sha256Hex(String(body?.code || ''));
    const expectedHash = Deno.env.get('ADMIN_ACCESS_CODE_SHA256') || '';
    const valid = expectedHash.length > 0 && constantTimeEqual(suppliedHash, expectedHash);
    await recordAttempt(client, user.id, 'admin', valid);
    if (!valid) return json({ message: 'Invalid admin code' }, 401);

    const hours = Number(Deno.env.get('ADMIN_ACCESS_HOURS') || 4);
    const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
    const { error } = await client.rpc('grant_app_access', {
      p_user_id: user.id,
      p_expires_at: expiresAt,
      p_role: 'admin',
    });
    if (error) throw error;
    return json({ role: 'admin', expires_at: expiresAt });
  } catch (error) {
    return json({ message: error.message || 'Admin elevation failed' }, 400);
  }
});
