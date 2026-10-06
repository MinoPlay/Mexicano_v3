import { renderHeader } from '../components/nav.js';
import { fetchAuditEvents } from '../services/backend.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderEntries(events) {
  if (!events.length) {
    return `<div style="padding:var(--space-xl);text-align:center;color:var(--text-secondary);font-size:var(--font-size-sm);">
      No audit events recorded yet.
    </div>`;
  }
  return events.map((event) => {
    const when = String(event.created_at || '').replace('T', ' ').replace(/\..*$/, '');
    const actor = event.actor_player?.name || 'System';
    const detail = event.after_data || event.metadata;
    return `
      <div style="padding:var(--space-sm) var(--space-md);border-bottom:1px solid var(--border-light);">
        <div style="font-size:var(--font-size-sm);font-weight:700;color:var(--text-primary);">
          ${esc(event.action)} · ${esc(event.entity_type)}
        </div>
        <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:2px;">
          ${esc(actor)} · ${esc(when)}${event.entity_id ? ` · ${esc(event.entity_id)}` : ''}
        </div>
        ${detail && Object.keys(detail).length ? `
          <pre style="font-size:var(--font-size-xs);white-space:pre-wrap;word-break:break-word;margin:var(--space-xs) 0 0;color:var(--text-primary);">${esc(JSON.stringify(detail, null, 2))}</pre>
        ` : ''}
      </div>
    `;
  }).join('');
}

export async function renderLogs(container) {
  container.innerHTML = `
    ${renderHeader('Audit Logs')}
    <div class="page-content">
      <div id="audit-log-status" style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-bottom:var(--space-sm);">
        Loading Supabase audit events...
      </div>
      <div id="audit-log-list" style="background:var(--bg-card);border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border);"></div>
    </div>
  `;

  try {
    const events = await fetchAuditEvents();
    container.querySelector('#audit-log-status').textContent =
      `${events.length} event${events.length === 1 ? '' : 's'} · append-only`;
    container.querySelector('#audit-log-list').innerHTML = renderEntries(events);
  } catch (error) {
    container.querySelector('#audit-log-status').textContent = 'Could not load audit events';
    container.querySelector('#audit-log-list').innerHTML = `
      <div style="padding:var(--space-md);color:var(--danger,#e53935);">${esc(error.message)}</div>
    `;
  }
}
