import { Store } from '../store.js';
import { createDataGrid } from '../components/data-grid.js';
import { buildTournamentRows } from '../services/player-insights.js';

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function statusBadge(entry) {
  if (!entry) return '';
  if (entry.isComplete) return '<span class="badge badge-success">Complete</span>';
  if (entry.completedCount > 0) return `<span class="badge badge-warning">${entry.completedCount}/${entry.matchCount}</span>`;
  return '<span class="badge badge-primary">Pending</span>';
}

export function renderTournaments(container, params) {
  const index = Store.getTournamentsIndex();
  const sorted = [...index].sort((a, b) => b.date.localeCompare(a.date));

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (n) => n ? `<a href="#/players?p=${encodeURIComponent(n)}" onclick="event.stopPropagation()">${esc(n)}</a>` : '<span class="text-secondary">—</span>';
  const COLUMNS = [
    { key: 'date', label: 'Date', type: 'str', html: (v) => `<b>${esc(formatDate(v))}</b>` },
    { key: 'players', label: 'Players', align: 'right' },
    { key: 'rounds', label: 'Rounds', align: 'right' },
    { key: 'matches', label: 'Matches', align: 'right' },
    { key: 'totalPoints', label: 'Points', align: 'right', title: 'Total points scored' },
    { key: 'winner', label: 'Winner', type: 'str', html: (v, r) => v ? `🥇 ${link(v)} <span class="text-xs text-secondary">${r.winnerPoints}</span>` : link(null) },
    { key: 'runnerUp', label: 'Runner-up', type: 'str', html: (v) => link(v) },
    { key: 'status', label: 'Status', type: 'str', html: (v, r) => statusBadge(index.find(e => e.date === r.date) || sorted.find(e => e.date === r.date)) },
  ];

  function renderPreview(side, row) {
    if (!row) { side.innerHTML = '<p class="text-sm text-secondary">Select a tournament to preview.</p>'; return; }
    const ranked = Store.getMatches().filter(m => m.date === row.date);
    const tally = {};
    for (const m of ranked) {
      if (!(Number(m.scoreTeam1) || Number(m.scoreTeam2))) continue;
      const add = (n, pts, won) => { tally[n] = tally[n] || { pts: 0, w: 0, g: 0 }; tally[n].pts += pts; tally[n].w += won ? 1 : 0; tally[n].g++; };
      [m.team1Player1Name, m.team1Player2Name].forEach(n => add(n, m.scoreTeam1, m.scoreTeam1 > m.scoreTeam2));
      [m.team2Player1Name, m.team2Player2Name].forEach(n => add(n, m.scoreTeam2, m.scoreTeam2 > m.scoreTeam1));
    }
    const board = Object.entries(tally).sort(([, a], [, b]) => b.pts - a.pts || b.w - a.w);
    side.innerHTML = `
      <div class="flex items-center justify-between mb-sm">
        <div><div class="panel-title">${esc(formatDate(row.date))}</div>
        <div class="text-xs text-secondary">${row.players} players · ${row.rounds} rounds · ${row.matches} matches</div></div>
        <a class="btn btn-primary btn-sm" href="#/tournament/${row.date}">Open ▸</a>
      </div>
      ${board.length ? `<table class="data-table compact"><thead><tr><th>#</th><th>Player</th><th class="text-right">Pts</th><th class="text-right">W</th><th class="text-right">GP</th></tr></thead>
        <tbody>${board.map(([n, t], i) => `<tr><td>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td>${link(n)}</td><td class="text-right">${t.pts}</td><td class="text-right">${t.w}</td><td class="text-right">${t.g}</td></tr>`).join('')}</tbody></table>`
        : '<p class="text-sm text-secondary">No match history loaded for this date.</p>'}`;
  }

  function renderList() {
    const list = container.querySelector('#tournament-list');
    if (!list) return;
    if (sorted.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏆</div>
          <div class="empty-state-text">No tournaments yet</div>
          <p class="text-sm text-secondary">Create your first tournament to get started</p>
          <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
        </div>
      `;
      return;
    }
    const allRows = buildTournamentRows(sorted, Store.getMatches());
    const years = [...new Set(allRows.map(r => r.year))];
    let year = 'all';
    let selected = null;
    list.innerHTML = `<div class="tournaments-desktop">
      <section class="panel"><div class="panel-body flush" id="tournaments-grid"></div></section>
      <aside class="panel tournament-side"><div class="panel-body" id="tournament-preview"></div></aside>
    </div>`;
    const side = list.querySelector('#tournament-preview');
    const filtered = () => allRows.filter(r => year === 'all' || r.year === year);
    const grid = createDataGrid({
      columns: COLUMNS,
      rows: filtered(),
      rowKey: 'date',
      sort: { key: 'date', dir: 'desc' },
      searchKeys: ['date', 'winner', 'runnerUp'],
      toolbarHtml: `<select id="tournaments-year" style="width:auto"><option value="all">All years</option>${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select>`,
      emptyText: 'No tournaments match',
      maxHeight: 'calc(100vh - 170px)',
      onRowClick: (row) => {
        if (selected === row.date) { window.location.hash = `/tournament/${row.date}`; return; }
        selected = row.date;
        grid.setSelected(row.date);
        renderPreview(side, row);
      },
    });
    list.querySelector('#tournaments-grid').appendChild(grid.el);
    grid.el.querySelector('#tournaments-year').addEventListener('change', (e) => { year = e.target.value; grid.setRows(filtered()); });
    renderPreview(side, null);
  }

  container.innerHTML = `
    <header class="page-header">
      <h1>Tournaments</h1>
      <span class="text-sm text-secondary">click a row to preview · click again to open</span>
      ${Store.getSupabaseConfig() && !Store.isMatchesFullyLoaded() ? '<button class="btn btn-secondary btn-sm" id="tournaments-load-results" style="margin-left:auto">Load results</button>' : ''}
    </header>
    <div class="page-content">
      <div id="tournament-list">
        ${index.length === 0 ? `
          <div id="tournaments-loading" class="text-sm text-secondary text-center" style="padding:var(--space-md);">
            ${Store.getSupabaseConfig() ? '⏳ Loading…' : `
              <div class="empty-state">
                <div class="empty-state-icon">🏆</div>
                <div class="empty-state-text">No tournaments yet</div>
                <p class="text-sm text-secondary">Create your first tournament to get started</p>
                <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    </div>
    <a href="#/create-tournament" class="fab" aria-label="Create tournament">+</a>
  `;

  container.querySelector('#tournaments-load-results')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '⏳ Loading…';
    try {
      const { pullForRoute } = await import('../services/backend.js');
      await pullForRoute('#/__full__');
      if (!btn.isConnected) return;
      btn.remove();
      renderList();
    } catch (err) {
      btn.textContent = `Failed: ${err.message}`;
    }
  });

  if (index.length > 0) {
    renderList();
    return;
  }

  // If index is empty and Supabase is configured, lazy-fetch tournaments.
  if (Store.getSupabaseConfig()) {
    const loadingEl = container.querySelector('#tournaments-loading');
    import('../services/backend.js')
      .then(({ fetchTournamentsIndexPublic }) => fetchTournamentsIndexPublic())
      .then(() => {
        if (!loadingEl?.isConnected) return;
        const fresh = Store.getTournamentsIndex();
        if (fresh.length > 0) {
          sorted.length = 0;
          fresh.sort((a, b) => b.date.localeCompare(a.date)).forEach(e => sorted.push(e));
          renderList();
        } else {
          if (loadingEl?.isConnected) {
            loadingEl.innerHTML = `
              <div class="empty-state">
                <div class="empty-state-icon">🏆</div>
                <div class="empty-state-text">No tournaments yet</div>
                <p class="text-sm text-secondary">Create your first tournament to get started</p>
                <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
              </div>
            `;
          }
        }
      })
      .catch(() => {
        if (loadingEl?.isConnected) loadingEl.textContent = 'Failed to load tournaments';
      });
  }
}
