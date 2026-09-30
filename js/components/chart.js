/** Canvas font size scaled with the root font size (desktop fluid type; base 14px). */
export function fontPx(n) {
  const root = typeof document !== 'undefined' ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 14;
  return Math.round(n * Math.max(1, (root || 14) / 14));
}

/**
 * Simple line chart using HTML Canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} datasets - [{label, data: [{x, y}], color}]
 * @param {Object} options - {xLabels, yMin, yMax, title, showLegend}
 */
export function drawLineChart(canvas, datasets, options = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, right: 15, bottom: 50, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Determine data bounds
  const allY = datasets.flatMap(d => d.data.map(p => p.y));
  const yMin = options.yMin !== undefined ? options.yMin : Math.floor(Math.min(...allY) - 10);
  const yMax = options.yMax !== undefined ? options.yMax : Math.ceil(Math.max(...allY) + 10);
  const xLabels = options.xLabels || (datasets[0]?.data.map(p => p.x) ?? []);
  const xCount = xLabels.length;

  if (xCount === 0 || allY.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
    ctx.font = `${fontPx(14)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('No data available', width / 2, height / 2);
    return;
  }

  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
  const gridColor = 'rgba(148, 163, 184, 0.25)';

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Grid lines (horizontal)
  const ySteps = 5;
  const yRange = yMax - yMin;
  ctx.fillStyle = textColor;
  ctx.font = `${fontPx(11)}px sans-serif`;
  ctx.textAlign = 'right';

  for (let i = 0; i <= ySteps; i++) {
    const yVal = yMin + (yRange / ySteps) * i;
    const yPos = padding.top + chartH - (chartH / ySteps) * i;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = i === 0 ? 1 : 0.5;
    ctx.setLineDash(i === 0 ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, yPos);
    ctx.lineTo(padding.left + chartW, yPos);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(Math.round(yVal).toString(), padding.left - 8, yPos + 4);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.font = `${fontPx(10)}px sans-serif`;
  const maxLabels = Math.floor(chartW / 50);
  const labelStep = Math.max(1, Math.ceil(xCount / maxLabels));

  for (let i = 0; i < xCount; i++) {
    const xPos = padding.left + (chartW / Math.max(xCount - 1, 1)) * i;
    if (i % labelStep === 0 || i === xCount - 1) {
      ctx.save();
      ctx.translate(xPos, padding.top + chartH + 12);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(String(xLabels[i]).slice(-5), 0, 0); // Show last 5 chars
      ctx.restore();
    }
  }

  // Draw datasets
  datasets.forEach(dataset => {
    if (dataset.data.length === 0) return;
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    dataset.data.forEach((point, i) => {
      const xIdx = xLabels.indexOf(point.x);
      const xi = xIdx >= 0 ? xIdx : i;
      const xPos = padding.left + (chartW / Math.max(xCount - 1, 1)) * xi;
      const yPos = padding.top + chartH - ((point.y - yMin) / yRange) * chartH;

      if (i === 0) ctx.moveTo(xPos, yPos);
      else ctx.lineTo(xPos, yPos);
    });

    ctx.stroke();

    // Draw dots
    ctx.fillStyle = dataset.color;
    dataset.data.forEach((point, i) => {
      const xIdx = xLabels.indexOf(point.x);
      const xi = xIdx >= 0 ? xIdx : i;
      const xPos = padding.left + (chartW / Math.max(xCount - 1, 1)) * xi;
      const yPos = padding.top + chartH - ((point.y - yMin) / yRange) * chartH;

      ctx.beginPath();
      ctx.arc(xPos, yPos, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // Legend
  if (options.showLegend !== false && datasets.length > 0) {
    const legendY = height - 5;
    let legendX = padding.left;
    ctx.font = `${fontPx(10)}px sans-serif`;

    datasets.forEach(ds => {
      ctx.fillStyle = ds.color;
      ctx.fillRect(legendX, legendY - 8, 10, 10);
      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      const label = ds.label.length > 8 ? ds.label.slice(0, 8) + '..' : ds.label;
      ctx.fillText(label, legendX + 13, legendY);
      legendX += ctx.measureText(label).width + 25;
      if (legendX > width - 50) {
        // Overflow - stop drawing legend
        return;
      }
    });
  }
}

/**
 * Simple vertical bar chart using HTML Canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} items - [{label, value, color}]
 */
export function drawBarChart(canvas, items, options = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, right: 15, bottom: 70, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);

  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
  const gridColor = 'rgba(148, 163, 184, 0.25)';

  if (!items || items.length === 0 || width === 0) {
    ctx.fillStyle = textColor;
    ctx.font = `${fontPx(14)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('No data available', width / 2 || 0, height / 2 || 0);
    return;
  }

  const maxVal = Math.max(...items.map(i => i.value), 1);
  const ySteps = Math.min(maxVal, 5);

  // Horizontal grid lines + integer Y ticks
  ctx.fillStyle = textColor;
  ctx.font = `${fontPx(11)}px sans-serif`;
  ctx.textAlign = 'right';
  for (let i = 0; i <= ySteps; i++) {
    const yVal = (maxVal / ySteps) * i;
    const yPos = padding.top + chartH - (chartH / ySteps) * i;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = i === 0 ? 1 : 0.5;
    ctx.setLineDash(i === 0 ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, yPos);
    ctx.lineTo(padding.left + chartW, yPos);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(Math.round(yVal).toString(), padding.left - 8, yPos + 4);
  }

  // Bars
  const n = items.length;
  const slot = chartW / n;
  const barW = Math.min(slot * 0.6, 48);
  items.forEach((item, i) => {
    const x = padding.left + slot * i + (slot - barW) / 2;
    const h = (item.value / maxVal) * chartH;
    const y = padding.top + chartH - h;

    ctx.fillStyle = item.color || 'hsl(210, 70%, 55%)';
    ctx.fillRect(x, y, barW, h);

    ctx.fillStyle = textColor;
    ctx.font = `${fontPx(10)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(item.value), x + barW / 2, y - 4);

    ctx.save();
    ctx.translate(x + barW / 2, padding.top + chartH + 12);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right';
    const label = String(item.label);
    ctx.fillText(label.length > 12 ? label.slice(0, 12) + '…' : label, 0, 0);
    ctx.restore();
  });
}

/**
 * Generate distinct colors for chart datasets.
 */
export function generateChartColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 360 / count) % 360;
    colors.push(`hsl(${hue}, 70%, 55%)`);
  }
  return colors;
}

// ─── Desktop helpers ───

/** "Nice" ascending ticks (step 1/2/5 × 10^n) covering [min, max]. */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  if (min > max) [min, max] = [max, min];
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= Math.sqrt(50) ? 10 : norm >= Math.sqrt(10) ? 5 : norm >= Math.SQRT2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks.map(v => Number(v.toPrecision(12)));
}

export function linearScale([d0, d1], [r0, r1]) {
  if (d0 === d1) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Diverging heat color: red below mid, transparent at mid, green above. */
export function heatColor(value, { min = 0, mid = 50, max = 100 } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'transparent';
  if (value === mid) return 'transparent';
  const above = value > mid;
  const span = above ? (max - mid) : (mid - min);
  const t = span > 0 ? Math.min(1, Math.abs(value - mid) / span) : 1;
  const alpha = Math.round((0.12 + 0.63 * t) * 100) / 100;
  return above ? `rgba(74, 222, 128, ${alpha})` : `rgba(248, 113, 113, ${alpha})`;
}

/** Inline SVG sparkline string. */
export function sparklineSvg(values, { width = 80, height = 22, color = 'var(--color-primary)' } = {}) {
  const pts = (values || []).filter(v => Number.isFinite(v));
  if (pts.length < 2) return '';
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const sx = linearScale([0, pts.length - 1], [1, width - 1]);
  const sy = linearScale([lo, hi], [height - 2, 2]);
  const poly = pts.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const trend = pts[pts.length - 1] >= pts[0] ? 'var(--color-success)' : 'var(--color-danger)';
  const stroke = color === 'trend' ? trend : color;
  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline fill="none" stroke="${stroke}" stroke-width="1.5" points="${poly}"/></svg>`;
}

const PALETTE = ['#60a5fa', '#f472b6', '#4ade80', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c', '#e879f9', '#94a3b8', '#facc15', '#38bdf8'];
export function paletteColor(i) { return PALETTE[i % PALETTE.length]; }

/**
 * Interactive line chart: crosshair tooltip with all series at hovered x,
 * clickable legend to hide series, redraws on resize.
 * @param {HTMLElement} container
 * @param {{ xLabels: string[], series: Array<{label, color, values: (number|null)[]}>, height?: number, formatX?: Function, formatY?: Function }} cfg
 * @returns {{ destroy: Function, update: Function }}
 */
export function createLineChart(container, cfg) {
  let { xLabels, series, height = 320, formatX = (x) => x, formatY = (y) => Math.round(y) } = cfg;
  const hidden = new Set();

  container.classList.add('line-chart');
  container.innerHTML = `
    <div class="line-chart-canvas-wrap" style="height:${height / 15}rem">
      <canvas></canvas>
      <div class="chart-tooltip hidden"></div>
    </div>
    <div class="chart-legend"></div>`;
  const wrap = container.querySelector('.line-chart-canvas-wrap');
  const canvas = container.querySelector('canvas');
  const tip = container.querySelector('.chart-tooltip');
  const legend = container.querySelector('.chart-legend');
  let meta = null;
  let hoverIdx = null;

  const cssVar = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;

  function draw() {
    const rect = wrap.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const text = cssVar('--text-secondary', '#94a3b8');
    const font = cssVar('--font-family', 'sans-serif');
    const visible = series.filter(s => !hidden.has(s.label));
    const ys = visible.flatMap(s => s.values.filter(v => Number.isFinite(v)));
    const pad = { top: 12, right: 16, bottom: fontPx(28), left: fontPx(48) };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;
    if (!ys.length || !xLabels.length) {
      ctx.fillStyle = text;
      ctx.font = `${fontPx(13)}px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      meta = null;
      return;
    }
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys), 6);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const sy = linearScale([y0, y1], [pad.top + ph, pad.top]);
    const sx = linearScale([0, Math.max(1, xLabels.length - 1)], [pad.left, pad.left + pw]);

    ctx.font = `${fontPx(11)}px ${font}`;
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const y = sy(t);
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + pw, y);
      ctx.stroke();
      ctx.fillText(formatY(t), pad.left - 6, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = Math.max(2, Math.floor(pw / 80));
    const step = Math.max(1, Math.ceil(xLabels.length / maxLabels));
    for (let i = 0; i < xLabels.length; i += step) {
      ctx.fillText(String(formatX(xLabels[i])), sx(i), pad.top + ph + 8);
    }

    if (hoverIdx !== null) {
      ctx.strokeStyle = 'rgba(148,163,184,0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(hoverIdx), pad.top);
      ctx.lineTo(sx(hoverIdx), pad.top + ph);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const s of visible) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = visible.length > 8 ? 1.5 : 2;
      ctx.beginPath();
      let started = false;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        if (!started) { ctx.moveTo(sx(i), sy(v)); started = true; } else ctx.lineTo(sx(i), sy(v));
      });
      ctx.stroke();
      if (hoverIdx !== null && Number.isFinite(s.values[hoverIdx])) {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(sx(hoverIdx), sy(s.values[hoverIdx]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    meta = { pad, pw, sx, n: xLabels.length };
  }

  function renderLegend() {
    legend.innerHTML = series.map((s, i) => `
      <button type="button" class="chart-legend-item${hidden.has(s.label) ? ' off' : ''}" data-i="${i}">
        <span class="chart-legend-dot" style="background:${s.color}"></span>${s.label}
      </button>`).join('');
    legend.querySelectorAll('.chart-legend-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = series[Number(btn.dataset.i)];
        if (hidden.has(s.label)) hidden.delete(s.label); else hidden.add(s.label);
        renderLegend();
        draw();
      });
    });
  }

  function onMove(e) {
    if (!meta) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.round(((mx - meta.pad.left) / meta.pw) * (meta.n - 1));
    if (idx < 0 || idx >= meta.n) { onLeave(); return; }
    hoverIdx = idx;
    draw();
    const rows = series
      .filter(s => !hidden.has(s.label) && Number.isFinite(s.values[idx]))
      .map(s => ({ s, v: s.values[idx] }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 14);
    tip.innerHTML = `<div class="chart-tooltip-title">${formatX(xLabels[idx])}</div>` + rows.map(({ s, v }) =>
      `<div class="chart-tooltip-row"><span class="chart-legend-dot" style="background:${s.color}"></span><span>${s.label}</span><b>${formatY(v)}</b></div>`).join('');
    tip.classList.toggle('hidden', rows.length === 0);
    const x = meta.sx(idx);
    const flip = x > rect.width * 0.6;
    tip.style.left = flip ? '' : `${x + 12}px`;
    tip.style.right = flip ? `${rect.width - x + 12}px` : '';
  }

  function onLeave() {
    hoverIdx = null;
    tip.classList.add('hidden');
    draw();
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  ro?.observe(wrap);
  renderLegend();
  requestAnimationFrame(draw);

  return {
    update(next) {
      ({ xLabels = xLabels, series = series } = next);
      renderLegend();
      draw();
    },
    destroy() { ro?.disconnect(); },
  };
}
