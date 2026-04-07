import { Store } from '../store.js';

/**
 * Render a leaderboard list.
 * @param {Array} items - [{rank, name, value, sub?, change?}]
 * @param {Object} options - {onPlayerClick, valueLabel}
 */
export function renderLeaderboard(items, options = {}) {
  const { onPlayerClick, valueLabel = '' } = options;
  const el = document.createElement('div');
  el.className = 'flex flex-col';

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'leaderboard-item';

    const rankClass = item.rank === 1 ? 'gold' : item.rank === 2 ? 'silver' : item.rank === 3 ? 'bronze' : '';

    let changeHtml = '';
    if (item.change !== undefined && item.change !== null) {
      const cls = item.change > 0 ? 'positive' : item.change < 0 ? 'negative' : 'neutral';
      const prefix = item.change > 0 ? '▲' : item.change < 0 ? '▼' : '–';
      const val = item.change !== 0 ? Math.abs(item.change).toFixed(1) : '';
      changeHtml = `<span class="elo-change ${cls}">${prefix}${val}</span>`;
    }

    row.innerHTML = `
      <span class="leaderboard-rank ${rankClass}">${item.rank}</span>
      <span class="leaderboard-name">${item.name}</span>
      <div class="flex flex-col items-center" style="text-align:right">
        <span class="leaderboard-value">${item.value}</span>
        ${item.sub ? `<span class="leaderboard-sub">${item.sub}</span>` : ''}
        ${changeHtml}
      </div>
    `;

    if (onPlayerClick) {
      row.querySelector('.leaderboard-name').style.cursor = 'pointer';
      row.querySelector('.leaderboard-name').addEventListener('click', () => onPlayerClick(item.name));
    }

    el.appendChild(row);
  });

  return el;
}
