import { Store } from '../store.js';
import { getAllTournamentDates } from '../services/tournament.js';

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getTournamentInfo(matches, date) {
  const dateMatches = matches.filter(m => m.date === date);
  const players = new Set();
  const rounds = new Set();
  let completed = 0;

  for (const m of dateMatches) {
    if (m.team1Player1Name) players.add(m.team1Player1Name);
    if (m.team1Player2Name) players.add(m.team1Player2Name);
    if (m.team2Player1Name) players.add(m.team2Player1Name);
    if (m.team2Player2Name) players.add(m.team2Player2Name);
    if (m.roundNumber != null) rounds.add(m.roundNumber);
    if (m.scoreTeam1 + m.scoreTeam2 === 25) completed++;
  }

  return {
    playerCount: players.size,
    roundCount: rounds.size,
    matchCount: dateMatches.length,
    completedCount: completed,
    isComplete: dateMatches.length > 0 && completed === dateMatches.length
  };
}

export function renderTournaments(container, params) {
  const dates = getAllTournamentDates();
  const matches = Store.getMatches();

  const sorted = [...dates].sort((a, b) => b.localeCompare(a));

  container.innerHTML = `
    <header class="page-header">
      <h1>Tournaments</h1>
    </header>
    <div class="page-content">
      ${sorted.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">🏆</div>
          <div class="empty-state-text">No tournaments yet</div>
          <p class="text-sm text-secondary">Create your first tournament to get started</p>
          <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
        </div>
      ` : `
        <div id="tournament-list">
          ${sorted.map(date => {
            const info = getTournamentInfo(matches, date);
            const statusBadge = info.isComplete
              ? '<span class="badge badge-success">Complete</span>'
              : info.completedCount > 0
                ? `<span class="badge badge-warning">${info.completedCount}/${info.matchCount}</span>`
                : '<span class="badge badge-primary">Pending</span>';

            return `
              <div class="tournament-list-item" data-date="${date}">
                <div>
                  <div class="tournament-list-date">${formatDate(date)}</div>
                  <div class="tournament-list-meta">
                    ${info.playerCount} players · ${info.roundCount} round${info.roundCount !== 1 ? 's' : ''}
                  </div>
                </div>
                <div>${statusBadge}</div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
    <a href="#/create-tournament" class="fab" aria-label="Create tournament">+</a>
  `;

  // Navigation on item click
  container.querySelectorAll('.tournament-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const date = item.dataset.date;
      window.location.hash = `/tournament/${date}`;
    });
  });
}
