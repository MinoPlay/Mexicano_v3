import { getEloHistoryAllTime, getEloHistoryForLatestTournament } from '../services/elo.js';
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

// Stable color assignment: each member always gets the same color
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

  const { xLabels = [], yMin: rawYMin, yMax: rawYMax, title = '' } = options;

  // Compute y range from data
  let allY = [];
  datasets.forEach(ds => ds.data.forEach(pt => allY.push(pt.y)));
  if (allY.length === 0) allY = [0];
  const dataYMin = Math.min(...allY);
  const dataYMax = Math.max(...allY);
  const yMin = rawYMin !== undefined ? rawYMin : Math.floor(dataYMin - (dataYMax - dataYMin) * 0.1);
  const yMax = rawYMax !== undefined ? rawYMax : Math.ceil(dataYMax + (dataYMax - dataYMin) * 0.1);
  const yRange = yMax - yMin || 1;

  // Layout
  const pad = { top: title ? 30 : 14, right: 14, bottom: 44, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Style helpers
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const textColor = cssVar('--text-secondary') || '#64748b';
  const gridColor = cssVar('--border-light') || '#f1f5f9';
  const bgColor = cssVar('--bg-card') || '#ffffff';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Title
  if (title) {
    ctx.fillStyle = cssVar('--text-primary') || '#0f172a';
    ctx.font = `600 13px ${cssVar('--font-family') || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 18);
  }

  // Grid lines + Y labels
  const gridLines = 5;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = textColor;
  ctx.font = `11px ${cssVar('--font-family') || 'sans-serif'}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= gridLines; i++) {
    const ratio = i / gridLines;
    const y = pad.top + plotH - ratio * plotH;
    const val = yMin + ratio * yRange;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(Math.round(val).toString(), pad.left - 6, y);
  }

  // X labels
  const xCount = xLabels.length || 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const maxLabels = Math.floor(plotW / 50);
  const step = Math.max(1, Math.ceil(xCount / maxLabels));

  for (let i = 0; i < xCount; i++) {
    const x = pad.left + (xCount === 1 ? plotW / 2 : (i / (xCount - 1)) * plotW);
    if (i % step === 0 || i === xCount - 1) {
      ctx.fillStyle = textColor;
      ctx.save();
      ctx.translate(x, pad.top + plotH + 6);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(xLabels[i] || '', 0, 0);
      ctx.restore();
    }
  }

  // Plot each dataset
  datasets.forEach(ds => {
    if (ds.data.length === 0) return;
    ctx.strokeStyle = ds.color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    ds.data.forEach((pt, idx) => {
      const xPos = pad.left + (xCount <= 1 ? plotW / 2 : (pt.x / Math.max(xCount - 1, 1)) * plotW);
      const yPos = pad.top + plotH - ((pt.y - yMin) / yRange) * plotH;
      if (idx === 0) ctx.moveTo(xPos, yPos);
      else ctx.lineTo(xPos, yPos);
    });
    ctx.stroke();

    // Dots
    ds.data.forEach(pt => {
      const xPos = pad.left + (xCount <= 1 ? plotW / 2 : (pt.x / Math.max(xCount - 1, 1)) * plotW);
      const yPos = pad.top + plotH - ((pt.y - yMin) / yRange) * plotH;
      ctx.beginPath();
      ctx.arc(xPos, yPos, 3, 0, Math.PI * 2);
      ctx.fillStyle = ds.color;
      ctx.fill();
    });
  });

  // Store plot info for tooltip hit-testing
  canvas._chartMeta = { pad, plotW, plotH, yMin, yRange, xCount, datasets };
}

// ─── Tooltip ───

