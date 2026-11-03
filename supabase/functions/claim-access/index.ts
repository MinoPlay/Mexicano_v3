import { corsHeaders, handleOptions, json } from '../_shared/http.ts';
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
    await assertRateLimit(client, user.id, 'member');
    const body = await request.json();
    const suppliedHash = await sha256Hex(String(body?.code || ''));
    const expectedHash = Deno.env.get('APP_ACCESS_CODE_SHA256') || '';
    const valid = expectedHash.length > 0 && constantTimeEqual(suppliedHash, expectedHash);
    await recordAttempt(client, user.id, 'member', valid);
    if (!valid) return json({ message: 'Invalid access code' }, 401);

    const days = Number(Deno.env.get('APP_ACCESS_DAYS') || 30);
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await client.rpc('grant_app_access', {
      p_user_id: user.id,
      p_expires_at: expiresAt,
      p_role: 'member',
    });
    if (error) throw error;
    return json({ role: 'member', expires_at: expiresAt });
  } catch (error) {
    return json({ message: error.message || 'Access claim failed' }, 400);
  }
});

export { corsHeaders };
