/**
 * Players hub (/players): master-detail. Left = every player with rich columns,
 * right = full inline profile of the selected player. Desktop only.
 */
import { Store } from '../store.js';
import { buildPlayerRows, buildPlayerDetail } from '../services/player-insights.js';
import { createDataGrid } from '../components/data-grid.js';
import { createLineChart, sparklineSvg } from '../components/chart.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (v, dp = 1) => `${v > 0 ? '+' : ''}${Number(v).toFixed(dp)}`;
const deltaCls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');

export function formatShortDate(d) {
  if (!d) return '—';
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
  } catch { return d; }
}

export function formStripHtml(form) {
  return `<span class="form-strip" title="${form.join('')}">${form.map(r => `<i class="${r === 'W' ? 'w' : ''}"></i>`).join('')}</span>`;
}

function setUrlParam(name) {
  const base = '#/players';
  const next = name ? `${base}?p=${encodeURIComponent(name)}` : base;
  if (window.location.hash !== next) history.replaceState(null, '', next);
}

export const PLAYER_COLUMNS = [
  { key: 'rank', label: '#', align: 'right', width: '36px', title: 'Rank by ELO' },
  { key: 'name', label: 'Player', type: 'str', html: (v) => `<b>${esc(v)}</b>` },
  { key: 'elo', label: 'ELO', align: 'right', format: (v) => Math.round(v) },
  { key: 'eloDelta', label: 'Δ10', align: 'right', title: 'ELO change over the last 10 tournaments',
    html: (v) => `<span class="${deltaCls(v)}">${signed(v)}</span>` },
  { key: 'spark', label: 'Trend', html: (v) => sparklineSvg(v, { width: 72, height: 20, color: 'trend' }) },
  { key: 'games', label: 'GP', align: 'right', title: 'Games played' },
  { key: 'winRate', label: 'Win%', align: 'right', format: (v) => v.toFixed(1) },
  { key: 'avgPoints', label: 'Avg', align: 'right', title: 'Average points per game', format: (v) => v.toFixed(1) },
  { key: 'tournaments', label: 'Trn', align: 'right', title: 'Tournaments played' },
  { key: 'firsts', label: '🥇', align: 'right', title: 'Tournament wins' },
  { key: 'podiums', label: 'Pod', align: 'right', title: 'Top-3 finishes' },
  { key: 'attendance', label: 'Att%', align: 'right', title: 'Attendance, last 10 tournaments' },
  { key: 'form', label: 'Form', html: (v) => formStripHtml(v) },
  { key: 'lastPlayed', label: 'Last', type: 'str', defaultDir: 'desc', format: formatShortDate },
];

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

function pick(label, entry, nameKey) {
  if (!entry) return `<div class="player-pick"><div class="player-pick-label">${label}</div><div class="player-pick-name muted">—</div></div>`;
  return `<div class="player-pick">
    <div class="player-pick-label">${label}</div>
    <div class="player-pick-name linklike" data-player="${esc(entry[nameKey])}">${esc(entry[nameKey])}</div>
    <div class="player-pick-sub">${entry.winRate.toFixed(0)}% · ${entry.wins}-${entry.losses} in ${entry.gamesPlayed}</div>
  </div>`;
}

