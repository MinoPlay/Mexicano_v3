import { handleOptions, json } from '../_shared/http.ts';
import { serviceClient } from '../_shared/access.ts';

function retryDelay(attempt: number): number {
  return Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  const expectedSecret = Deno.env.get('OUTBOX_DISPATCH_SECRET') || '';
  if (!expectedSecret || request.headers.get('x-outbox-secret') !== expectedSecret) {
    return json({ message: 'Unauthorized' }, 401);
  }

  const client = serviceClient();
  const owner = Deno.env.get('GITHUB_RELAY_OWNER') || 'MinoPlay';
  const repo = Deno.env.get('GITHUB_RELAY_REPO') || 'DataHub_Mexicano';
  const githubToken = Deno.env.get('GITHUB_RELAY_TOKEN');
  if (!githubToken) return json({ message: 'GitHub relay token is missing' }, 500);

  // Atomic claim (FOR UPDATE SKIP LOCKED): concurrent dispatchers never get the
  // same row. Claimed rows are already 'processing' with attempt_count bumped.
  const { data: items, error } = await client.rpc('claim_notification_outbox', { p_limit: 25 });
  if (error) return json({ message: error.message }, 500);

  const results = [];
  for (const item of items || []) {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: item.event_type,
          client_payload: {
            ...item.payload,
            outbox_id: item.id,
            idempotency_key: item.idempotency_key,
            correlation_id: item.correlation_id,
          },
        }),
      });
      if (response.status !== 204) {
        throw new Error(`GitHub dispatch failed (${response.status}): ${await response.text()}`);
      }
      await client.from('notification_outbox').update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
      }).eq('id', item.id);
      results.push({ id: item.id, status: 'delivered' });
    } catch (dispatchError) {
      const attempt = item.attempt_count;
      await client.from('notification_outbox').update({
        status: 'failed',
        last_error: dispatchError.message,
        available_at: new Date(Date.now() + retryDelay(attempt) * 1000).toISOString(),
      }).eq('id', item.id);
      results.push({ id: item.id, status: 'failed', error: dispatchError.message });
    }
  }
  return json({ processed: results.length, results });
});
