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
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Grid lines (horizontal)
  const ySteps = 5;
  const yRange = yMax - yMin;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = textColor;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';

  for (let i = 0; i <= ySteps; i++) {
    const yVal = yMin + (yRange / ySteps) * i;
    const yPos = padding.top + chartH - (chartH / ySteps) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, yPos);
    ctx.lineTo(padding.left + chartW, yPos);
    ctx.stroke();
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
