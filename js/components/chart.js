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
    ctx.font = '14px sans-serif';
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
  ctx.font = '11px sans-serif';
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
  ctx.font = '10px sans-serif';
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
    ctx.font = '10px sans-serif';

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
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data available', width / 2 || 0, height / 2 || 0);
    return;
  }

  const maxVal = Math.max(...items.map(i => i.value), 1);
  const ySteps = Math.min(maxVal, 5);

  // Horizontal grid lines + integer Y ticks
  ctx.fillStyle = textColor;
  ctx.font = '11px sans-serif';
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
    ctx.font = '10px sans-serif';
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
