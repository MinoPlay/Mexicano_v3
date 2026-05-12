import { getGitHubLog, clearGitHubLog } from '../services/github.js';
import { renderHeader } from '../components/nav.js';

const ACTION_BADGE = {
  READ:                    { bg: '#1e3a5f', color: '#60a5fa', label: 'READ' },
  READ_404:                { bg: '#422006', color: '#fbbf24', label: 'READ 404' },
  LIST:                    { bg: '#1e3a5f', color: '#60a5fa', label: 'LIST' },
  WRITE:                   { bg: '#14532d', color: '#4ade80', label: 'WRITE' },
  WRITE_OK:                { bg: '#14532d', color: '#4ade80', label: 'WRITE OK' },
  WRITE_FAIL:              { bg: '#450a0a', color: '#f87171', label: 'WRITE FAIL' },
  WRITE_CONFLICT:          { bg: '#422006', color: '#fbbf24', label: 'WRITE CONFLICT' },
  DELETE:                  { bg: '#450a0a', color: '#f87171', label: 'DELETE' },
  DELETE_OK:               { bg: '#450a0a', color: '#f87171', label: 'DELETE OK' },
  DELETE_FAIL:             { bg: '#450a0a', color: '#f87171', label: 'DELETE FAIL' },
  PUSH_START:              { bg: '#14532d', color: '#4ade80', label: 'PUSH START' },
  PUSH_DONE:               { bg: '#14532d', color: '#4ade80', label: 'PUSH DONE' },
  READ_TOURNAMENTS_INDEX:  { bg: '#1e3a5f', color: '#60a5fa', label: 'READ' },
  TOURNAMENTS_INDEX_LOADED:{ bg: '#1e3a5f', color: '#60a5fa', label: 'INDEX LOADED' },
  TOURNAMENTS_INDEX_HEAL:  { bg: '#422006', color: '#fbbf24', label: 'INDEX HEAL' },
  TOURNAMENTS_INDEX_HEALED:{ bg: '#14532d', color: '#4ade80', label: 'INDEX HEALED' },
  TOURNAMENTS_INDEX_MISSING:{ bg: '#422006', color: '#fbbf24', label: 'INDEX MISSING' },
  TOURNAMENTS_INDEX_CREATED:{ bg: '#14532d', color: '#4ade80', label: 'INDEX CREATED' },
  UPDATE_TOURNAMENT_ENTRY: { bg: '#14532d', color: '#4ade80', label: 'WRITE' },
};

function badge(action) {
  const s = ACTION_BADGE[action] || { bg: '#1e293b', color: '#94a3b8', label: action };
  return `<span style="
    display:inline-block;
    padding:2px 6px;
    border-radius:4px;
    font-size:0.65rem;
    font-weight:700;
    letter-spacing:0.04em;
    background:${s.bg};
    color:${s.color};
    white-space:nowrap;
  ">${s.label}</span>`;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function renderEntries(log) {
  if (!log.length) {
    return `<div style="padding:var(--space-xl);text-align:center;color:var(--text-secondary);font-size:var(--font-size-sm);">
      No git operations logged yet.
    </div>`;
  }
  return log.map(e => `
    <div style="
      padding:var(--space-sm) var(--space-md);
      border-bottom:1px solid var(--border-light);
      display:grid;
      gap:2px;
    ">
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;">
        ${badge(e.action)}
        <span style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-left:auto;white-space:nowrap;">${formatTime(e.ts)}</span>
      </div>
      <div style="font-size:var(--font-size-xs);color:var(--text-primary);word-break:break-all;font-family:monospace;">${e.path}</div>
      ${e.caller ? `<div style="font-size:var(--font-size-xs);color:var(--text-tertiary);">via ${e.caller}</div>` : ''}
      ${e.detail ? `<div style="font-size:var(--font-size-xs);color:var(--text-secondary);">${e.detail}</div>` : ''}
    </div>
  `).join('');
}

export function renderGitLogs(container) {
  const log = getGitHubLog();

  container.innerHTML = `
    ${renderHeader('Git Logs', `
      <button id="clear-logs-btn" class="btn btn-danger btn-sm">🗑 Clear</button>
    `)}
    <div class="page-content">
      <div style="
        font-size:var(--font-size-xs);
        color:var(--text-secondary);
        margin-bottom:var(--space-sm);
      ">${log.length} entr${log.length === 1 ? 'y' : 'ies'} · localStorage only · cleared on demand</div>
      <div id="git-log-list" style="
        background:var(--bg-card);
        border-radius:var(--radius-md);
        overflow:hidden;
        border:1px solid var(--border);
      ">
        ${renderEntries(log)}
      </div>
    </div>
  `;

  container.querySelector('#clear-logs-btn').addEventListener('click', () => {
    clearGitHubLog();
    container.querySelector('#git-log-list').innerHTML = renderEntries([]);
    container.querySelector('[style*="entr"]').textContent = '0 entries · localStorage only · cleared on demand';
  });
}
