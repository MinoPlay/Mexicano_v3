/**
 * Pair heatmap panel: partner / opponent win% matrix for the most active players.
 */
import { Store } from '../store.js';
import { buildPairMatrix, buildPlayerRows } from '../services/player-insights.js';
import { heatColor } from './chart.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Most active players: attendance in recent window desc, then games desc. */
export function pickActivePlayers(rows, n = 20) {
  return [...rows]
    .sort((a, b) => b.attendance - a.attendance || b.games - a.games || a.name.localeCompare(b.name))
    .slice(0, n)
    .map(r => r.name);
}

export function renderPairHeatmap(panelBody) {
  let mode = 'partner';
  let size = 20;

  function draw() {
    const matches = Store.getMatches();
    const rows = buildPlayerRows(matches);
    const names = pickActivePlayers(rows, size).sort((a, b) => a.localeCompare(b));
    const { cells } = buildPairMatrix(matches, names, mode);
    panelBody.innerHTML = `
      <div class="flex items-center gap-sm" style="margin-bottom:var(--space-sm)">
        <button class="chip${mode === 'partner' ? ' selected' : ''}" data-mode="partner">As partners</button>
        <button class="chip${mode === 'opponent' ? ' selected' : ''}" data-mode="opponent">Against (row vs column)</button>
        <select id="heat-size" style="width:auto">${[10, 15, 20, 30].map(v => `<option value="${v}" ${v === size ? 'selected' : ''}>Top ${v} active</option>`).join('')}</select>
        <span class="text-xs text-secondary">Cell = row player's win% · hover for record · click a name for profile</span>
      </div>
      <div class="heatmap-wrap"><table class="heatmap">
        <thead><tr><th></th>${names.map(n => `<th><a href="#/players?p=${encodeURIComponent(n)}">${esc(n)}</a></th>`).join('')}</tr></thead>
        <tbody>${names.map(a => `<tr><th><a href="#/players?p=${encodeURIComponent(a)}">${esc(a)}</a></th>${names.map(b => {
          if (a === b) return '<td class="diag"></td>';
          const c = cells[a][b];
          if (!c) return '<td class="empty">·</td>';
          const title = `${a} ${mode === 'partner' ? 'with' : 'vs'} ${b}: ${c.wins}-${c.games - c.wins} (${c.winRate.toFixed(0)}%)`;
          return `<td style="background:${heatColor(c.winRate)}" title="${esc(title)}">${Math.round(c.winRate)}<sub class="muted">${c.games}</sub></td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    panelBody.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; draw(); }));
    panelBody.querySelector('#heat-size').addEventListener('change', (e) => { size = Number(e.target.value); draw(); });
  }

  const needsFull = Store.getSupabaseConfig() && !Store.isMatchesFullyLoaded();
  if (!needsFull) { draw(); return; }
  panelBody.innerHTML = `<div class="flex items-center gap-sm">
    <span class="text-sm text-secondary">Needs full match history.</span>
    <button class="btn btn-secondary btn-sm" id="heat-load">Load full history</button></div>`;
  panelBody.querySelector('#heat-load').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = '⏳ Loading…';
    try {
      const { pullForRoute } = await import('../services/backend.js');
      await pullForRoute('#/__full__');
      if (panelBody.isConnected) draw();
    } catch (err) {
      e.target.textContent = `Failed: ${err.message}`;
    }
  });
}
