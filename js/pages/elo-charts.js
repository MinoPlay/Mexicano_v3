import {
  getEloHistoryForLatestTournament,
  getEloHistoryForPeriod,
  getEloHistoryForDateRange,
} from '../services/elo.js';
import { Store } from '../store.js';
import { getMembers } from '../services/members.js';
import { pullEloHistoryForPlayerIds, getCachedEloHistoryForPlayerIds } from '../services/github.js';

// ─── Color Generator ───

// Prefixed color table: color is linked to the selected player's entry number
// (0-based selection order), NOT the player name. This guarantees the first
// selected players get maximally-distinct, hard-to-confuse colors.
// First 5 are very different from each other; entries 5–9 stay distinct too.
// Past 10 entries colors are generated (golden-angle hue spread).
export const ELO_ENTRY_COLORS = [
  '#e6194b', // 0 red
  '#3cb44b', // 1 green
  '#4363d8', // 2 blue
  '#911eb4', // 3 purple
  '#ffe119', // 4 yellow
  '#f58231', // 5 orange
  '#42d4f4', // 6 cyan
  '#f032e6', // 7 magenta
  '#9a6324', // 8 brown
  '#469990', // 9 teal
];

// Map an entry number (selection index) to its color.
export function colorForEntryIndex(i) {
  if (i < ELO_ENTRY_COLORS.length) return ELO_ENTRY_COLORS[i];
  // Deterministic spread using the golden angle so extra players stay distinct.
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue}, 70%, 50%)`;
}

// Build a name→color map from an ordered list of selected members.
// Entry number = first-seen position in the ordered list.
export function buildEntryColorMap(orderedNames) {
  const map = {};
  let idx = 0;
  for (const name of orderedNames) {
    if (Object.prototype.hasOwnProperty.call(map, name)) continue;
    map[name] = colorForEntryIndex(idx);
    idx++;
  }
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

  const { xLabels = [], yMin: rawYMin, yMax: rawYMax, title = '', smooth = false, showXLabels = false, showDeltas = false, firstPointDelta = false } = options;

  let allY = [];
  datasets.forEach(ds => ds.data.forEach(pt => allY.push(pt.y)));
  if (allY.length === 0) allY = [0];
  const dataYMin = Math.min(...allY);
  const dataYMax = Math.max(...allY);
  const yMin = rawYMin !== undefined ? rawYMin : Math.floor(dataYMin - (dataYMax - dataYMin) * 0.1);
  const yMax = rawYMax !== undefined ? rawYMax : Math.ceil(dataYMax + (dataYMax - dataYMin) * 0.1);
  const yRange = yMax - yMin || 1;

  // Padding: left space for Y-axis labels, bottom space for X-axis labels when shown
  const pad = { top: title ? 28 : 10, right: 10, bottom: showXLabels ? 22 : 10, left: 40 };
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

      // ELO change above each point; green up, red down.
      // First point (x===0) only labelled when firstPointDelta is set.
      if (showDeltas && (pt.x > 0 || firstPointDelta)) {
        const d = pt.delta ?? 0;
        const deltaStr = `${d > 0 ? '+' : ''}${d}`;
        ctx.fillStyle = d < 0
          ? (cssVar('--color-danger') || '#ef4444')
          : (cssVar('--color-success') || '#22c55e');
        ctx.font = `600 9px ${cssVar('--font-family') || 'sans-serif'}`;
        // Keep edge labels inside the chart (align at the edges).
        const isLast = pt.x >= xCount - 1;
        const isFirst = pt.x === 0;
        ctx.textAlign = isLast ? 'right' : (isFirst ? 'left' : 'center');
        ctx.textBaseline = 'bottom';
        const lx = isLast ? px + 6 : (isFirst ? px - 6 : px);
        ctx.fillText(deltaStr, lx, py - 6);
      }
    });
  });

  // X-axis labels (round numbers for Latest Tournament)
  if (showXLabels && xLabels.length) {
    ctx.fillStyle = textColor;
    ctx.font = `10px ${cssVar('--font-family') || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xLabels.forEach((label, xi) => {
      ctx.fillText(String(label), xPos(xi), pad.top + plotH + 6);
    });
  }

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