function setupTooltip(canvas) {
  let tooltip = null;

  function removeTooltip() {
    if (tooltip) { tooltip.remove(); tooltip = null; }
  }

  function handleInteraction(clientX, clientY) {
    const meta = canvas._chartMeta;
    if (!meta) return;

    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    let closest = null;
    let minDist = 20;

    meta.datasets.forEach(ds => {
      ds.data.forEach(pt => {
        const xPos = meta.pad.left + (meta.xCount <= 1 ? meta.plotW / 2 : (pt.x / Math.max(meta.xCount - 1, 1)) * meta.plotW);
        const yPos = meta.pad.top + meta.plotH - ((pt.y - meta.yMin) / meta.yRange) * meta.plotH;
        const dx = mx - xPos, dy = my - yPos;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closest = { label: ds.label, value: pt.y, x: xPos, y: yPos, color: ds.color };
        }
      });
    });

    removeTooltip();
    if (closest) {
      tooltip = document.createElement('div');
      tooltip.style.cssText = `
        position:absolute;pointer-events:none;background:var(--text-primary);color:var(--bg);
        padding:4px 8px;border-radius:4px;font-size:11px;white-space:nowrap;z-index:10;
        transform:translate(-50%,-100%);margin-top:-8px;
      `;
      tooltip.textContent = `${closest.label}: ${Math.round(closest.value)}`;
      const parent = canvas.parentElement;
      parent.style.position = 'relative';
      tooltip.style.left = closest.x + 'px';
      tooltip.style.top = closest.y + 'px';
      parent.appendChild(tooltip);
    }
  }

  canvas.addEventListener('mousemove', e => handleInteraction(e.clientX, e.clientY));
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      handleInteraction(t.clientX, t.clientY);
    }
  }, { passive: true });
  canvas.addEventListener('mouseleave', removeTooltip);

  return removeTooltip;
}

// ─── Legend ───

function renderLegend(container, datasets) {
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;padding:8px 0;font-size:12px;';
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
    if (!memberSet.has(name.toLowerCase())) {
      delete history.players[name];
    }
  }
}

// ─── Filter history to selected members ───

function filterHistoryToSelected(history, selectedNames) {
  if (!history.players) return;
  const selectedLower = new Set([...selectedNames].map(n => n.toLowerCase()));
  for (const name of Object.keys(history.players)) {
    if (!selectedLower.has(name.toLowerCase())) {
      delete history.players[name];
    }
  }
}

// ─── Build datasets from ELO history ───

function buildAllTimeDatasets(history, colorMap) {
  const players = Object.keys(history.players || {});
  const dates = history.dates || [];

  return {
    datasets: players.map(name => ({
      label: name,
      color: colorMap[name] || '#888',
      data: (history.players[name] || []).map(pt => ({
        x: dates.indexOf(pt.date),
        y: pt.elo,
      })),
    })),
    xLabels: dates.map(d => {
      try {
        return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      } catch { return d; }
    }),
  };
}

function buildTournamentDatasets(history, colorMap) {
  const players = Object.keys(history.players || {});
  const rounds = history.rounds || [];

  return {
    datasets: players.map(name => ({
      label: name,
      color: colorMap[name] || '#888',
      data: (history.players[name] || []).map(pt => ({
        x: rounds.indexOf(pt.round),
        y: pt.elo,
      })),
    })),
    xLabels: rounds.map(r => `Round ${r}`),
  };
}

// ─── Member Picker ───

function renderMemberPicker(container, { allMembers, selectedMembers, colorMap, onChange }) {
  container.innerHTML = '';

  // Chips for selected members
  [...selectedMembers].sort((a, b) => a.localeCompare(b)).forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'elo-member-chip';

    const dot = document.createElement('span');
    dot.className = 'elo-member-chip-dot';
    dot.style.background = colorMap[name] || '#888';
    chip.appendChild(dot);

    chip.appendChild(document.createTextNode(name));

    // Only allow removal if more than 1 selected
    if (selectedMembers.size > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'elo-member-chip-remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = `Remove ${name}`;
      removeBtn.addEventListener('click', () => {
        selectedMembers.delete(name);
        onChange();
      });
      chip.appendChild(removeBtn);
    }

    container.appendChild(chip);
  });

  // Add button + dropdown
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

      const currentAvailable = allMembers.filter(m => !selectedMembers.has(m));
      if (currentAvailable.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'elo-add-member-dropdown-empty';
        empty.textContent = 'All members shown';
        dropdown.appendChild(empty);
      } else {
        currentAvailable.sort((a, b) => a.localeCompare(b)).forEach(name => {
          const item = document.createElement('div');
          item.className = 'elo-add-member-dropdown-item';
          item.textContent = name;
          item.addEventListener('click', () => {
            selectedMembers.add(name);
            closeDropdown();
            onChange();
          });
          dropdown.appendChild(item);
        });
      }

      wrapper.appendChild(dropdown);

      // Close on outside click
      const outsideHandler = () => { closeDropdown(); };
      setTimeout(() => document.addEventListener('click', outsideHandler, { once: true }), 0);
    });

    container.appendChild(wrapper);
  }
}

