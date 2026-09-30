/**
 * Player compare (/players/compare?p=a,b,c): KPI table side by side,
 * overlaid ELO history and pairwise head-to-head.
 */
import { Store } from '../store.js';
import { buildPlayerRows, buildHeadToHead, buildPlayerDetail } from '../services/player-insights.js';
import { createLineChart, paletteColor } from '../components/chart.js';
import { formatShortDate, formStripHtml } from './players.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function parseCompareNames(param) {
  return [...new Set(String(param || '').split(',').map(s => s.trim()).filter(Boolean))];
}

/** Align per-player ELO histories onto a shared date axis (null where not played, carried forward after first). */
export function alignEloSeries(histories) {
  const dates = [...new Set(histories.flatMap(h => h.points.map(p => p.date)))].sort();
  const series = histories.map(h => {
    const byDate = new Map(h.points.map(p => [p.date, p.elo]));
    let last = null;
    return { label: h.name, values: dates.map(d => { if (byDate.has(d)) last = byDate.get(d); return last; }) };
  });
  return { dates, series };
}

const KPI_ROWS = [
  ['ELO', r => Math.round(r.elo), 'max'],
  ['Δ last 10', r => r.eloDelta, 'max'],
  ['Games', r => r.games, null],
  ['Win %', r => r.winRate, 'max'],
  ['Avg points', r => r.avgPoints, 'max'],
  ['Tournaments', r => r.tournaments, null],
  ['Wins 🥇', r => r.firsts, 'max'],
  ['Podiums', r => r.podiums, 'max'],
  ['Attendance %', r => r.attendance, 'max'],
];

export function renderPlayerCompare(container, params = {}) {
  const matches = Store.getMatches();
  const allRows = buildPlayerRows(matches);
  const rowBy = new Map(allRows.map(r => [r.name, r]));
  let names = parseCompareNames(params.p).filter(n => rowBy.has(n));

  container.innerHTML = `
    <header class="page-header">
      <h1>Compare players</h1>
      <div class="flex items-center gap-sm">
        <input list="compare-player-list" id="compare-add" placeholder="Add player…" style="width:200px">
        <datalist id="compare-player-list">${allRows.map(r => `<option value="${esc(r.name)}">`).join('')}</datalist>
        <a class="btn btn-ghost btn-sm" href="#/players">← Players</a>
      </div>
    </header>
    <div class="page-content" id="compare-body"></div>`;

  const body = container.querySelector('#compare-body');
  let chart = null;

  function go(next) {
    window.location.hash = `/players/compare?p=${next.map(encodeURIComponent).join(',')}`;
  }

  container.querySelector('#compare-add').addEventListener('change', (e) => {
    const n = e.target.value.trim();
    if (rowBy.has(n) && !names.includes(n)) go([...names, n]);
  });

  if (!matches.length) {
    body.innerHTML = `<div class="panel"><div class="panel-body text-secondary">${Store.getSupabaseConfig() ? '⏳ Loading full match history…' : 'No match data'}</div></div>`;
    return () => {};
  }
  if (names.length === 0) {
    body.innerHTML = '<div class="panel"><div class="panel-body empty-state"><div class="empty-state-text">Add players to compare</div></div></div>';
    return () => {};
  }

  const colors = Object.fromEntries(names.map((n, i) => [n, paletteColor(i)]));
  const rows = names.map(n => rowBy.get(n));
  const kpiHtml = KPI_ROWS.map(([label, fn, best]) => {
    const vals = rows.map(fn);
    const top = best === 'max' ? Math.max(...vals) : null;
    return `<tr><th>${label}</th>${vals.map(v => `<td class="align-right num${best && v === top && rows.length > 1 ? ' pos text-bold' : ''}">${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : v}</td>`).join('')}</tr>`;
  }).join('') + `<tr><th>Form</th>${rows.map(r => `<td class="align-right">${formStripHtml(r.form)}</td>`).join('')}</tr>`;

  const pairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) pairs.push([names[i], names[j], buildHeadToHead(names[i], names[j], matches)]);
  }

  body.innerHTML = `
    <div class="dash-grid">
      <div class="panel span-5">
        <div class="panel-header"><span class="panel-title">Key numbers</span></div>
        <div class="panel-body flush data-grid"><div class="data-grid-scroll"><table>
          <thead><tr><th></th>${names.map(n => `<th class="align-right"><span class="chart-legend-dot" style="background:${colors[n]}"></span> ${esc(n)} <button class="btn btn-ghost btn-sm" data-remove="${esc(n)}" title="Remove">✕</button></th>`).join('')}</tr></thead>
          <tbody>${kpiHtml}</tbody>
        </table></div></div>
      </div>
      <div class="panel span-7">
        <div class="panel-header"><span class="panel-title">ELO history</span></div>
        <div class="panel-body" id="compare-elo"></div>
      </div>
      <div class="panel span-12">
        <div class="panel-header"><span class="panel-title">Head-to-head</span><span class="panel-subtitle">against each other / as partners</span></div>
        <div class="panel-body flush data-grid"><div class="data-grid-scroll"><table>
          <thead><tr><th>Pair</th><th class="align-right">Met</th><th class="align-right">Record</th><th class="align-right">Together</th><th class="align-right">Together W-L</th><th class="align-right">Together Win%</th></tr></thead>
          <tbody>${pairs.length ? pairs.map(([a, b, h]) => `<tr>
            <td><b>${esc(a)}</b> vs <b>${esc(b)}</b></td>
            <td class="align-right">${h.against.games}</td>
            <td class="align-right"><span class="${h.against.aWins > h.against.bWins ? 'pos' : h.against.aWins < h.against.bWins ? 'neg' : ''}">${h.against.aWins}–${h.against.bWins}</span></td>
            <td class="align-right">${h.together.games}</td>
            <td class="align-right">${h.together.wins}–${h.together.games - h.together.wins}</td>
            <td class="align-right">${h.together.games ? h.together.winRate.toFixed(1) : '—'}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="data-grid-empty">Add at least two players</td></tr>'}</tbody>
        </table></div></div>
      </div>
    </div>`;

  body.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => go(names.filter(n => n !== btn.dataset.remove))));

  const aligned = alignEloSeries(names.map(n => ({ name: n, points: buildPlayerDetail(n, matches).eloHistory })));
  chart = createLineChart(body.querySelector('#compare-elo'), {
    xLabels: aligned.dates,
    series: aligned.series.map(s => ({ ...s, color: colors[s.label] })),
    height: 360,
    formatX: formatShortDate,
  });

  return () => chart?.destroy();
}
