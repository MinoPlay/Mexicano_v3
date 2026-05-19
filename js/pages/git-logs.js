import { getRoundLog, clearRoundLog } from '../services/round-log.js';
import { renderHeader } from '../components/nav.js';

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      + ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function renderMatch(m) {
  const t1Names = m.team1.map(p => typeof p === 'string' ? p : p.name).join(' & ');
  const t2Names = m.team2.map(p => typeof p === 'string' ? p : p.name).join(' & ');
  const t1Win = m.score1 > m.score2;
  return `
    <div style="display:flex;align-items:center;gap:var(--space-sm);padding:4px 0;font-size:var(--font-size-xs);">
      <span style="flex:1;text-align:right;font-weight:${t1Win ? '700' : '400'};color:var(--text-primary);">${t1Names}</span>
      <span style="
        padding:2px 8px;
        border-radius:4px;
        background:var(--bg-tertiary);
        font-weight:700;
        font-size:var(--font-size-xs);
        color:var(--text-primary);
        white-space:nowrap;
      ">${m.score1} – ${m.score2}</span>
      <span style="flex:1;font-weight:${!t1Win ? '700' : '400'};color:var(--text-primary);">${t2Names}</span>
    </div>`;
}

function renderStandings(standings) {
  return `
    <table style="width:100%;border-collapse:collapse;font-size:var(--font-size-xs);margin-top:var(--space-xs);">
      <thead>
        <tr style="color:var(--text-tertiary);text-align:left;">
          <th style="padding:2px 4px;">#</th>
          <th style="padding:2px 4px;">Player</th>
          <th style="padding:2px 4px;text-align:right;">Pts</th>
          <th style="padding:2px 4px;text-align:right;">W</th>
          <th style="padding:2px 4px;text-align:right;">GP</th>
        </tr>
      </thead>
      <tbody>
        ${standings.map((p, i) => `
          <tr style="color:var(--text-primary);">
            <td style="padding:2px 4px;color:var(--text-tertiary);">${i + 1}</td>
            <td style="padding:2px 4px;">${p.name}</td>
            <td style="padding:2px 4px;text-align:right;font-weight:700;">${p.totalPoints}</td>
            <td style="padding:2px 4px;text-align:right;">${p.wins}</td>
            <td style="padding:2px 4px;text-align:right;">${p.gamesPlayed}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function renderEntries(log) {
  if (!log.length) {
    return `<div style="padding:var(--space-xl);text-align:center;color:var(--text-secondary);font-size:var(--font-size-sm);">
      No round results logged yet.
    </div>`;
  }
  return log.map(e => `
    <div style="
      padding:var(--space-md);
      border-bottom:1px solid var(--border-light);
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-xs);">
        <span style="
          font-size:var(--font-size-sm);
          font-weight:700;
          color:var(--text-primary);
        ">🏆 Round ${e.roundNumber} · ${e.tournamentDate}</span>
        <span style="font-size:var(--font-size-xs);color:var(--text-tertiary);">${formatTime(e.ts)}</span>
      </div>
      <div style="margin-bottom:var(--space-sm);">
        ${e.matches.map(renderMatch).join('')}
      </div>
      ${renderStandings(e.standings)}
    </div>
  `).join('');
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
