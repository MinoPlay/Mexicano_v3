import {
  getEloHistoryForLatestTournament,
  getEloHistoryForPeriod,
  getEloHistoryForDateRange,
} from '../services/elo.js';
import { Store } from '../store.js';
import { getMembers } from '../services/members.js';
import { pullEloHistoryForPlayerIds, getCachedEloHistoryForPlayerIds } from '../services/github.js';

// ─── Color Generator ───

function generateColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = Math.round((360 / count) * i);
    colors.push(`hsl(${hue}, 70%, 50%)`);
  }
  return colors;
}

function getMemberColorMap(members) {
  const sorted = [...members].sort((a, b) => a.localeCompare(b));
  const colors = generateColors(sorted.length);
  const map = {};
  sorted.forEach((name, i) => { map[name] = colors[i]; });
  return map;
}

// ─── Reusable Line Chart ───

function drawLineChart(canvas, datasets, options = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  const { xLabels = [], yMin: rawYMin, yMax: rawYMax, title = '', smooth = false } = options;

  let allY = [];
  datasets.forEach(ds => ds.data.forEach(pt => allY.push(pt.y)));
  if (allY.length === 0) allY = [0];
  const dataYMin = Math.min(...allY);
  const dataYMax = Math.max(...allY);
  const yMin = rawYMin !== undefined ? rawYMin : Math.floor(dataYMin - (dataYMax - dataYMin) * 0.1);
  const yMax = rawYMax !== undefined ? rawYMax : Math.ceil(dataYMax + (dataYMax - dataYMin) * 0.1);
  const yRange = yMax - yMin || 1;

  // Padding: left space for Y-axis labels
  const pad = { top: title ? 28 : 10, right: 10, bottom: 10, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const textColor = cssVar('--text-secondary') || '#64748b';
  const gridColor = 'rgba(148, 163, 184, 0.25)';
  const bgColor = cssVar('--bg-card') || '#ffffff';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  if (title) {
    ctx.fillStyle = cssVar('--text-primary') || '#0f172a';
    ctx.font = `600 13px ${cssVar('--font-family') || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 18);
  }

  // Horizontal grid lines + Y-axis labels
  const gridLines = 5;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = textColor;
  ctx.font = `10px ${cssVar('--font-family') || 'sans-serif'}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= gridLines; i++) {
    const ratio = i / gridLines;
    const y = pad.top + plotH - ratio * plotH;
    const val = yMin + ratio * yRange;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = i === 0 ? 1 : 0.5;
    ctx.setLineDash(i === 0 ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(Math.round(val).toString(), pad.left - 4, y);
  }

  const xCount = xLabels.length || 1;

  function xPos(xi) {
    return pad.left + (xCount <= 1 ? plotW / 2 : (xi / (xCount - 1)) * plotW);
  }
  function yPos(val) {
    return pad.top + plotH - ((val - yMin) / yRange) * plotH;
  }

  // Plot each dataset
  datasets.forEach(ds => {
    if (ds.data.length === 0) return;
    ctx.strokeStyle = ds.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    ds.data.forEach((pt, idx) => {
      const px = xPos(pt.x);
      const py = yPos(pt.y);

      if (idx === 0) {
        ctx.moveTo(px, py);
      } else if (smooth && idx > 0) {
        const prev = ds.data[idx - 1];
        const ppx = xPos(prev.x);
        const ppy = yPos(prev.y);
        const cpx = (ppx + px) / 2;
        ctx.bezierCurveTo(cpx, ppy, cpx, py, px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();

    // Dots
    ds.data.forEach(pt => {
      const px = xPos(pt.x);
      const py = yPos(pt.y);
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = ds.color;
      ctx.fill();
    });
  });

  canvas._chartMeta = { pad, plotW, plotH, yMin, yRange, xCount, datasets, xLabels };
}

function drawEmptyChart(canvas, message) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const bgColor = cssVar('--bg-card') || '#ffffff';
  const textColor = cssVar('--text-secondary') || '#64748b';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = textColor;
  ctx.font = `500 12px ${cssVar('--font-family') || 'sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, W / 2, H / 2);
  canvas._chartMeta = null;
}

// ─── Tooltip ───

function setupTooltip(canvas, formatLabel) {
  let stickyTooltip = null;
  let stickyDismiss = null;

  function removeStickyTooltip() {
    if (stickyDismiss) { document.removeEventListener('click', stickyDismiss); stickyDismiss = null; }
    if (stickyTooltip) { stickyTooltip.remove(); stickyTooltip = null; }
  }

  function findClosest(clientX, clientY) {
    const meta = canvas._chartMeta;
    if (!meta) return null;

    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    let closest = null;
    let minDist = 24;

    meta.datasets.forEach(ds => {
      ds.data.forEach(pt => {
        const px = meta.pad.left + (meta.xCount <= 1 ? meta.plotW / 2 : (pt.x / Math.max(meta.xCount - 1, 1)) * meta.plotW);
        const py = meta.pad.top + meta.plotH - ((pt.y - meta.yMin) / meta.yRange) * meta.plotH;
        const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = { label: ds.label, value: pt.y, delta: pt.delta ?? 0, pointLabel: pt.label, x: px, y: py, color: ds.color };
        }
      });
    });

    return closest;
  }

  function makeTooltipEl(closest, sticky = false) {
    const el = document.createElement('div');
    const deltaSign = closest.delta > 0 ? '+' : '';
    const deltaStr = closest.delta !== 0 ? `${deltaSign}${closest.delta}` : '—';
    const pointLabelStr = closest.pointLabel || '';

    el.style.cssText = `
      position:absolute;pointer-events:none;background:var(--text-primary);color:var(--bg);
      padding:6px 10px;border-radius:6px;font-size:11px;white-space:nowrap;z-index:${sticky ? 15 : 10};
      transform:translate(-50%,-100%);margin-top:-10px;line-height:1.6;
      ${sticky ? 'box-shadow:0 2px 8px rgba(0,0,0,.4);' : ''}
    `;
    el.innerHTML = `
      <div style="font-weight:700;margin-bottom:2px">${closest.label}</div>
      ${pointLabelStr ? `<div>${pointLabelStr}</div>` : ''}
      <div>${Math.round(closest.value)}</div>
      <div>${deltaStr}</div>
    `;

    const parent = canvas.parentElement;
    parent.style.position = 'relative';
    el.style.left = closest.x + 'px';
    el.style.top = closest.y + 'px';
    parent.appendChild(el);

    // Clamp to parent container after layout
    const tip = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    let flipBelow = false;
    if (tip.right > parentRect.right - margin) dx = parentRect.right - margin - tip.right;
    if (tip.left + dx < parentRect.left + margin) dx = parentRect.left + margin - tip.left;
    if (tip.top < parentRect.top + margin) flipBelow = true;
    const shiftX = `calc(-50% + ${dx}px)`;
    el.style.transform = flipBelow ? `translate(${shiftX}, 10px)` : `translate(${shiftX}, -100%)`;
    if (flipBelow) el.style.marginTop = '0';

    return el;
  }

  canvas.addEventListener('mousemove', e => {
    const closest = findClosest(e.clientX, e.clientY);
    canvas.style.cursor = closest ? 'pointer' : '';
  });

  canvas.addEventListener('click', e => {
    e.stopPropagation();
    const closest = findClosest(e.clientX, e.clientY);
    removeStickyTooltip();
    if (closest) {
      stickyTooltip = makeTooltipEl(closest, true);
      stickyDismiss = () => { removeStickyTooltip(); };
      setTimeout(() => document.addEventListener('click', stickyDismiss, { once: true }), 0);
    }
  });

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      e.stopPropagation();
      const t = e.touches[0];
      const closest = findClosest(t.clientX, t.clientY);
      removeStickyTooltip();
      if (closest) {
        stickyTooltip = makeTooltipEl(closest, true);
        stickyDismiss = () => { removeStickyTooltip(); };
        setTimeout(() => document.addEventListener('touchstart', stickyDismiss, { once: true }), 0);
      }
    }
  }, { passive: true });

  return () => { removeStickyTooltip(); };
}

// ─── Legend ───

function renderLegend(container, datasets) {
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 14px;padding:6px var(--space-md) 8px;font-size:12px;';
  datasets.forEach(ds => {
    const item = document.createElement('span');
    item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${ds.color};flex-shrink:0;`;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(ds.label));
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

// ─── Filter history to Members list ───

function filterHistoryToMembers(history) {
  const members = getMembers();
  if (!members.length || !history.players) return;
  const memberSet = new Set(members.map(m => m.toLowerCase()));
  for (const name of Object.keys(history.players)) {
    if (!memberSet.has(name.toLowerCase())) delete history.players[name];
  }
}

function filterHistoryToSelected(history, selectedNames) {
  if (!history.players) return;
  const sel = new Set([...selectedNames].map(n => n.toLowerCase()));
  for (const name of Object.keys(history.players)) {
    if (!sel.has(name.toLowerCase())) delete history.players[name];
  }
}

// ─── Build datasets ───

function buildDatasets(history, colorMap, labelFn) {
  const players = Object.keys(history.players || {});
  const xKeys = history.dates || history.rounds || [];

  return players.map(name => ({
    label: name,
    color: colorMap[name] || '#888',
    data: (history.players[name] || []).map(pt => {
      const keyVal = pt.date !== undefined ? pt.date : pt.round;
      return {
        x: xKeys.indexOf(keyVal),
        y: pt.elo,
        delta: pt.delta ?? 0,
        label: labelFn(pt),
      };
    }),
  }));
}

function formatDateShort(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

// ─── Member Picker ───

function renderMemberPicker(container, { allMembers, selectedMembers, colorMap, onChange }) {
  container.innerHTML = '';

  [...selectedMembers].sort((a, b) => a.localeCompare(b)).forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'elo-member-chip';

    const dot = document.createElement('span');
    dot.className = 'elo-member-chip-dot';
    dot.style.background = colorMap[name] || '#888';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(name));

    if (selectedMembers.size > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'elo-member-chip-remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = `Remove ${name}`;
      removeBtn.addEventListener('click', () => { selectedMembers.delete(name); onChange(); });
      chip.appendChild(removeBtn);
    }

    container.appendChild(chip);
  });

  const available = allMembers.filter(m => !selectedMembers.has(m));
  if (available.length > 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'elo-add-member-wrapper';

    const addBtn = document.createElement('button');
    addBtn.className = 'elo-add-member-btn';
    addBtn.textContent = '+ Add';
    wrapper.appendChild(addBtn);

    let dropdown = null;

    function closeDropdown() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
    }

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown) { closeDropdown(); return; }

      dropdown = document.createElement('div');
      dropdown.className = 'elo-add-member-dropdown';

      const cur = allMembers.filter(m => !selectedMembers.has(m));
      if (cur.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'elo-add-member-dropdown-empty';
        empty.textContent = 'All members shown';
        dropdown.appendChild(empty);
      } else {
        cur.sort((a, b) => a.localeCompare(b)).forEach(name => {
          const item = document.createElement('div');
          item.className = 'elo-add-member-dropdown-item';
          item.textContent = name;
          item.addEventListener('click', () => { selectedMembers.add(name); closeDropdown(); onChange(); });
          dropdown.appendChild(item);
        });
      }

      wrapper.appendChild(dropdown);
      setTimeout(() => document.addEventListener('click', () => closeDropdown(), { once: true }), 0);
    });

    container.appendChild(wrapper);
  }
}

