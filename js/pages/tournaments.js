import { Store } from '../store.js';

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function statusBadge(entry) {
  if (!entry) return '';
  if (entry.isComplete) return '<span class="badge badge-success">Complete</span>';
  if (entry.completedCount > 0) return `<span class="badge badge-warning">${entry.completedCount}/${entry.matchCount}</span>`;
  return '<span class="badge badge-primary">Pending</span>';
}

export function renderTournaments(container, params) {
  const index = Store.getTournamentsIndex();
  const sorted = [...index].sort((a, b) => b.date.localeCompare(a.date));

  function renderList() {
    const list = container.querySelector('#tournament-list');
    if (!list) return;
    if (sorted.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏆</div>
          <div class="empty-state-text">No tournaments yet</div>
          <p class="text-sm text-secondary">Create your first tournament to get started</p>
          <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
        </div>
      `;
      return;
    }
    list.innerHTML = sorted.map(entry => `
      <div class="tournament-list-item" data-date="${entry.date}">
        <div>
          <div class="tournament-list-date">${formatDate(entry.date)}</div>
          <div class="tournament-list-meta">
            ${entry.playerCount ? `${entry.playerCount} players · ${entry.roundCount} round${entry.roundCount !== 1 ? 's' : ''}` : ''}
          </div>
        </div>
        <div>${statusBadge(entry)}</div>
      </div>
    `).join('');
    list.querySelectorAll('.tournament-list-item').forEach(item => {
      item.addEventListener('click', () => {
        window.location.hash = `/tournament/${item.dataset.date}`;
      });
    });
  }

  container.innerHTML = `
    <header class="page-header">
      <h1>Tournaments</h1>
    </header>
    <div class="page-content">
      <div id="tournament-list">
        ${index.length === 0 ? `
          <div id="tournaments-loading" class="text-sm text-secondary text-center" style="padding:var(--space-md);">
            ${Store.getGitHubConfig()?.pat ? '⏳ Loading…' : `
              <div class="empty-state">
                <div class="empty-state-icon">🏆</div>
                <div class="empty-state-text">No tournaments yet</div>
                <p class="text-sm text-secondary">Create your first tournament to get started</p>
                <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    </div>
    <a href="#/create-tournament" class="fab" aria-label="Create tournament">+</a>
  `;

  if (index.length > 0) {
    renderList();
    return;
  }

  // If index is empty and GitHub is configured, lazy-fetch tournaments.json
  if (Store.getGitHubConfig()?.pat) {
    const loadingEl = container.querySelector('#tournaments-loading');
    import('../services/github.js')
      .then(({ fetchTournamentsIndexPublic }) => fetchTournamentsIndexPublic())
      .then(() => {
        if (!loadingEl?.isConnected) return;
        const fresh = Store.getTournamentsIndex();
        if (fresh.length > 0) {
          sorted.length = 0;
          fresh.sort((a, b) => b.date.localeCompare(a.date)).forEach(e => sorted.push(e));
          renderList();
        } else {
          if (loadingEl?.isConnected) {
            loadingEl.innerHTML = `
              <div class="empty-state">
                <div class="empty-state-icon">🏆</div>
                <div class="empty-state-text">No tournaments yet</div>
                <p class="text-sm text-secondary">Create your first tournament to get started</p>
                <a href="#/create-tournament" class="btn btn-primary" style="margin-top:var(--space-md);">Create Tournament</a>
              </div>
            `;
          }
        }
      })
      .catch(() => {
        if (loadingEl?.isConnected) loadingEl.textContent = 'Failed to load tournaments';
      });
  }
}
