import {
  getEloHistoryForLatestTournament,
  getEloHistoryForPeriod,
  getEloHistoryForDateRange,
} from '../services/elo.js';
import { Store } from '../store.js';
import { getMembers } from '../services/members.js';

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

  // Minimal padding — no axis labels
  const pad = { top: title ? 28 : 10, right: 10, bottom: 10, left: 8 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const gridColor = cssVar('--border-light') || '#f1f5f9';
  const bgColor = cssVar('--bg-card') || '#ffffff';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  if (title) {
    ctx.fillStyle = cssVar('--text-primary') || '#0f172a';
    ctx.font = `600 13px ${cssVar('--font-family') || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 18);
  }

  // Horizontal grid lines only (no labels)
  const gridLines = 5;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridLines; i++) {
    const ratio = i / gridLines;
    const y = pad.top + plotH - ratio * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
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

// ─── Tooltip ───

function setupTooltip(canvas, formatLabel) {
  let tooltip = null;
  let stickyTooltip = null;

  function removeTooltip() {
    if (tooltip) { tooltip.remove(); tooltip = null; }
  }

  function removeStickyTooltip() {
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
    const deltaStr = closest.delta !== 0 ? ` · ${deltaSign}${closest.delta}` : '';
    const line1 = closest.label;
    const line2 = `${closest.pointLabel ? closest.pointLabel + ' · ' : ''}ELO ${Math.round(closest.value)}${deltaStr}`;

    el.style.cssText = `
      position:absolute;pointer-events:none;background:var(--text-primary);color:var(--bg);
      padding:5px 9px;border-radius:6px;font-size:11px;white-space:nowrap;z-index:${sticky ? 15 : 10};
      transform:translate(-50%,-100%);margin-top:-10px;line-height:1.4;
      ${sticky ? 'box-shadow:0 2px 8px rgba(0,0,0,.4);' : ''}
    `;
    el.innerHTML = `<div style="font-weight:600">${line1}</div><div style="opacity:.85">${line2}</div>`;

    const parent = canvas.parentElement;
    parent.style.position = 'relative';
    el.style.left = closest.x + 'px';
    el.style.top = closest.y + 'px';
    parent.appendChild(el);
    return el;
  }

  canvas.addEventListener('mousemove', e => {
    const closest = findClosest(e.clientX, e.clientY);
    removeTooltip();
    if (closest) tooltip = makeTooltipEl(closest, false);
  });

  canvas.addEventListener('mouseleave', removeTooltip);

  canvas.addEventListener('click', e => {
    const closest = findClosest(e.clientX, e.clientY);
    removeStickyTooltip();
    if (closest) {
      stickyTooltip = makeTooltipEl(closest, true);
      const dismiss = () => { removeStickyTooltip(); document.removeEventListener('click', dismiss); };
      setTimeout(() => document.addEventListener('click', dismiss, { once: true }), 0);
    }
  });

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const closest = findClosest(t.clientX, t.clientY);
      removeStickyTooltip();
      if (closest) {
        stickyTooltip = makeTooltipEl(closest, true);
        const dismiss = () => { removeStickyTooltip(); document.removeEventListener('touchstart', dismiss); };
        setTimeout(() => document.addEventListener('touchstart', dismiss, { once: true }), 0);
      }
    }
  }, { passive: true });

  return () => { removeTooltip(); removeStickyTooltip(); };
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

// ─── Section builder ───

function buildChartSection({ container, title, metaText, controls, pickerEl, canvasHeight = 220 }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:var(--space-lg);';

  // Section header
  const header = document.createElement('div');
  header.className = 'elo-section-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'elo-section-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);
  if (metaText) {
    const meta = document.createElement('span');
    meta.className = 'elo-section-meta';
    meta.textContent = metaText;
    header.appendChild(meta);
  }
  wrap.appendChild(header);

  // Controls row
  if (controls) wrap.appendChild(controls);

  // Member picker
  if (pickerEl) {
    pickerEl.style.padding = '0 var(--space-md)';
    wrap.appendChild(pickerEl);
  }

  // Chart box (full-bleed)
  const box = document.createElement('div');
  box.className = 'chart-container-bleed';
  const canvas = document.createElement('canvas');
  canvas.className = 'chart-canvas';
  canvas.style.width = '100%';
  canvas.style.height = `${canvasHeight}px`;
  box.appendChild(canvas);
  wrap.appendChild(box);

  // Legend placeholder
  const legendEl = document.createElement('div');
  wrap.appendChild(legendEl);

  container.appendChild(wrap);
  return { canvas, legendEl };
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
  let _chartCleanup = null;

  if (!allMatches.length) {
    const hasSummaryData = Store.getPlayersSummary().length > 0;

    if (hasSummaryData && Store.getGitHubConfig()?.pat) {
      content.style.paddingLeft = '';
      content.style.paddingRight = '';
      content.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Loading match history…</div>
        <p class="text-secondary text-sm">This may take a moment</p>
      </div>`;

      import('../services/github.js').then(({ ensureAllMatchesLoaded }) =>
        ensureAllMatchesLoaded()
      ).then(matches => {
        allMatches = matches;
        content.innerHTML = '';
        content.style.paddingLeft = '0';
        content.style.paddingRight = '0';
        _chartCleanup = renderChartContent();
      }).catch(() => {
        content.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <div class="empty-state-text">Failed to load match history</div>
        </div>`;
      });
      return () => { if (_chartCleanup) _chartCleanup(); };
    }

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
    const colorMap = getMemberColorMap(allMemberNames);

    const currentUser = Store.getCurrentUser();
    const selectedMembers = new Set();
    if (currentUser && allMemberNames.some(m => m.toLowerCase() === currentUser.toLowerCase())) {
      selectedMembers.add(allMemberNames.find(m => m.toLowerCase() === currentUser.toLowerCase()));
    } else {
      allMemberNames.forEach(m => selectedMembers.add(m));
    }

    // ── Smooth state (shared) ──
    let smooth = false;

    const cleanupFns = [];

    // ═══════════════════════════════════════════
    // Section 1: Latest Tournament
    // ═══════════════════════════════════════════

    const tournamentPickerEl = document.createElement('div');
    tournamentPickerEl.className = 'elo-member-picker';

    const { canvas: tCanvas, legendEl: tLegendEl } = buildChartSection({
      container: content,
      title: 'Latest Tournament',
      controls: null,
      pickerEl: tournamentPickerEl,
      canvasHeight: 220,
    });

    let tCleanupTooltip = null;
    let tResizeHandler = null;

    function renderTournamentChart() {
      if (tCleanupTooltip) { tCleanupTooltip(); tCleanupTooltip = null; }
      if (tResizeHandler) { window.removeEventListener('resize', tResizeHandler); tResizeHandler = null; }

      const history = getEloHistoryForLatestTournament(allMatches);
      filterHistoryToMembers(history);
      filterHistoryToSelected(history, selectedMembers);

      const datasets = buildDatasets(history, colorMap, pt => `Round ${pt.round}`);

      tLegendEl.innerHTML = '';
      if (!datasets.length) return;

      function draw() {
        drawLineChart(tCanvas, datasets, { xLabels: history.rounds || [], smooth });
      }
      requestAnimationFrame(draw);

      renderLegend(tLegendEl, datasets);
      tCleanupTooltip = setupTooltip(tCanvas);

      tResizeHandler = () => requestAnimationFrame(draw);
      window.addEventListener('resize', tResizeHandler);
    }

    function renderTournamentPicker() {
      renderMemberPicker(tournamentPickerEl, {
        allMembers: allMemberNames,
        selectedMembers,
        colorMap,
        onChange: () => { renderTournamentPicker(); renderTournamentChart(); renderHistoryChart(); renderHistoryPicker(); },
      });
    }

    renderTournamentPicker();
    renderTournamentChart();

    cleanupFns.push(() => {
      if (tCleanupTooltip) tCleanupTooltip();
      if (tResizeHandler) window.removeEventListener('resize', tResizeHandler);
    });

    // ═══════════════════════════════════════════
    // Section 2: ELO History
    // ═══════════════════════════════════════════

    // interval state
    let interval = '3m'; // '1m' | '3m' | '6m' | 'custom'
    let customFrom = '';
    let customTo = '';

    // Controls row
    const controlsRow = document.createElement('div');
    controlsRow.className = 'elo-controls';

    const intervals = [
      { id: '1m', label: '1M' },
      { id: '3m', label: '3M' },
      { id: '6m', label: '6M' },
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
        renderHistoryChart();
      });
      intervalBtns[id] = btn;
      controlsRow.appendChild(btn);
    });

    // Divider
    const divider = document.createElement('span');
    divider.className = 'elo-control-divider';
    controlsRow.appendChild(divider);

    // Smooth toggle
    const smoothBtn = document.createElement('button');
    smoothBtn.className = 'elo-control-btn' + (smooth ? ' active' : '');
    smoothBtn.title = 'Toggle smooth/rough lines';
    smoothBtn.textContent = smooth ? '〰' : '⟋';
    smoothBtn.addEventListener('click', () => {
      smooth = !smooth;
      smoothBtn.classList.toggle('active', smooth);
      smoothBtn.textContent = smooth ? '〰' : '⟋';
      renderTournamentChart();
      renderHistoryChart();
    });
    controlsRow.appendChild(smoothBtn);

    // Custom date range row
    const customRangeEl = document.createElement('div');
    customRangeEl.className = 'elo-custom-range';
    customRangeEl.style.display = 'none';

    const fromLabel = document.createElement('span');
    fromLabel.className = 'elo-custom-range-label';
    fromLabel.textContent = 'From';
    const fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.value = customFrom;
    fromInput.addEventListener('change', () => { customFrom = fromInput.value; renderHistoryChart(); });

    const toLabel = document.createElement('span');
    toLabel.className = 'elo-custom-range-label';
    toLabel.textContent = 'To';
    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.value = customTo;
    toInput.addEventListener('change', () => { customTo = toInput.value; renderHistoryChart(); });

    customRangeEl.appendChild(fromLabel);
    customRangeEl.appendChild(fromInput);
    customRangeEl.appendChild(toLabel);
    customRangeEl.appendChild(toInput);

    // Wrap controls + customRange into a single fragment for buildChartSection
    const controlsWrap = document.createElement('div');
    controlsWrap.appendChild(controlsRow);
    controlsWrap.appendChild(customRangeEl);

    const historyPickerEl = document.createElement('div');
    historyPickerEl.className = 'elo-member-picker';

    const { canvas: hCanvas, legendEl: hLegendEl } = buildChartSection({
      container: content,
      title: 'ELO History',
      controls: controlsWrap,
      pickerEl: historyPickerEl,
      canvasHeight: 260,
    });

    let hCleanupTooltip = null;
    let hResizeHandler = null;

    function getHistoryData() {
      if (interval === 'custom') {
        return getEloHistoryForDateRange(allMatches, customFrom || null, customTo || null);
      }
      const monthsMap = { '1m': 1, '3m': 3, '6m': 6 };
      return getEloHistoryForPeriod(allMatches, monthsMap[interval] ?? 3);
    }

    function renderHistoryChart() {
      if (hCleanupTooltip) { hCleanupTooltip(); hCleanupTooltip = null; }
      if (hResizeHandler) { window.removeEventListener('resize', hResizeHandler); hResizeHandler = null; }

      const history = getHistoryData();
      filterHistoryToMembers(history);
      filterHistoryToSelected(history, selectedMembers);

      const datasets = buildDatasets(history, colorMap, pt => pt.date ? formatDateShort(pt.date) : `Round ${pt.round}`);

      hLegendEl.innerHTML = '';
      if (!datasets.length) return;

      function draw() {
        drawLineChart(hCanvas, datasets, { xLabels: history.dates || [], smooth });
      }
      requestAnimationFrame(draw);

      renderLegend(hLegendEl, datasets);
      hCleanupTooltip = setupTooltip(hCanvas);

      hResizeHandler = () => requestAnimationFrame(draw);
      window.addEventListener('resize', hResizeHandler);
    }

    function renderHistoryPicker() {
      renderMemberPicker(historyPickerEl, {
        allMembers: allMemberNames,
        selectedMembers,
        colorMap,
        onChange: () => { renderHistoryPicker(); renderTournamentPicker(); renderTournamentChart(); renderHistoryChart(); },
      });
    }

    renderHistoryPicker();
    renderHistoryChart();

    cleanupFns.push(() => {
      if (hCleanupTooltip) hCleanupTooltip();
      if (hResizeHandler) window.removeEventListener('resize', hResizeHandler);
    });

    return () => cleanupFns.forEach(fn => fn());
  }

  return () => { if (_chartCleanup) _chartCleanup(); };
}
