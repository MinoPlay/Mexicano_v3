import { Store } from '../store.js';
import { calculatePlayerStatistics, calculateOpponentStats, calculatePartnershipStats, generatePlayerSummary } from '../services/statistics.js';

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
            <div class="flex justify-between"><span class="text-sm">Solid Wins (15-20)</span><span class="text-bold">${summary.solidWins}</span></div>
            <div class="flex justify-between"><span class="text-sm">Dominating (20+)</span><span class="text-bold">${summary.dominatingWins}</span></div>
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
      } else {
        tabContent = `
          <div class="data-table">
            <table>
              <thead><tr>
                <th>Opponent</th><th class="num-cell">Games</th><th class="num-cell">W</th><th class="num-cell">L</th><th class="num-cell">Win%</th>
              </tr></thead>
              <tbody>
                ${opponents.sort((a, b) => b.gamesPlayed - a.gamesPlayed).map(o => `
                  <tr>
                    <td class="name-cell">${o.opponentName}</td>
                    <td class="num-cell">${o.gamesPlayed}</td>
                    <td class="num-cell">${o.wins}</td>
                    <td class="num-cell">${o.losses}</td>
                    <td class="num-cell">${(o.winRate * 100).toFixed(0)}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    } else if (activeTab === 'partners') {
      if (partners.length === 0) {
        tabContent = '<div class="empty-state"><div class="empty-state-text">No partner data</div></div>';
      } else {
        tabContent = `
          <div class="data-table">
            <table>
              <thead><tr>
                <th>Partner</th><th class="num-cell">Games</th><th class="num-cell">W</th><th class="num-cell">L</th><th class="num-cell">Avg Pts</th>
              </tr></thead>
              <tbody>
                ${partners.sort((a, b) => b.gamesPlayed - a.gamesPlayed).map(p => `
                  <tr>
                    <td class="name-cell">${p.partnerName}</td>
                    <td class="num-cell">${p.gamesPlayed}</td>
                    <td class="num-cell">${p.wins}</td>
                    <td class="num-cell">${p.losses}</td>
                    <td class="num-cell">${p.averagePointsPerGame.toFixed(1)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
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
