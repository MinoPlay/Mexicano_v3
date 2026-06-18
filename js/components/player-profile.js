import { Store } from '../store.js';
import { calculatePlayerStatistics, calculateOpponentStats, calculatePartnershipStats, generatePlayerSummary, sortHeadToHeadTable, sortPartnersTable } from '../services/statistics.js';

/**
 * Open player profile dialog.
 */
export function openPlayerProfile(playerName) {
  const allMatches = Store.getMatches();
  const summary = generatePlayerSummary(playerName, allMatches);
  const opponents = calculateOpponentStats(playerName, allMatches);
  const partners = calculatePartnershipStats(playerName, allMatches);

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';

  let activeTab = 'overview';
  let opponentSort = { col: 'gamesPlayed', dir: 'desc' };
  let partnerSort = { col: 'gamesPlayed', dir: 'desc' };

  function nextSort(current, clickedCol) {
    if (current.col === clickedCol) {
      return { col: clickedCol, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    }
    return { col: clickedCol, dir: clickedCol.endsWith('Name') ? 'asc' : 'desc' };
  }

  function buildSortableTable(data, columns, sortState, onSortChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    columns.forEach(col => {
      const th = document.createElement('th');
      if (col.cls) th.className = col.cls;
      th.textContent = col.label;
      if (sortState.col === col.key) {
        th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
      th.addEventListener('click', () => onSortChange(col.key));
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    data.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        if (col.cls) td.className = col.cls;
        td.textContent = col.format ? col.format(row[col.key]) : row[col.key];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  function renderContent() {
    let tabContent = '';

    if (activeTab === 'overview') {
      tabContent = `
        <div class="flex flex-wrap gap-sm">
          <div class="quick-stat-card" style="flex:1;min-width:120px">
            <div class="stat-value">${summary.totalTournaments}</div>
            <div class="stat-label">Tournaments</div>
          </div>
          <div class="quick-stat-card" style="flex:1;min-width:120px">
            <div class="stat-value">${summary.totalWins}</div>
            <div class="stat-label">Wins</div>
          </div>
          <div class="quick-stat-card" style="flex:1;min-width:120px">
            <div class="stat-value">${summary.totalLosses}</div>
            <div class="stat-label">Losses</div>
          </div>
        </div>
        <div class="card mt-md">
          <div class="card-title">Win Categories</div>
          <div class="flex flex-col gap-xs mt-sm">
            <div class="flex justify-between"><span class="text-sm">Tight Wins (13-12)</span><span class="text-bold">${summary.tightWins}</span></div>
            <div class="flex justify-between"><span class="text-sm">Solid Wins (14-18)</span><span class="text-bold">${summary.solidWins}</span></div>
            <div class="flex justify-between"><span class="text-sm">Dominating (19+)</span><span class="text-bold">${summary.dominatingWins}</span></div>
          </div>
        </div>
        <div class="card mt-md">
          <div class="card-title">Podium Finishes</div>
          <div class="flex flex-col gap-xs mt-sm">
            <div class="flex justify-between"><span class="text-sm">🥇 1st Place</span><span class="text-bold">${summary.firstPlaceFinishes}</span></div>
            <div class="flex justify-between"><span class="text-sm">🥈 2nd Place</span><span class="text-bold">${summary.secondPlaceFinishes}</span></div>
            <div class="flex justify-between"><span class="text-sm">🥉 3rd Place</span><span class="text-bold">${summary.thirdPlaceFinishes}</span></div>
          </div>
        </div>
      `;
    } else if (activeTab === 'opponents') {
      if (opponents.length === 0) {
        tabContent = '<div class="empty-state"><div class="empty-state-text">No opponent data</div></div>';
      }
    } else if (activeTab === 'partners') {
      if (partners.length === 0) {
        tabContent = '<div class="empty-state"><div class="empty-state-text">No partner data</div></div>';
      }
    }

    dialog.innerHTML = `
      <div class="dialog-header">
        <h2 style="font-size:var(--font-size-lg)">${playerName}</h2>
        <button class="btn btn-ghost btn-sm" id="profile-close">✕</button>
      </div>
      <div class="tabs" style="padding:0 var(--space-lg)">
        <button class="tab${activeTab === 'overview' ? ' active' : ''}" data-tab="overview">Overview</button>
        <button class="tab${activeTab === 'opponents' ? ' active' : ''}" data-tab="opponents">Head-to-Head</button>
        <button class="tab${activeTab === 'partners' ? ' active' : ''}" data-tab="partners">Partners</button>
      </div>
      <div class="dialog-body">${tabContent}</div>
    `;

    dialog.querySelector('#profile-close').addEventListener('click', close);
    dialog.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        renderContent();
      });
    });

    const body = dialog.querySelector('.dialog-body');

    if (activeTab === 'opponents' && opponents.length > 0) {
      const sorted = sortHeadToHeadTable(opponents, opponentSort.col, opponentSort.dir);
      const cols = [
        { key: 'opponentName', label: 'Opponent', cls: 'name-cell' },
        { key: 'gamesPlayed', label: 'Games', cls: 'num-cell' },
        { key: 'wins', label: 'W', cls: 'num-cell' },
        { key: 'losses', label: 'L', cls: 'num-cell' },
        { key: 'winRate', label: 'Win%', cls: 'num-cell', format: v => v.toFixed(0) + '%' },
      ];
      body.appendChild(buildSortableTable(sorted, cols, opponentSort, key => {
        opponentSort = nextSort(opponentSort, key);
        renderContent();
      }));
    } else if (activeTab === 'partners' && partners.length > 0) {
      const sorted = sortPartnersTable(partners, partnerSort.col, partnerSort.dir);
      const cols = [
        { key: 'partnerName', label: 'Partner', cls: 'name-cell' },
        { key: 'gamesPlayed', label: 'Games', cls: 'num-cell' },
        { key: 'wins', label: 'W', cls: 'num-cell' },
        { key: 'losses', label: 'L', cls: 'num-cell' },
        { key: 'averagePointsPerGame', label: 'Avg Pts', cls: 'num-cell', format: v => v.toFixed(1) },
      ];
      body.appendChild(buildSortableTable(sorted, cols, partnerSort, key => {
        partnerSort = nextSort(partnerSort, key);
        renderContent();
      }));
    }
  }

  function close() {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  }

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  renderContent();

  requestAnimationFrame(() => overlay.classList.add('active'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}
