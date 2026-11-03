import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required.');
  }
  return email;
}

async function apiRequest(url, serviceRoleKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error;
    throw new Error(message || `Supabase request failed with HTTP ${response.status}.`);
  }
  return payload;
}

async function findAuthUser(supabaseUrl, serviceRoleKey, email) {
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const result = await apiRequest(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      serviceRoleKey,
    );
    const users = result?.users || [];
    const user = users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (users.length < perPage) return null;
  }
  throw new Error('Auth user lookup exceeded 100 pages.');
}

async function ensureAuthUser(supabaseUrl, serviceRoleKey, email) {
  const existing = await findAuthUser(supabaseUrl, serviceRoleKey, email);
  const body = {
    email,
    email_confirm: true,
    user_metadata: { mexicano_access: 'approved-email' },
  };
  if (!existing) {
    return apiRequest(`${supabaseUrl}/auth/v1/admin/users`, serviceRoleKey, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((result) => result?.user || result);
  }

  return existing;
}

async function invokeRpc(supabaseUrl, serviceRoleKey, functionName, body) {
  return apiRequest(
    `${supabaseUrl}/rest/v1/rpc/${functionName}`,
    serviceRoleKey,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function approveUser(email, options = {}) {
  const supabaseUrl = (options.supabaseUrl || requiredEnvironment('SUPABASE_URL'))
    .replace(/\/+$/, '');
  const serviceRoleKey = options.serviceRoleKey || requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  const accessDays = Number(options.accessDays ?? process.env.AUTH_USER_ACCESS_DAYS ?? 3650);
  if (!Number.isFinite(accessDays) || accessDays <= 0) {
    throw new Error('AUTH_USER_ACCESS_DAYS must be a positive number.');
  }
  const normalizedEmail = normalizeEmail(email);
  const user = await ensureAuthUser(supabaseUrl, serviceRoleKey, normalizedEmail);
  const expiresAt = new Date(Date.now() + accessDays * 86400000).toISOString();
  const approval = await invokeRpc(supabaseUrl, serviceRoleKey, 'approve_email_user', {
    p_user_id: user.id,
    p_email: normalizedEmail,
    p_expires_at: expiresAt,
    p_approved_by: process.env.AUTH_USER_APPROVED_BY || 'local-script',
    p_notes: process.env.AUTH_USER_NOTES || null,
  });
  return approval;
}

export async function revokeUser(email, options = {}) {
  const supabaseUrl = (options.supabaseUrl || requiredEnvironment('SUPABASE_URL'))
    .replace(/\/+$/, '');
  const serviceRoleKey = options.serviceRoleKey || requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  return invokeRpc(supabaseUrl, serviceRoleKey, 'revoke_email_user', {
    p_email: normalizeEmail(email),
  });
}

export async function listAllowedEmails(options = {}) {
  const supabaseUrl = (options.supabaseUrl || requiredEnvironment('SUPABASE_URL'))
    .replace(/\/+$/, '');
  const serviceRoleKey = options.serviceRoleKey || requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  return invokeRpc(supabaseUrl, serviceRoleKey, 'list_allowed_emails', {});
}

export async function getUserStatus(email, options = {}) {
  const supabaseUrl = (options.supabaseUrl || requiredEnvironment('SUPABASE_URL'))
    .replace(/\/+$/, '');
  const serviceRoleKey = options.serviceRoleKey || requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  const normalizedEmail = normalizeEmail(email);
  const encodedEmail = encodeURIComponent(normalizedEmail);
  const rows = await apiRequest(
    `${supabaseUrl}/rest/v1/approved_auth_users`
      + `?select=user_id,email,player_id,approved_at,approved_by,revoked_at,notes`
      + `&email=eq.${encodedEmail}`,
    serviceRoleKey,
  );
  const authUser = await findAuthUser(supabaseUrl, serviceRoleKey, normalizedEmail);
  return {
    auth_user_exists: Boolean(authUser),
    auth_user_id: authUser?.id || null,
    approval: rows?.[0] || null,
  };
}

async function main(argv) {
  const [command, email] = argv;
  if (command === 'list') {
    console.log(JSON.stringify(await listAllowedEmails(), null, 2));
    return;
  }
  if (!['approve', 'revoke', 'status'].includes(command) || !email) {
    throw new Error(
      'Usage: node scripts/supabase/manage-auth-user.mjs <approve|revoke|status> <email>'
      + ' | node scripts/supabase/manage-auth-user.mjs list',
    );
  }
  const actions = {
    approve: approveUser,
    revoke: revokeUser,
    status: getUserStatus,
  };
  const result = await actions[command](email);
  console.log(JSON.stringify(result, null, 2));
}

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
