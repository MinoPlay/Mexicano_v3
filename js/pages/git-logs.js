import { getRoundLog, clearRoundLog } from '../services/round-log.js';
import { renderHeader } from '../components/nav.js';

function renderMatch(m) {
  const t1Names = m.team1.map(p => typeof p === 'string' ? p : p.name).join(' & ');
  const t2Names = m.team2.map(p => typeof p === 'string' ? p : p.name).join(' & ');
  return `<div style="padding:2px 0;font-size:var(--font-size-xs);color:var(--text-primary);">${t1Names} ${m.score1} – ${m.score2} ${t2Names}</div>`;
}

function renderEntries(log) {
  if (!log.length) {
    return `<div style="padding:var(--space-xl);text-align:center;color:var(--text-secondary);font-size:var(--font-size-sm);">
      No round results logged yet.
    </div>`;
  }
  return log.map(e => e.type === 'error' ? renderErrorEntry(e) : `
    <div style="padding:var(--space-sm) var(--space-md);border-bottom:1px solid var(--border-light);">
      <div style="font-size:var(--font-size-sm);font-weight:700;color:var(--text-primary);margin-bottom:2px;">${e.tournamentDate} Round ${e.roundNumber}</div>
      ${e.matches.map(renderMatch).join('')}
    </div>
  `).join('');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderErrorEntry(e) {
  const when = (e.ts || '').replace('T', ' ').replace(/\..*$/, '');
  return `
    <div style="padding:var(--space-sm) var(--space-md);border-bottom:1px solid var(--border-light);border-left:3px solid var(--danger, #e53935);">
      <div style="font-size:var(--font-size-sm);font-weight:700;color:var(--danger, #e53935);margin-bottom:2px;">⚠️ ${esc(e.context)} — ${esc(when)}</div>
      <div style="font-size:var(--font-size-xs);color:var(--text-primary);white-space:pre-wrap;word-break:break-word;">${esc(e.message)}</div>
    </div>
  `;
}

export function renderLogs(container) {
  const log = getRoundLog();

  container.innerHTML = `
    ${renderHeader('Round Logs', `
      <button id="clear-logs-btn" class="btn btn-danger btn-sm">🗑 Clear</button>
    `)}
    <div class="page-content">
      <div style="
        font-size:var(--font-size-xs);
        color:var(--text-secondary);
        margin-bottom:var(--space-sm);
      ">${log.length} entr${log.length === 1 ? 'y' : 'ies'} · localStorage only</div>
      <div id="round-log-list" style="
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
    clearRoundLog();
    container.querySelector('#round-log-list').innerHTML = renderEntries([]);
    container.querySelector('[style*="entr"]').textContent = '0 entries · localStorage only';
  });
}