export function updateEloCache(cache, name) {
  const list = Array.isArray(cache) ? [...cache] : [];
  if (!name || list.includes(name)) return list;
  list.push(name);
  return list;
}

export function removeFromEloCache(cache, name) {
  const list = Array.isArray(cache) ? [...cache] : [];
  return list.filter(n => n !== name);
}

export function filterMemberSuggestions(allMembers, selectedMembers, query) {
  const q = (query || '').trim().toLowerCase();
  return allMembers
    .filter(m => !selectedMembers.has(m))
    .filter(m => q === '' || m.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));
}

function renderMemberPicker(container, { allMembers, selectedMembers, eloCache, colorMap, onToggle, onAdd, onRemove, onToggleRemoveMode, removeMode = false, addContainer }) {
  container.innerHTML = '';
  const addHost = addContainer || container;
  if (addContainer) addContainer.innerHTML = '';

  const cacheSet = new Set(eloCache);

  // Cache chips: greyed when deselected, highlighted when selected. Click toggles.
  // In remove mode each chip shows a "−" indicator and clicking removes it.
  eloCache.forEach(name => {
    const selected = selectedMembers.has(name);
    const chip = document.createElement('button');
    chip.className = 'elo-cache-chip' + (selected ? ' active' : '') + (removeMode ? ' removable' : '');

    const dot = document.createElement('span');
    dot.className = 'elo-member-chip-dot';
    dot.style.background = colorMap[name] || '#888';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(name));

    if (removeMode) {
      const rm = document.createElement('span');
      rm.className = 'elo-cache-chip-remove';
      rm.textContent = '−';
      chip.appendChild(rm);
      chip.addEventListener('click', () => onRemove(name));
    } else {
      chip.addEventListener('click', () => onToggle(name));
    }
    container.appendChild(chip);
  });

  const available = allMembers.filter(m => !cacheSet.has(m));
  if (available.length > 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'elo-add-member-wrapper' + (addContainer ? ' elo-header-add-wrapper' : '');

    const addBtn = document.createElement('button');
    addBtn.className = 'elo-add-member-btn' + (addContainer ? ' elo-header-add-btn' : '');
    addBtn.textContent = addContainer ? '+' : '+ Add';
    if (addContainer) addBtn.title = 'Add player';
    wrapper.appendChild(addBtn);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'elo-add-member-input';
    input.placeholder = 'Type name…';
    input.style.display = 'none';
    wrapper.appendChild(input);

    let dropdown = null;
    let activeIdx = -1;

    function closeDropdown() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
      activeIdx = -1;
    }

    function closeInput() {
      closeDropdown();
      input.value = '';
      input.style.display = 'none';
      addBtn.style.display = '';
    }

    function pick(name) {
      onAdd(name);
    }

    function renderSuggestions() {
      closeDropdown();
      const matches = filterMemberSuggestions(allMembers, cacheSet, input.value);
      dropdown = document.createElement('div');
      dropdown.className = 'elo-add-member-dropdown';

      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'elo-add-member-dropdown-empty';
        empty.textContent = input.value.trim() ? 'No match' : 'All members shown';
        dropdown.appendChild(empty);
      } else {
        matches.forEach((name, i) => {
          const item = document.createElement('div');
          item.className = 'elo-add-member-dropdown-item';
          item.textContent = name;
          item.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(name); });
          item.addEventListener('mouseenter', () => setActive(i));
          dropdown.appendChild(item);
        });
      }
      wrapper.appendChild(dropdown);
      activeIdx = -1;
    }

    function setActive(idx) {
      if (!dropdown) return;
      const items = [...dropdown.querySelectorAll('.elo-add-member-dropdown-item')];
      activeIdx = idx;
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    }

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addBtn.style.display = 'none';
      input.style.display = '';
      input.focus();
      renderSuggestions();
    });

    input.addEventListener('input', renderSuggestions);

    input.addEventListener('keydown', (e) => {
      const items = dropdown ? [...dropdown.querySelectorAll('.elo-add-member-dropdown-item')] : [];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) setActive((activeIdx + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) setActive((activeIdx - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const matches = filterMemberSuggestions(allMembers, cacheSet, input.value);
        const chosen = activeIdx >= 0 ? matches[activeIdx] : matches[0];
        if (chosen) pick(chosen);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeInput();
      }
    });

    input.addEventListener('click', (e) => e.stopPropagation());

    input.addEventListener('blur', () => {
      setTimeout(() => { if (document.activeElement !== input) closeInput(); }, 120);
    });

    addHost.appendChild(wrapper);
  }

  // Remove toggle: enters/exits remove mode. Shows "−" normally, "✓" (save) while active.
  if (eloCache.length > 0 && onToggleRemoveMode) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'elo-remove-toggle-btn' + (addContainer ? ' elo-header-remove-btn' : '') + (removeMode ? ' active' : '');
    removeBtn.textContent = removeMode ? '✓' : '−';
    removeBtn.title = removeMode ? 'Save changes' : 'Remove players';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); onToggleRemoveMode(); });
    addHost.appendChild(removeBtn);
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
  header.className = 'page-header elo-page-header';
  const headerTitle = document.createElement('h1');
  headerTitle.textContent = 'ELO Charts';
  const headerAddSlot = document.createElement('div');
  headerAddSlot.className = 'elo-header-add-slot';
  const headerDeltaSlot = document.createElement('div');
  headerDeltaSlot.className = 'elo-header-smooth-slot';
  const headerDeltaHistSlot = document.createElement('div');
  headerDeltaHistSlot.className = 'elo-header-smooth-slot';
  const headerControls = document.createElement('div');
  headerControls.className = 'elo-header-controls';
  headerControls.appendChild(headerDeltaSlot);
  headerControls.appendChild(headerDeltaHistSlot);
  headerControls.appendChild(headerAddSlot);
  header.appendChild(headerTitle);
  header.appendChild(headerControls);
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
    let colorMap = {};

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

    // Colors are keyed to selection (entry) order — see buildEntryColorMap.
    function rebuildColorMap() {
      colorMap = buildEntryColorMap([...selectedMembers]);
    }
    rebuildColorMap();

    // ── Smooth state (shared): lines always smooth ──
    const smooth = true;
    // ── Delta labels state — separate per chart, default off ──
    let showDeltasTournament = prefs['delta-labels-tournament'] === true;
    let showDeltasHistory = prefs['delta-labels-history'] === true;

    const cleanupFns = [];

    // ── ELO Cache: rolling last-5 quick-toggle chips (combined with + Add) ──
    let eloCache = Array.isArray(prefs['elo-cache']) ? [...prefs['elo-cache']] : [];
    if (eloCache.length === 0) {
      [...selectedMembers].forEach(name => { eloCache = updateEloCache(eloCache, name); });
    }
    eloCache = eloCache.filter(name => allMemberNames.includes(name));

    function persistCache() {
      const p = loadPrefs();
      p['elo-cache'] = eloCache;
      savePrefs(p);
    }

    function refreshSelection() {
      persistMembers();
      rebuildColorMap();
      renderSharedPicker();
      renderTournamentChart();
      loadSelectedPlayerHistories();
    }

    // ── Combined row: cache toggle chips (+ Add lives in the page header) ──
    const sharedPickerEl = document.createElement('div');
    sharedPickerEl.className = 'elo-member-picker elo-cache-picker';
    sharedPickerEl.style.cssText = 'padding:var(--space-sm) var(--space-md);';
    content.appendChild(sharedPickerEl);

    function toggleMember(name) {
      if (selectedMembers.has(name)) {
        if (selectedMembers.size <= 1) return;
        selectedMembers.delete(name);
      } else {
        selectedMembers.add(name);
      }
      refreshSelection();
    }

    function addMember(name) {
      eloCache = updateEloCache(eloCache, name);
      selectedMembers.add(name);
      persistCache();
      refreshSelection();
    }

    // Remove mode: click "−" to enter, chips show "−" and become clickable to remove;
    // click "✓" to persist the trimmed cache and exit.
    let removeMode = false;

    function removeCachedMember(name) {
      eloCache = removeFromEloCache(eloCache, name);
      selectedMembers.delete(name);
      if (selectedMembers.size === 0 && eloCache.length) {
        selectedMembers.add(eloCache[0]);
      }
      persistMembers();
      rebuildColorMap();
      renderSharedPicker();
      renderTournamentChart();
      loadSelectedPlayerHistories();
    }

    function toggleRemoveMode() {
      removeMode = !removeMode;
      if (!removeMode) persistCache();
      renderSharedPicker();
    }

    function renderSharedPicker() {
      renderMemberPicker(sharedPickerEl, {
        allMembers: allMemberNames,
        selectedMembers,
        eloCache,
        colorMap,
        addContainer: headerAddSlot,
        onToggle: toggleMember,
        onAdd: addMember,
        onRemove: removeCachedMember,
        onToggleRemoveMode: toggleRemoveMode,
        removeMode,
      });
    }

    // ── Delta labels toggles: separate for Latest Tournament & ELO History ──
    const deltaBtn = document.createElement('button');
    deltaBtn.className = 'elo-header-smooth-btn' + (showDeltasTournament ? ' active' : '');
    deltaBtn.title = 'Toggle Latest Tournament ELO change labels';
    deltaBtn.textContent = 'Δᴸ';
    deltaBtn.addEventListener('click', () => {
      showDeltasTournament = !showDeltasTournament;
      deltaBtn.classList.toggle('active', showDeltasTournament);
      const p = loadPrefs(); p['delta-labels-tournament'] = showDeltasTournament; savePrefs(p);
      renderTournamentChart();
    });
    headerDeltaSlot.appendChild(deltaBtn);

    const deltaHistBtn = document.createElement('button');
    deltaHistBtn.className = 'elo-header-smooth-btn' + (showDeltasHistory ? ' active' : '');
    deltaHistBtn.title = 'Toggle ELO History change labels';
    deltaHistBtn.textContent = 'Δᴴ';
    deltaHistBtn.addEventListener('click', () => {
      showDeltasHistory = !showDeltasHistory;
      deltaHistBtn.classList.toggle('active', showDeltasHistory);
      const p = loadPrefs(); p['delta-labels-history'] = showDeltasHistory; savePrefs(p);
      renderHistoryChart();
    });
    headerDeltaHistSlot.appendChild(deltaHistBtn);

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

      // Seed pre-tournament ELOs from players.json PreviousELO (= ELO before latest tournament).
      // Avoids full match history replay which fails when allMatches is incomplete in localStorage.
      const seedElos = {};
      for (const [, player] of playerByName) {
        if (player.name && player.previousElo != null) seedElos[player.name] = player.previousElo;
      }

      const history = getEloHistoryForLatestTournament(
        allMatches, [...selectedMembers], Object.keys(seedElos).length ? seedElos : null
      );
      filterHistoryToMembers(history);
      filterHistoryToSelected(history, selectedMembers);
      setTournamentMeta(latestDate ? `Date: ${latestDate}` : 'Date: —');

      const datasets = buildDatasets(history, colorMap, pt => `Round ${pt.round}`);

      if (!datasets.length) {
        drawEmptyChart(tCanvas, 'No tournament data');
        return;
      }

      function draw() {
        drawLineChart(tCanvas, datasets, { xLabels: history.rounds || [], smooth, showXLabels: true, showDeltas: showDeltasTournament });
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
        drawLineChart(hCanvas, datasets, { xLabels: history.dates || [], smooth, showDeltas: showDeltasHistory, firstPointDelta: interval !== 'all' });
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