function renderDetail(el, name, matches, row, onPlayer) {
  if (!name) {
    el.innerHTML = '<div class="panel"><div class="panel-body empty-state"><div class="empty-state-icon">👈</div><div class="empty-state-text">Select a player</div></div></div>';
    return () => {};
  }
  const d = buildPlayerDetail(name, matches);
  const s = d.summary;
  const gp = s.totalWins + s.totalLosses;
  const peak = d.eloHistory.reduce((m, p) => Math.max(m, p.elo), -Infinity);
  const avgPlace = d.tournaments.length ? (d.tournaments.reduce((a, t) => a + t.place, 0) / d.tournaments.length).toFixed(1) : '—';

  el.innerHTML = `
    <div class="stack">
      <div class="panel">
        <div class="panel-body stack">
          <div class="player-hero">
            <div>
              <h2>${esc(name)}</h2>
              <div class="text-sm text-secondary">Rank #${row?.rank ?? '—'} · last played ${formatShortDate(row?.lastPlayed)}</div>
            </div>
            <a class="btn btn-secondary btn-sm" href="#/players/compare?p=${encodeURIComponent(name)}">Compare…</a>
          </div>
          <div class="kpi-row">
            ${kpi('ELO', Math.round(row?.elo ?? 0), `<span class="${deltaCls(row?.eloDelta)}">${signed(row?.eloDelta ?? 0)} last 10</span>`)}
            ${kpi('Peak ELO', Number.isFinite(peak) ? Math.round(peak) : '—')}
            ${kpi('Win rate', `${gp ? ((s.totalWins / gp) * 100).toFixed(1) : 0}%`, `${s.totalWins}W – ${s.totalLosses}L`)}
            ${kpi('Avg pts', gp ? (s.totalPoints / gp).toFixed(1) : '—', `${s.totalPoints} total`)}
            ${kpi('Tournaments', s.totalTournaments, `avg place ${avgPlace}`)}
            ${kpi('Podiums', `${s.firstPlaceFinishes}/${s.secondPlaceFinishes}/${s.thirdPlaceFinishes}`, '🥇/🥈/🥉')}
            ${kpi('Win types', `${s.tightWins}/${s.solidWins}/${s.dominatingWins}`, 'tight/solid/dominant')}
          </div>
          <div class="player-picks">
            ${pick('Best partner', d.bestPartner, 'partnerName')}
            ${pick('Worst partner', d.worstPartner, 'partnerName')}
            ${pick('Nemesis', d.nemesis, 'opponentName')}
            ${pick('Favourite victim', d.favoriteVictim, 'opponentName')}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">ELO history</span><span class="panel-subtitle">${d.eloHistory.length} tournaments</span></div>
        <div class="panel-body" id="pd-elo"></div>
      </div>
      <div class="two-col">
        <div class="panel"><div class="panel-header"><span class="panel-title">Partners</span></div><div class="panel-body flush" id="pd-partners"></div></div>
        <div class="panel"><div class="panel-header"><span class="panel-title">Opponents</span></div><div class="panel-body flush" id="pd-opponents"></div></div>
      </div>
      <div class="two-col">
        <div class="panel"><div class="panel-header"><span class="panel-title">Tournaments</span></div><div class="panel-body flush" id="pd-tournaments"></div></div>
        <div class="panel"><div class="panel-header"><span class="panel-title">Recent matches</span></div><div class="panel-body flush" id="pd-recent"></div></div>
      </div>
    </div>`;

  const chart = createLineChart(el.querySelector('#pd-elo'), {
    xLabels: d.eloHistory.map(p => p.date),
    series: [{ label: name, color: '#60a5fa', values: d.eloHistory.map(p => p.elo) }],
    height: 260,
    formatX: formatShortDate,
  });

  const nameLink = (key) => (v) => `<span class="linklike" data-player="${esc(v)}">${esc(v)}</span>`;
  const pairCols = (key) => [
    { key, label: 'Player', type: 'str', html: nameLink(key) },
    { key: 'gamesPlayed', label: 'GP', align: 'right' },
    { key: 'wins', label: 'W', align: 'right' },
    { key: 'losses', label: 'L', align: 'right' },
    { key: 'winRate', label: 'Win%', align: 'right', format: (v) => v.toFixed(1) },
  ];
  const grids = [
    ['#pd-partners', createDataGrid({ columns: pairCols('partnerName'), rows: d.partners, rowKey: 'partnerName', sort: { key: 'gamesPlayed', dir: 'desc' }, maxHeight: '320px' })],
    ['#pd-opponents', createDataGrid({ columns: pairCols('opponentName'), rows: d.opponents, rowKey: 'opponentName', sort: { key: 'gamesPlayed', dir: 'desc' }, maxHeight: '320px' })],
    ['#pd-tournaments', createDataGrid({
      columns: [
        { key: 'date', label: 'Date', type: 'str', defaultDir: 'desc', html: (v) => `<a href="#/tournament/${v}">${formatShortDate(v)}</a>` },
        { key: 'place', label: 'Place', align: 'right', defaultDir: 'asc', format: (v, r) => `${v}/${r.of}` },
        { key: 'points', label: 'Pts', align: 'right' },
        { key: 'wins', label: 'W', align: 'right', format: (v, r) => `${v}/${r.games}` },
      ],
      rows: d.tournaments, rowKey: 'date', sort: { key: 'date', dir: 'desc' }, maxHeight: '320px',
    })],
    ['#pd-recent', createDataGrid({
      columns: [
        { key: 'date', label: 'Date', type: 'str', defaultDir: 'desc', format: (v, r) => `${formatShortDate(v)} R${r.round}` },
        { key: 'partner', label: 'With', type: 'str', html: nameLink('partner') },
        { key: 'opponents', label: 'Against', html: (v) => v.map(o => nameLink()(o)).join(' & ') },
        { key: 'score', label: 'Score', align: 'right', html: (v, r) => `<b class="${r.won ? 'pos' : 'neg'}">${v}–${r.oppScore}</b>` },
      ],
      rows: d.recentMatches.map((m, i) => ({ ...m, _i: i })), rowKey: '_i', sort: { key: '_i', dir: 'asc' }, maxHeight: '320px',
    })],
  ];
  grids.forEach(([sel, g]) => el.querySelector(sel).appendChild(g.el));

  el.onclick = (e) => {
    const link = e.target.closest('[data-player]');
    if (link) onPlayer(link.dataset.player);
  };
  el.scrollTop = 0;
  return () => chart.destroy();
}