// ─── ELO History Adapters (from pre-computed per-player files) ───

function mergePlayerHistoryFiles(files) {
  const players = {};
  const dateSet = new Set();

  for (const file of files || []) {
    if (!file?.playerName || !Array.isArray(file.points)) continue;
    const points = file.points
      .filter(p => p?.date && p.elo != null)
      .map(p => ({ date: p.date, elo: p.elo, delta: p.delta ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    players[file.playerName] = points;
    points.forEach(p => dateSet.add(p.date));
  }

  return {
    players,
    dates: [...dateSet].sort(),
  };
}

function eloHistoryForPeriod(eloData, months) {
  if (!eloData || !eloData.dates) return { players: {}, dates: [] };
  let dates = eloData.dates;
  if (months) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    dates = dates.filter(d => d >= cutoffStr);
  }
  const dateSet = new Set(dates);
  const players = {};
  for (const [name, points] of Object.entries(eloData.players)) {
    const pts = points.filter(p => dateSet.has(p.date));
    if (pts.length > 0) players[name] = pts;
  }
  return { players, dates };
}

function eloHistoryForDateRange(eloData, fromStr, toStr) {
  if (!eloData || !eloData.dates) return { players: {}, dates: [] };
  const dates = eloData.dates.filter(d => (!fromStr || d >= fromStr) && (!toStr || d <= toStr));
  const dateSet = new Set(dates);
  const players = {};
  for (const [name, points] of Object.entries(eloData.players)) {
    const pts = points.filter(p => dateSet.has(p.date));
    if (pts.length > 0) players[name] = pts;
  }
  return { players, dates };
}

/**
 * Derive seed ELOs from per-player history data for the latest tournament.
 * For each player, returns their last known ELO strictly before latestDate.
 * Players with no prior history are omitted (they'll start at 1000 via processMatchElo).
 */
function getSeedElosFromHistory(historyData, latestDate) {
  if (!historyData?.players || !latestDate) return null;
  const seeds = {};
  for (const [name, points] of Object.entries(historyData.players)) {
    if (!Array.isArray(points)) continue;
    const prior = points.filter(p => p.date < latestDate);
    if (prior.length > 0) seeds[name] = prior[prior.length - 1].elo;
  }
  return Object.keys(seeds).length > 0 ? seeds : null;
}



// ─── localStorage helpers ───

const LS_KEY = 'elo-charts-prefs';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
}

// ─── Section builder ───

function buildChartSection({ container, title, metaText, controls, canvasHeight = 220, storageKey, onToggle }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:var(--space-lg);';

  // Section header — acts as collapse toggle
  const header = document.createElement('div');
  header.className = 'elo-section-header elo-section-header--collapsible';
  header.style.cursor = 'pointer';
  header.style.userSelect = 'none';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const chevron = document.createElement('span');
  chevron.className = 'elo-section-chevron';
  chevron.textContent = '▾';
  const titleEl = document.createElement('span');
  titleEl.className = 'elo-section-title';
  titleEl.textContent = title;
  titleRow.appendChild(chevron);
  titleRow.appendChild(titleEl);
  header.appendChild(titleRow);

  const meta = document.createElement('span');
  meta.className = 'elo-section-meta';
  meta.textContent = metaText || '';
  meta.style.display = metaText ? '' : 'none';
  header.appendChild(meta);

  if (metaText) {
    meta.style.display = '';
  } else {
    meta.style.display = 'none';
  }
  wrap.appendChild(header);

  function setMetaText(text) {
    meta.textContent = text || '';
    meta.style.display = text ? '' : 'none';
  }

  // Collapsible body
  const body = document.createElement('div');
  body.className = 'elo-section-body';

  // Controls row
  if (controls) body.appendChild(controls);

  // Chart box (full-bleed)
  const box = document.createElement('div');
  box.className = 'chart-container-bleed';
  const canvas = document.createElement('canvas');
  canvas.className = 'chart-canvas';
  canvas.style.width = '100%';
  canvas.style.height = `${canvasHeight}px`;
  box.appendChild(canvas);
  body.appendChild(box);

  wrap.appendChild(body);
  container.appendChild(wrap);

  // Collapse logic
  const prefs = loadPrefs();
  let collapsed = storageKey ? (prefs[storageKey + '-collapsed'] === true) : false;

  function applyCollapse(animate = false) {
    chevron.textContent = collapsed ? '▶' : '▼';
    chevron.style.color = collapsed ? 'var(--color-primary)' : '';
    if (animate) {
      body.style.transition = 'opacity 0.15s ease';
    }
    body.style.display = collapsed ? 'none' : '';
    body.style.opacity = collapsed ? '0' : '1';
    if (onToggle) onToggle(collapsed);
  }

  applyCollapse(false);

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapse(true);
    if (storageKey) {
      const p = loadPrefs();
      p[storageKey + '-collapsed'] = collapsed;
      savePrefs(p);
    }
  });

  return { canvas, setMetaText };
}

