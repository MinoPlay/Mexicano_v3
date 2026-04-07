import { getEloHistoryAllTime, getEloHistoryForLatestTournament } from '../services/elo.js';
import { Store } from '../store.js';

// ─── Color Generator ───

function generateColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = Math.round((360 / count) * i);
    colors.push(`hsl(${hue}, 70%, 50%)`);
  }
  return colors;
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
        const dist = Math.sqrt((mx - xPos) ** 2 + (my - yPos) ** 2);
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

// ─── Build datasets from ELO history ───

function buildAllTimeDatasets(history) {
  // history: { players: { name: [{date, elo}] }, dates: string[] }
  const players = Object.keys(history.players || {});
  const colors = generateColors(players.length);
  const dates = history.dates || [];

  return {
    datasets: players.map((name, i) => ({
      label: name,
      color: colors[i],
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

function buildTournamentDatasets(history) {
  // history: { players: { name: [{round, elo}] }, rounds: number[] }
  const players = Object.keys(history.players || {});
  const colors = generateColors(players.length);
  const rounds = history.rounds || [];

  return {
    datasets: players.map((name, i) => ({
      label: name,
      color: colors[i],
      data: (history.players[name] || []).map(pt => ({
        x: rounds.indexOf(pt.round),
        y: pt.elo,
      })),
    })),
    xLabels: rounds.map(r => `Round ${r}`),
  };
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

  const allMatches = Store.getMatches();
  if (!allMatches.length) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📈</div>
      <div class="empty-state-text">No ELO data yet</div>
      <p class="text-secondary text-sm">Play some tournaments first</p>
    </div>`;
    return;
  }

  // Tabs
  const tabsEl = document.createElement('div');
  tabsEl.className = 'tabs';
  content.appendChild(tabsEl);

  const chartArea = document.createElement('div');
  chartArea.className = 'mt-md';
  content.appendChild(chartArea);

  let activeTab = 'all-time';
  let cleanupTooltip = null;
  let resizeHandler = null;

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

  function renderChart() {
    chartArea.innerHTML = '';
    if (cleanupTooltip) { cleanupTooltip(); cleanupTooltip = null; }
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }

    let chartData;
    if (activeTab === 'all-time') {
      const history = getEloHistoryAllTime(allMatches);
      chartData = buildAllTimeDatasets(history);
    } else {
      const history = getEloHistoryForLatestTournament(allMatches);
      chartData = buildTournamentDatasets(history);
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

    // Need to wait one frame so canvas has layout dimensions
    requestAnimationFrame(draw);

    cleanupTooltip = setupTooltip(canvas);
    resizeHandler = () => requestAnimationFrame(draw);
    window.addEventListener('resize', resizeHandler);
  }

  renderTabs();
  renderChart();

  return () => {
    if (cleanupTooltip) cleanupTooltip();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  };
}
