import {
  getActiveTournament,
  setMatchScore,
  startNextRound,
  completeTournament,
  loadTournamentByDate,
  saveTournamentState,
  isMatchComplete,
  isRoundComplete,
  isTournamentEditable,
  recalculateAllPlayerStats
} from '../services/tournament.js';
import { rankPlayers } from '../services/ranking.js';
import { State } from '../state.js';
import { Store } from '../store.js';
import { showToast } from '../components/toast.js';

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getStatusBadge(tournament) {
  if (tournament.isCompleted) return '<span class="badge badge-success">Completed</span>';
  if (tournament.isStarted) return '<span class="badge badge-primary">In Progress</span>';
  return '<span class="badge badge-warning">Not Started</span>';
}

export function renderTournament(container, params) {
  const date = params.date;
  let tournament = null;
  let currentTab = 'matches';
  let viewingRound = -1; // -1 means latest
  let unsubscribe = null;
  let isLoading = false;

  // Initial load
  initLoad();

  function initLoad() {
    const active = getActiveTournament();
    if (active && active.tournamentDate === date) {
      tournament = active;
      if (tournament.isCompleted) currentTab = 'leaderboard';
      render();
      return;
    }

    tournament = loadTournamentByDate(date);
    if (tournament) {
      if (tournament.isCompleted) currentTab = 'leaderboard';
      render();
      return;
    }

    // Try loading from GitHub on demand
    if (Store.getGitHubConfig()?.pat) {
      isLoading = true;
      render(); // shows loading state
      import('../services/github.js')
        .then(({ ensureDayMatchesLoaded }) => ensureDayMatchesLoaded(date))
        .then(() => {
          tournament = loadTournamentByDate(date);
          if (tournament?.isCompleted) currentTab = 'leaderboard';
          isLoading = false;
          render();
        })
        .catch(() => {
          isLoading = false;
          render();
        });
    } else {
      render(); // shows "no data" state
    }
  }

  function loadTournament() {
    const active = getActiveTournament();
    if (active && active.tournamentDate === date) {
      tournament = active;
    } else {
      tournament = loadTournamentByDate(date);
    }
  }

  function getTotalRounds() {
    return tournament && tournament.rounds ? tournament.rounds.length : 0;
  }

  function getViewingRoundIndex() {
    const total = getTotalRounds();
    if (total === 0) return -1;
    if (viewingRound < 0 || viewingRound >= total) return total - 1;
    return viewingRound;
  }

  function render() {
    if (isLoading) {
      container.innerHTML = `
        <div class="page-header">
          <h1>Tournament</h1>
        </div>
        <div class="page-content">
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-text">Loading tournament data…</div>
          </div>
        </div>
      `;
      return;
    }

    loadTournament();

    if (!tournament) {
      container.innerHTML = `
        <div class="page-header">
          <h1>Tournament</h1>
        </div>
        <div class="page-content">
          <div class="empty-state">
            <div class="empty-state-icon">🏸</div>
            <div class="empty-state-text">No tournament found</div>
            <p class="text-secondary text-sm">No data found for ${formatDate(date)}</p>
            <a href="#/create-tournament" class="btn btn-primary mt-lg" style="display:inline-flex">Create Tournament</a>
          </div>
        </div>
      `;
      return;
    }

    const totalRounds = getTotalRounds();
    const roundIdx = getViewingRoundIndex();
    const isLatestRound = roundIdx === totalRounds - 1;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 style="font-size:var(--font-size-base)">${formatDate(date)}</h1>
          <span class="text-sm text-secondary">${totalRounds > 0 ? `Round ${roundIdx + 1}/${totalRounds}` : 'No rounds'}</span>
        </div>
        <div>${getStatusBadge(tournament)}</div>
      </div>

      <div class="tabs" id="tournament-tabs">
        <button class="tab ${currentTab === 'matches' ? 'active' : ''}" data-tab="matches">Matches</button>
        <button class="tab ${currentTab === 'leaderboard' ? 'active' : ''}" data-tab="leaderboard">Leaderboard</button>
      </div>

      <div class="page-content" id="tournament-content"></div>
    `;

    // Tab switching
    container.querySelector('#tournament-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      currentTab = tab.dataset.tab;
      render();
    });

    const content = container.querySelector('#tournament-content');

    if (currentTab === 'matches') {
      renderMatchesTab(content, roundIdx, totalRounds, isLatestRound);
    } else {
      renderLeaderboardTab(content);
    }
  }

  // ─── Matches Tab ───
  function renderMatchesTab(content, roundIdx, totalRounds, isLatestRound) {
    if (totalRounds === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎾</div>
          <div class="empty-state-text">No rounds yet</div>
        </div>
      `;
      return;
    }

    const round = tournament.rounds[roundIdx];
    const matches = round.matches || [];
    const roundComplete = round && isRoundComplete(round);
    const isPastRound = !isLatestRound;

    let html = '';

    // Round navigation
    if (totalRounds > 1) {
      html += `
        <div class="round-header">
          <button class="btn btn-ghost btn-sm" id="prev-round" ${roundIdx <= 0 ? 'disabled' : ''}>◀</button>
          <span class="round-title">Round ${roundIdx + 1}</span>
          <button class="btn btn-ghost btn-sm" id="next-round" ${roundIdx >= totalRounds - 1 ? 'disabled' : ''}>▶</button>
        </div>
      `;
    }

    if (isPastRound) {
      html += `<div class="card mb-md" style="background:var(--color-warning-light);border-color:var(--color-warning);padding:var(--space-sm) var(--space-md)">
        <span class="text-sm" style="color:var(--color-warning)">⚠ Editing will regenerate subsequent rounds</span>
      </div>`;
    }

    // Match cards
    matches.forEach((match, idx) => {
      const completed = isMatchComplete(match);
      const team1Name1 = match.player1?.name || '?';
      const team1Name2 = match.player2?.name || '?';
      const team2Name1 = match.player3?.name || '?';
      const team2Name2 = match.player4?.name || '?';

      html += `
        <div class="match-card ${completed ? 'completed' : ''}" data-match-idx="${idx}">
          <div class="match-court">Court ${idx + 1}</div>
          <div class="match-teams">
            <div class="match-team">
              <span class="match-team-name">${esc(team1Name1)}</span>
              <span class="match-team-name">${esc(team1Name2)}</span>
            </div>
            <span class="match-vs">vs</span>
            <div class="match-team" style="text-align:right">
              <span class="match-team-name">${esc(team2Name1)}</span>
              <span class="match-team-name">${esc(team2Name2)}</span>
            </div>
          </div>
          ${completed
            ? `<div class="match-score">
                <span class="match-score-value">${match.team1Score}</span>
                <span class="match-score-separator">–</span>
                <span class="match-score-value">${match.team2Score}</span>
              </div>`
            : tournament.isCompleted
              ? ''
              : `<div class="text-center text-sm text-secondary mt-sm">Tap to score</div>`
          }
        </div>
      `;
    });

    // Action buttons
    if (isLatestRound && !tournament.isCompleted) {
      const allScored = tournament.rounds.every(r => isRoundComplete(r));

      html += '<div class="mt-lg flex flex-col gap-sm">';
      if (roundComplete) {
        html += `<button class="btn btn-primary btn-block" id="next-round-btn">Next Round</button>`;
      }
      html += `<button class="btn btn-danger btn-block" id="end-tournament-btn">End Tournament</button>`;
      if (!allScored) {
        html += `<p class="text-sm text-secondary text-center">Unscored matches will be removed when ending</p>`;
      }
      html += '</div>';
    }

    content.innerHTML = html;

    // Event: round navigation
    content.querySelector('#prev-round')?.addEventListener('click', () => {
      viewingRound = roundIdx - 1;
      render();
    });
    content.querySelector('#next-round')?.addEventListener('click', () => {
      viewingRound = roundIdx + 1;
      render();
    });

    // Event: click match to score (disabled for completed tournaments)
    if (!tournament.isCompleted) {
      content.querySelectorAll('.match-card').forEach(card => {
        card.addEventListener('click', () => {
          const matchIdx = parseInt(card.dataset.matchIdx, 10);
          openScoreSheet(roundIdx, matchIdx);
        });
      });
    }

    // Event: next round
    content.querySelector('#next-round-btn')?.addEventListener('click', () => {
      try {
        startNextRound(tournament);
        viewingRound = -1;
        showToast('Next round started!');
        render();
      } catch (err) {
        showToast(err.message || 'Cannot start next round');
      }
    });

    // Event: end tournament
    content.querySelector('#end-tournament-btn')?.addEventListener('click', () => {
      const unscoredCount = tournament.rounds.reduce((acc, r) =>
        acc + r.matches.filter(m => !isMatchComplete(m)).length, 0);

      const title = 'End Tournament?';
      const message = unscoredCount > 0
        ? `Ending the tournament will remove ${unscoredCount} match${unscoredCount > 1 ? 'es' : ''} that ${unscoredCount > 1 ? 'have' : 'has'} no score. This cannot be undone.`
        : 'This will finalize the tournament. Match history will be saved.';

      showConfirmDialog(title, message, () => {
        try {
          if (unscoredCount > 0) {
            for (const round of tournament.rounds) {
              round.matches = round.matches.filter(m => isMatchComplete(m));
            }
            tournament.rounds = tournament.rounds.filter(r => r.matches.length > 0);
          }
          completeTournament(tournament);
          showToast('Tournament completed!');
          render();
        } catch (err) {
          showToast(err.message || 'Failed to end tournament');
        }
      });
    });
  }

  // ─── Leaderboard Tab ───
  function renderLeaderboardTab(content) {
    const players = tournament.players || [];
    const ranked = rankPlayers(players);

    if (ranked.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-text">No player data yet</div>
        </div>
      `;
      return;
    }

    let html = `<div class="data-table"><table>
      <thead><tr>
        <th class="rank-cell">#</th>
        <th>Name</th>
        <th class="num-cell">Pts</th>
        <th class="num-cell">W</th>
        <th class="num-cell">L</th>
        <th class="num-cell">PPG</th>
        <th class="num-cell">Win%</th>
      </tr></thead><tbody>`;

    ranked.forEach((p, i) => {
      const rank = i + 1;
      const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
      const gp = p.gamesPlayed || 0;
      const ppg = gp > 0 ? (p.totalPoints / gp).toFixed(1) : '0.0';
      const winPct = gp > 0 ? Math.round(((p.wins || 0) / gp) * 100) : 0;

      html += `<tr>
        <td class="rank-cell ${rankClass}">${rank}</td>
        <td class="name-cell">${esc(p.name)}</td>
        <td class="num-cell">${p.totalPoints || 0}</td>
        <td class="num-cell">${p.wins || 0}</td>
        <td class="num-cell">${p.losses || 0}</td>
        <td class="num-cell">${ppg}</td>
        <td class="num-cell">${winPct}%</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    content.innerHTML = html;
  }

  // ─── Score Input Bottom Sheet ───
  function openScoreSheet(roundIdx, matchIdx) {
    const round = tournament.rounds[roundIdx];
    const match = round.matches[matchIdx];
    const t1 = `${match.player1?.name || '?'} & ${match.player2?.name || '?'}`;
    const t2 = `${match.player3?.name || '?'} & ${match.player4?.name || '?'}`;

    const existingScore1 = isMatchComplete(match) ? match.team1Score : '';
    const existingScore2 = isMatchComplete(match) ? match.team2Score : '';

    const overlay = document.createElement('div');
    overlay.className = 'bottom-sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'bottom-sheet';

    sheet.innerHTML = `
      <div class="bottom-sheet-handle"></div>
      <div class="score-input-header">
        <div class="score-input-teams">${esc(t1)}<br><strong>vs</strong><br>${esc(t2)}</div>
      </div>

      <div class="score-input-fields">
        <input type="number" class="score-input-field" id="score1" min="0" max="25"
               value="${existingScore1}" placeholder="0" inputmode="numeric">
        <span class="match-score-separator" style="font-size:var(--font-size-xl)">–</span>
        <input type="number" class="score-input-field" id="score2" min="0" max="25"
               value="${existingScore2}" placeholder="0" inputmode="numeric">
      </div>

      <div class="score-presets" id="score-presets">
        ${[[13,12],[15,10],[17,8],[20,5],[12,13],[10,15],[8,17],[5,20]].map(
          ([a,b]) => `<button class="score-preset" data-s1="${a}" data-s2="${b}">${a} – ${b}</button>`
        ).join('')}
      </div>

      <div class="score-actions">
        <button class="btn btn-secondary" id="score-cancel" style="flex:1">Cancel</button>
        <button class="btn btn-primary" id="score-confirm" style="flex:1">Confirm</button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    // Activate with slight delay for transition
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      sheet.classList.add('active');
    });

    const score1Input = sheet.querySelector('#score1');
    const score2Input = sheet.querySelector('#score2');

    // Auto-calculate complement
    score1Input.addEventListener('input', () => {
      const v = parseInt(score1Input.value, 10);
      if (!isNaN(v) && v >= 0 && v <= 25) {
        score2Input.value = 25 - v;
      }
    });
    score2Input.addEventListener('input', () => {
      const v = parseInt(score2Input.value, 10);
      if (!isNaN(v) && v >= 0 && v <= 25) {
        score1Input.value = 25 - v;
      }
    });

    // Presets
    sheet.querySelector('#score-presets').addEventListener('click', (e) => {
      const btn = e.target.closest('.score-preset');
      if (!btn) return;
      score1Input.value = btn.dataset.s1;
      score2Input.value = btn.dataset.s2;
    });

    function closeSheet() {
      overlay.classList.remove('active');
      sheet.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        sheet.remove();
      }, 300);
    }

    overlay.addEventListener('click', closeSheet);
    sheet.querySelector('#score-cancel').addEventListener('click', closeSheet);

    sheet.querySelector('#score-confirm').addEventListener('click', () => {
      const s1 = parseInt(score1Input.value, 10);
      const s2 = parseInt(score2Input.value, 10);

      if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
        showToast('Both scores must be 0 or higher');
        return;
      }
      if (s1 + s2 !== 25) {
        showToast('Scores must add up to 25');
        return;
      }

      try {
        setMatchScore(tournament, round.roundNumber, match.id, s1, s2);
        closeSheet();
        render();
        State.emit('tournament-changed', tournament);
      } catch (err) {
        showToast(err.message || 'Failed to save score');
      }
    });
  }

  // ─── Confirmation Dialog ───
  function showConfirmDialog(title, message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog-header">
          <strong>${esc(title)}</strong>
        </div>
        <div class="dialog-body">
          <p class="text-sm text-secondary mb-md">${esc(message)}</p>
          <div class="flex gap-sm">
            <button class="btn btn-secondary" style="flex:1" id="dialog-cancel">Cancel</button>
            <button class="btn btn-danger" style="flex:1" id="dialog-confirm">Confirm</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    function close() {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    }

    overlay.querySelector('#dialog-cancel').addEventListener('click', close);
    overlay.querySelector('#dialog-confirm').addEventListener('click', () => {
      close();
      onConfirm();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  // ─── HTML escape helper ───
  function esc(str) {
    const el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  // ─── Init ───
  // initLoad() is called at the top of renderTournament

  // Subscribe to external changes
  unsubscribe = State.on('tournament-changed', () => {
    loadTournament();
    render();
  });

  // Cleanup
  return () => {
    if (unsubscribe) unsubscribe();
    // Remove any stray sheets/overlays
    document.querySelectorAll('.bottom-sheet-overlay, .bottom-sheet, .dialog-overlay').forEach(el => el.remove());
  };
}