function getLatestTournamentDateForSelection(allMatches, selectedNames = []) {
  const validMatches = (allMatches || []).filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  if (!validMatches.length) return null;

  const dates = [...new Set(validMatches.map(m => m.date))].sort();
  if (!selectedNames.length) return dates[dates.length - 1] || null;

  const selected = new Set(selectedNames.map(n => String(n || '').toLowerCase()));
  const isInvolved = (m) =>
    [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
      .some(n => selected.has(String(n || '').toLowerCase()));

  const involvedDates = dates.filter(d => validMatches.some(m => m.date === d && isInvolved(m)));
  return (involvedDates[involvedDates.length - 1] || dates[dates.length - 1] || null);
}

// ─── Main Render ───

export function renderEloCharts(container, params = {}) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = '<h1>ELO Charts</h1>';
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'page-content';
  content.style.paddingLeft = '0';
  content.style.paddingRight = '0';
  container.appendChild(content);

  let allMatches = Store.getMatches();
  let eloHistoryData = null;
  let _chartCleanup = null;
  const tournamentChartRef = { render: null };

  const playersSummary = Store.getPlayersSummary();
  const needsPlayersPull = !playersSummary.length && Store.getGitHubConfig()?.pat;

  if (needsPlayersPull) {
    content.style.paddingLeft = '';
    content.style.paddingRight = '';
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⏳</div>
      <div class="empty-state-text">Loading player data…</div>
      <p class="text-secondary text-sm">This may take a moment</p>
    </div>`;

    import('../services/github.js').then(({ pullForRoute }) =>
      pullForRoute('#/elo-charts')
    ).then(() => {
      allMatches = Store.getMatches();
      content.innerHTML = '';
      content.style.paddingLeft = '0';
      content.style.paddingRight = '0';
      _chartCleanup = renderChartContent();
    }).catch(() => {
      content.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <div class="empty-state-text">Failed to load player data</div>
      </div>`;
    });
    return () => { if (_chartCleanup) _chartCleanup(); };
  }

  if (!playersSummary.length && !allMatches.length) {
    content.style.paddingLeft = '';
    content.style.paddingRight = '';
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📈</div>
      <div class="empty-state-text">No ELO data yet</div>
      <p class="text-secondary text-sm">Play some tournaments first</p>
    </div>`;
    return;
  }

  _chartCleanup = renderChartContent();

  function renderChartContent() {
    const allMemberNames = getMembers();
    const playersSummary = Store.getPlayersSummary();
    const playerByName = new Map(playersSummary.map(p => [String(p.name || '').toLowerCase(), p]));
    const playerNameById = new Map(playersSummary
      .filter(p => p && p.id)
      .map(p => [String(p.id), String(p.name || '')]));
    const colorMap = getMemberColorMap(allMemberNames);

    // Load persisted prefs
    const prefs = loadPrefs();
    const savedMembers = prefs['selected-members'];

    const currentUser = Store.getCurrentUser();
    const selectedMembers = new Set();

    if (savedMembers && Array.isArray(savedMembers) && savedMembers.length > 0) {
      // Restore saved selection, keeping only still-valid members
      const validSet = new Set(allMemberNames.map(m => m.toLowerCase()));
      savedMembers.forEach(name => {
        const exact = allMemberNames.find(m => m.toLowerCase() === name.toLowerCase());
        if (exact && validSet.has(name.toLowerCase())) selectedMembers.add(exact);
      });
    }

    if (selectedMembers.size === 0) {
      if (currentUser && allMemberNames.some(m => m.toLowerCase() === currentUser.toLowerCase())) {
        selectedMembers.add(allMemberNames.find(m => m.toLowerCase() === currentUser.toLowerCase()));
      } else {
        allMemberNames.forEach(m => selectedMembers.add(m));
      }
    }

    function persistMembers() {
      const p = loadPrefs();
      p['selected-members'] = [...selectedMembers];
      savePrefs(p);
    }

    // ── Smooth state (shared) ──
    let smooth = prefs['smooth'] === true;

    const cleanupFns = [];

    // ── Shared member picker (above both sections) ──
    const sharedPickerEl = document.createElement('div');
    sharedPickerEl.className = 'elo-member-picker';
    sharedPickerEl.style.cssText = 'padding:var(--space-sm) var(--space-md);';
    content.appendChild(sharedPickerEl);

    function renderSharedPicker() {
      renderMemberPicker(sharedPickerEl, {
        allMembers: allMemberNames,
        selectedMembers,
        colorMap,
        onChange: () => { persistMembers(); renderSharedPicker(); renderTournamentChart(); loadSelectedPlayerHistories(); },
      });
    }

    // ── Shared controls bar: smooth toggle only (applies to both charts) ──
    const sharedControlsEl = document.createElement('div');
    sharedControlsEl.className = 'elo-controls';
    sharedControlsEl.style.cssText = 'padding:0 var(--space-md) var(--space-xs);';
    content.appendChild(sharedControlsEl);

    const smoothBtn = document.createElement('button');
    smoothBtn.className = 'elo-control-btn' + (smooth ? ' active' : '');
    smoothBtn.title = 'Toggle smooth/rough lines';
    smoothBtn.textContent = smooth ? '〰 Smooth' : '⟋ Straight';
    smoothBtn.addEventListener('click', () => {
      smooth = !smooth;
      smoothBtn.classList.toggle('active', smooth);
      smoothBtn.textContent = smooth ? '〰 Smooth' : '⟋ Straight';
      const p = loadPrefs(); p['smooth'] = smooth; savePrefs(p);
      renderTournamentChart();
      renderHistoryChart();
    });
    sharedControlsEl.appendChild(smoothBtn);

    // ── Interval controls (ELO History only) ──
    let interval = prefs['interval'] || '3m';
    let customFrom = prefs['custom-from'] || '';
    let customTo = prefs['custom-to'] || '';

    const historyControlsWrap = document.createElement('div');

    const intervalRow = document.createElement('div');
    intervalRow.className = 'elo-controls';

    const intervals = [
      { id: '1m', label: '1M' },
      { id: '3m', label: '3M' },
      { id: '6m', label: '6M' },
      { id: 'all', label: 'All' },
      { id: 'custom', label: 'Custom' },
    ];

    const intervalBtns = {};
    intervals.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className = 'elo-control-btn' + (interval === id ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        interval = id;
        Object.entries(intervalBtns).forEach(([k, b]) => b.classList.toggle('active', k === id));
        customRangeEl.style.display = id === 'custom' ? 'flex' : 'none';
        const p = loadPrefs(); p['interval'] = interval; savePrefs(p);
        renderHistoryChart();
      });
      intervalBtns[id] = btn;
      intervalRow.appendChild(btn);
    });

    const customRangeEl = document.createElement('div');
    customRangeEl.className = 'elo-custom-range';
    customRangeEl.style.display = interval === 'custom' ? 'flex' : 'none';

    const fromLabel = document.createElement('span');
    fromLabel.className = 'elo-custom-range-label';
    fromLabel.textContent = 'From';
    const fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.value = customFrom;
    fromInput.addEventListener('change', () => {
      customFrom = fromInput.value;
      const p = loadPrefs(); p['custom-from'] = customFrom; savePrefs(p);
      renderHistoryChart();
    });

    const toLabel = document.createElement('span');
    toLabel.className = 'elo-custom-range-label';
    toLabel.textContent = 'To';
    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.value = customTo;
    toInput.addEventListener('change', () => {
      customTo = toInput.value;
      const p = loadPrefs(); p['custom-to'] = customTo; savePrefs(p);
      renderHistoryChart();
    });

    customRangeEl.appendChild(fromLabel);
    customRangeEl.appendChild(fromInput);
    customRangeEl.appendChild(toLabel);
    customRangeEl.appendChild(toInput);

    historyControlsWrap.appendChild(intervalRow);
    historyControlsWrap.appendChild(customRangeEl);
    const historyNoticeEl = document.createElement('div');
    historyNoticeEl.className = 'text-sm text-secondary';
    historyNoticeEl.style.cssText = 'padding:4px 0 0;display:none;';
    historyControlsWrap.appendChild(historyNoticeEl);

    // ═══════════════════════════════════════════
    // Section 1: Latest Tournament
    // ═══════════════════════════════════════════

    const { canvas: tCanvas, setMetaText: setTournamentMeta } = buildChartSection({
      container: content,
      title: 'Latest Tournament',
      metaText: '',
      controls: null,
      canvasHeight: 220,
      storageKey: 'tournament',
    });

    let tCleanupTooltip = null;
    let tResizeHandler = null;

    function renderTournamentChart() {
      if (tCleanupTooltip) { tCleanupTooltip(); tCleanupTooltip = null; }
      if (tResizeHandler) { window.removeEventListener('resize', tResizeHandler); tResizeHandler = null; }

      const latestDate = getLatestTournamentDateForSelection(allMatches, [...selectedMembers]);
      const seedElos = getSeedElosFromHistory(eloHistoryData, latestDate);
      const history = getEloHistoryForLatestTournament(allMatches, [...selectedMembers], seedElos);
      filterHistoryToMembers(history);
      filterHistoryToSelected(history, selectedMembers);
      setTournamentMeta(latestDate ? `Date: ${latestDate}` : 'Date: —');

      const datasets = buildDatasets(history, colorMap, pt => `Round ${pt.round}`);

      if (!datasets.length) {
        drawEmptyChart(tCanvas, 'No tournament data');
        return;
      }

      function draw() {
        drawLineChart(tCanvas, datasets, { xLabels: history.rounds || [], smooth });
      }
      requestAnimationFrame(draw);

      tCleanupTooltip = setupTooltip(tCanvas);

      tResizeHandler = () => requestAnimationFrame(draw);
      window.addEventListener('resize', tResizeHandler);
    }

    renderTournamentChart();
    tournamentChartRef.render = renderTournamentChart;

    cleanupFns.push(() => {
      if (tCleanupTooltip) tCleanupTooltip();
      if (tResizeHandler) window.removeEventListener('resize', tResizeHandler);
    });

    // ═══════════════════════════════════════════
    // Section 2: ELO History
    // ═══════════════════════════════════════════

    const { canvas: hCanvas } = buildChartSection({
      container: content,
      title: 'ELO History',
      controls: historyControlsWrap,
      canvasHeight: 260,
      storageKey: 'history',
    });

    let hCleanupTooltip = null;
    let hResizeHandler = null;
    let historyLoadToken = 0;
    let missingSelectedNames = [];

    function setHistoryNotice(text, isWarning = false) {
      historyNoticeEl.textContent = text || '';
      historyNoticeEl.style.display = text ? '' : 'none';
      historyNoticeEl.style.color = isWarning ? 'var(--color-warning, #f59e0b)' : 'var(--text-secondary, #64748b)';
    }

    function getHistoryData() {
      if (!eloHistoryData) return { players: {}, dates: [] };
      if (interval === 'custom') return eloHistoryForDateRange(eloHistoryData, customFrom || null, customTo || null);
      if (interval === 'all') return eloHistoryForPeriod(eloHistoryData, null);
      const monthsMap = { '1m': 1, '3m': 3, '6m': 6 };
      return eloHistoryForPeriod(eloHistoryData, monthsMap[interval] ?? 3);
    }

    async function loadSelectedPlayerHistories() {
      const token = ++historyLoadToken;
      const selectedIds = [...selectedMembers]
        .map(name => playerByName.get(String(name || '').toLowerCase())?.id)
        .filter(Boolean);

      if (selectedIds.length === 0) {
        eloHistoryData = { players: {}, dates: [] };
        renderHistoryChart();
        renderTournamentChart();
        return;
      }

      try {
        const { missingPlayerIds = [] } = await pullEloHistoryForPlayerIds(selectedIds);
        if (token !== historyLoadToken) return;
        const files = getCachedEloHistoryForPlayerIds(selectedIds);
        eloHistoryData = mergePlayerHistoryFiles(files);
        missingSelectedNames = missingPlayerIds
          .map(id => playerNameById.get(String(id)))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      } catch {
        if (token !== historyLoadToken) return;
        eloHistoryData = { players: {}, dates: [] };
        missingSelectedNames = [];
      }
      renderHistoryChart();
      renderTournamentChart();
    }

    function renderHistoryChart() {
      if (hCleanupTooltip) { hCleanupTooltip(); hCleanupTooltip = null; }
      if (hResizeHandler) { window.removeEventListener('resize', hResizeHandler); hResizeHandler = null; }

      const history = getHistoryData();
      filterHistoryToMembers(history);
      filterHistoryToSelected(history, selectedMembers);

      const datasets = buildDatasets(history, colorMap, pt => pt.date ? formatDateShort(pt.date) : `Round ${pt.round}`);

      if (missingSelectedNames.length > 0) {
        setHistoryNotice(`No ELO history file for: ${missingSelectedNames.join(', ')}`, true);
      } else if (!datasets.length) {
        setHistoryNotice('No ELO history data for selected player(s). Generate history in Settings.');
      } else {
        setHistoryNotice('');
      }

      if (!datasets.length) {
        drawEmptyChart(hCanvas, 'No ELO history data');
        return;
      }

      function draw() {
        drawLineChart(hCanvas, datasets, { xLabels: history.dates || [], smooth });
      }
      requestAnimationFrame(draw);

      hCleanupTooltip = setupTooltip(hCanvas);

      hResizeHandler = () => requestAnimationFrame(draw);
      window.addEventListener('resize', hResizeHandler);
    }

    renderSharedPicker();
    loadSelectedPlayerHistories();

    cleanupFns.push(() => {
      if (hCleanupTooltip) hCleanupTooltip();
      if (hResizeHandler) window.removeEventListener('resize', hResizeHandler);
    });

    return () => cleanupFns.forEach(fn => fn());
  }

  return () => { if (_chartCleanup) _chartCleanup(); };
}