// ─── Main Render ───

export function renderEloCharts(container, params = {}) {
  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = '<h1>ELO Charts</h1>';
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'page-content';
  container.appendChild(content);

  let allMatches = Store.getMatches();
  let _chartCleanup = null;

  if (!allMatches.length) {
    const hasSummaryData = Store.getPlayersSummary().length > 0;

    if (hasSummaryData && Store.getGitHubConfig()?.pat) {
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
        _chartCleanup = renderChartContent();
      }).catch(() => {
        content.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <div class="empty-state-text">Failed to load match history</div>
        </div>`;
      });
      return () => { if (_chartCleanup) _chartCleanup(); };
    }

    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📈</div>
      <div class="empty-state-text">No ELO data yet</div>
      <p class="text-secondary text-sm">Play some tournaments first</p>
    </div>`;
    return;
  }

  _chartCleanup = renderChartContent();

  function renderChartContent() {
    const tabsEl = document.createElement('div');
    tabsEl.className = 'tabs';
    content.appendChild(tabsEl);

    const pickerEl = document.createElement('div');
    pickerEl.className = 'elo-member-picker';
    content.appendChild(pickerEl);

    const chartArea = document.createElement('div');
    chartArea.className = 'mt-md';
    content.appendChild(chartArea);

    let activeTab = 'all-time';
    let cleanupTooltip = null;
    let resizeHandler = null;

    // Resolve available members (those in the members list that have ELO data)
    const allMemberNames = getMembers();
    const colorMap = getMemberColorMap(allMemberNames);

    // Initialize selected set: default to current user if set, otherwise all members
    const currentUser = Store.getCurrentUser();
    const selectedMembers = new Set();
    if (currentUser && allMemberNames.some(m => m.toLowerCase() === currentUser.toLowerCase())) {
      // Use the exact casing from the members list
      const exact = allMemberNames.find(m => m.toLowerCase() === currentUser.toLowerCase());
      selectedMembers.add(exact);
    } else {
      allMemberNames.forEach(m => selectedMembers.add(m));
    }

    function renderTabs() {
      tabsEl.innerHTML = '';
      [{ id: 'all-time', label: 'All-Time' }, { id: 'latest', label: 'Latest Tournament' }].forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'tab' + (activeTab === t.id ? ' active' : '');
        btn.textContent = t.label;
        btn.addEventListener('click', () => { activeTab = t.id; renderTabs(); renderChart(); });
        tabsEl.appendChild(btn);
      });
    }

    function renderPicker() {
      renderMemberPicker(pickerEl, {
        allMembers: allMemberNames,
        selectedMembers,
        colorMap,
        onChange: () => { renderPicker(); renderChart(); },
      });
    }

    function renderChart() {
      chartArea.innerHTML = '';
      if (cleanupTooltip) { cleanupTooltip(); cleanupTooltip = null; }
      if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }

      let chartData;
      if (activeTab === 'all-time') {
        const history = getEloHistoryAllTime(allMatches);
        filterHistoryToMembers(history);
        filterHistoryToSelected(history, selectedMembers);
        chartData = buildAllTimeDatasets(history, colorMap);
      } else {
        const history = getEloHistoryForLatestTournament(allMatches);
        filterHistoryToMembers(history);
        filterHistoryToSelected(history, selectedMembers);
        chartData = buildTournamentDatasets(history, colorMap);
      }

      if (!chartData.datasets.length) {
        chartArea.innerHTML = '<p class="text-secondary text-center mt-lg">No data available</p>';
        return;
      }

      const box = document.createElement('div');
      box.className = 'chart-container';
      const canvas = document.createElement('canvas');
      canvas.className = 'chart-canvas';
      canvas.style.width = '100%';
      canvas.style.height = '250px';
      box.appendChild(canvas);
      chartArea.appendChild(box);

      renderLegend(chartArea, chartData.datasets);

      function draw() {
        drawLineChart(canvas, chartData.datasets, { xLabels: chartData.xLabels });
      }

      requestAnimationFrame(draw);

      cleanupTooltip = setupTooltip(canvas);
      resizeHandler = () => requestAnimationFrame(draw);
      window.addEventListener('resize', resizeHandler);
    }

    renderTabs();
    renderPicker();
    renderChart();

    return () => {
      if (cleanupTooltip) cleanupTooltip();
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    };
  }

  return () => { if (_chartCleanup) _chartCleanup(); };
}