export function renderPlayers(container, params = {}) {
  const matches = Store.getMatches();
  container.innerHTML = `
    <header class="page-header">
      <h1>Players</h1>
      <div class="flex items-center gap-sm">
        <a class="btn btn-primary btn-sm hidden" id="players-compare-btn" href="#/players/compare">Compare</a>
      </div>
    </header>
    <div class="page-content">
      <div class="split-view">
        <div class="panel split-master" id="players-master"></div>
        <div class="split-detail" id="players-detail"></div>
      </div>
    </div>`;

  const master = container.querySelector('#players-master');
  const detail = container.querySelector('#players-detail');
  const compareBtn = container.querySelector('#players-compare-btn');

  if (!matches.length) {
    master.innerHTML = `<div class="panel-body text-secondary">${Store.getSupabaseConfig() ? '⏳ Loading full match history…' : 'No match data'}</div>`;
    return () => {};
  }

  const allRows = buildPlayerRows(matches).map((r, i) => ({ ...r, rank: i + 1 }));
  const members = new Set((Store.getMembers() || []).map(n => n.toLowerCase()));
  let membersOnly = members.size > 0;
  const visible = () => (membersOnly ? allRows.filter(r => members.has(r.name.toLowerCase())) : allRows);
  const rowByName = new Map(allRows.map(r => [r.name, r]));

  let selected = params.p && rowByName.has(params.p) ? params.p : null;
  let cleanupDetail = () => {};

  function select(name) {
    if (!rowByName.has(name)) return;
    selected = name;
    grid.setSelected(name);
    setUrlParam(name);
    cleanupDetail();
    cleanupDetail = renderDetail(detail, name, matches, rowByName.get(name), select);
  }

  const grid = createDataGrid({
    columns: PLAYER_COLUMNS,
    rows: visible(),
    sort: { key: 'elo', dir: 'desc' },
    searchKeys: ['name'],
    rowKey: 'name',
    selectedKey: selected,
    multiSelect: true,
    onRowClick: (row) => select(row.name),
    onSelectionChange: (set) => {
      compareBtn.classList.toggle('hidden', set.size < 2);
      compareBtn.textContent = `Compare (${set.size})`;
      compareBtn.href = `#/players/compare?p=${[...set].map(encodeURIComponent).join(',')}`;
    },
    toolbarHtml: members.size ? `<label class="flex items-center gap-xs text-sm"><input type="checkbox" id="players-members-only" ${membersOnly ? 'checked' : ''} style="width:auto"> Members only</label>` : '',
    maxHeight: 'calc(100vh - 190px)',
  });
  master.appendChild(grid.el);
  grid.el.querySelector('#players-members-only')?.addEventListener('change', (e) => {
    membersOnly = e.target.checked;
    grid.setRows(visible());
  });

  if (!selected) {
    const me = Store.getCurrentUser?.();
    selected = rowByName.has(me) ? me : visible()[0]?.name ?? null;
  }
  if (selected) select(selected); else renderDetail(detail, null);

  return () => cleanupDetail();
}
