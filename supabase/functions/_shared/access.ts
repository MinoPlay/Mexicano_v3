import { createClient } from 'npm:@supabase/supabase-js@2';

export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase service configuration is missing');
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Authentication is required');
  const client = serviceClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid Supabase session');
  return { client, user: data.user };
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  }
  return diff === 0;
}

export async function assertRateLimit(
  client: ReturnType<typeof serviceClient>,
  userId: string,
  kind: 'member' | 'admin',
) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from('access_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', kind)
    .gte('attempted_at', since);
  if (error) throw error;
  if ((count || 0) >= 10) throw new Error('Too many access attempts; try again later');
}

export async function recordAttempt(
  client: ReturnType<typeof serviceClient>,
  userId: string,
  kind: 'member' | 'admin',
  succeeded: boolean,
) {
  const { error } = await client.from('access_attempts').insert({
    user_id: userId,
    kind,
    succeeded,
  });
  if (error) throw error;
}
