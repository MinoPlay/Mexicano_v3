import {
  getActiveTournament,
  setMatchScore,
  startNextRound,
  completeTournament,
  loadTournamentByDate,
  getLatestCompleteTournamentDate,
  saveTournamentState,
  isMatchComplete,
  isRoundComplete,
  isTournamentEditable,
  recalculateAllPlayerStats,
  updateAccessCode,
  deleteTournament,
  confirmAttendanceAndPush
} from '../services/tournament.js';
import { rankPlayers } from '../services/ranking.js';
import { State } from '../state.js';
import { Store } from '../store.js';
import { showToast } from '../components/toast.js';
import { renderDayStatsInto, showPlayerProfile } from './statistics.js';

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
      // Fire a background refresh so we always show the latest round data,
      // bypassing the session-level pull guard that runs only once per page load.
      if (Store.getGitHubConfig()?.pat) {
        import('../services/github.js')
          .then(({ fetchActiveTournamentJson, ensureDayMatchesLoaded, readDayMatches }) => {
            return fetchActiveTournamentJson().then(fresh => {
              if (fresh && !fresh.isCompleted && fresh.tournamentDate === date) {
                tournament = fresh;
                render();
                return;
              }
              // GitHub has no in-progress tournament — stale local state.
              // Clear active tournament, force-fetch completed matches.
              if (!fresh && active && !active.isCompleted) {
                Store.clearActiveTournament();
                return readDayMatches(date).then(fetched => {
                  if (fetched.length > 0) {
                    const cached = JSON.parse(localStorage.getItem('mexicano_matches') || '[]');
                    const withoutDate = cached.filter(m => m.date !== date);
                    localStorage.setItem('mexicano_matches', JSON.stringify([...withoutDate, ...fetched]));
                  }
                  tournament = loadTournamentByDate(date);
                  if (tournament?.isCompleted) currentTab = 'leaderboard';
                  render();
                });
              }
            });
          })
          .catch(() => {});
      }
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

    // Tournament prev/next navigation
    const isAdmin = Store.isAdministrator();
    const index = Store.getTournamentsIndex();
    const accessible = [...index]
      .sort((a, b) => b.date.localeCompare(a.date));
    const currentPos = accessible.findIndex(e => e.date === date);
    const prevDate = currentPos >= 0 && currentPos < accessible.length - 1 ? accessible[currentPos + 1].date : null;
    const nextDate = currentPos > 0 ? accessible[currentPos - 1].date : null;

    container.innerHTML = `
      <div class="page-header">
        <button class="btn btn-ghost btn-sm" id="tournament-prev" ${prevDate ? `data-date="${prevDate}"` : 'disabled'} aria-label="Previous tournament">◀</button>
        <div style="text-align:center;flex:1">
          <h1 style="font-size:var(--font-size-base)">${formatDate(date)}</h1>
          <span class="text-sm text-secondary">${totalRounds > 0 ? `Round ${roundIdx + 1}/${totalRounds}` : 'No rounds'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-xs)">
          ${getStatusBadge(tournament)}
          <button class="btn btn-ghost btn-sm" id="tournament-next" ${nextDate ? `data-date="${nextDate}"` : 'disabled'} aria-label="Next tournament">▶</button>
        </div>
      </div>

      <div class="tabs" id="tournament-tabs">
        <button class="tab ${currentTab === 'matches' ? 'active' : ''}" data-tab="matches">Matches</button>
        <button class="tab ${currentTab === 'leaderboard' ? 'active' : ''}" data-tab="leaderboard">Leaderboard</button>
        <div style="display:flex;align-items:center;gap:var(--space-xs);margin-left:auto" id="access-code-area">
          ${tournament.accessCode ? `<span class="text-sm text-secondary"><strong>Access Code: ${tournament.accessCode}</strong></span>` : ''}
          ${isAdmin ? `<button class="btn btn-ghost btn-xs" id="edit-access-code" title="Edit access code">✎</button>` : ''}
        </div>
      </div>

      <div class="page-content" id="tournament-content"></div>
    `;

    // Tournament prev/next navigation
    const prevBtn = container.querySelector('#tournament-prev');
    const nextBtn = container.querySelector('#tournament-next');
    if (prevBtn?.dataset.date) prevBtn.addEventListener('click', () => { window.location.hash = `/tournament/${prevBtn.dataset.date}`; });
    if (nextBtn?.dataset.date) nextBtn.addEventListener('click', () => { window.location.hash = `/tournament/${nextBtn.dataset.date}`; });

    // Tab switching
    container.querySelector('#tournament-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      currentTab = tab.dataset.tab;
      render();
    });

    // Edit access code (inline editor; prompt() unsupported in PWA)
    const editBtn = container.querySelector('#edit-access-code');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const area = container.querySelector('#access-code-area');
        const currentCode = tournament.accessCode || '';
        area.innerHTML = `
          <input type="text" id="access-code-input" class="input input-sm" maxlength="20"
            value="${currentCode}" placeholder="Access code" style="width:8rem">
          <button class="btn btn-ghost btn-xs" id="save-access-code" title="Save">✓</button>
          <button class="btn btn-ghost btn-xs" id="cancel-access-code" title="Cancel">✕</button>
        `;
        const input = area.querySelector('#access-code-input');
        input.focus();
        input.select();
        const save = () => {
          const codeToSave = input.value.trim() || null;
          updateAccessCode(date, codeToSave);
          showToast('Access code updated');
          render();
        };
        area.querySelector('#save-access-code').addEventListener('click', save);
        area.querySelector('#cancel-access-code').addEventListener('click', () => render());
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          else if (e.key === 'Escape') { e.preventDefault(); render(); }
        });
      });
    }

    const content = container.querySelector('#tournament-content');

    if (currentTab === 'matches') {
      renderMatchesTab(content, roundIdx, totalRounds, isLatestRound);
    } else {
      renderLeaderboardTab(content).catch(() => {});
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

    const confirmedNames = new Set(
      (tournament.players || [])
        .filter(p => p.confirmed)
        .map(p => String(p.name || '').toLowerCase())
    );
    const nameWithCheck = (name) =>
      `${esc(name)}${confirmedNames.has(String(name || '').toLowerCase())
        ? ' <span class="confirm-check" title="Confirmed attendance" style="color:var(--color-success)">✅</span>'
        : ''}`;

    let html = '';

    // Confirm-attendance button (any player, self-confirm) — active tournament only
    const currentUser = Store.getCurrentUser();
    const userIsPlayer = !!currentUser && (tournament.players || [])
      .some(p => String(p.name || '').toLowerCase() === currentUser.toLowerCase());
    const userConfirmed = !!currentUser && confirmedNames.has(currentUser.toLowerCase());
    if (!tournament.isCompleted && userIsPlayer && !userConfirmed) {
      html += `<button class="btn btn-success btn-block mb-md" id="confirm-attendance-btn">✅ Confirm attendance</button>`;
    }

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
          <div class="match-court">Court ${tournament.courts?.[idx] ?? idx + 1}</div>
          <div class="match-teams">
            <div class="match-team">
              <span class="match-team-name">${nameWithCheck(team1Name1)}</span>
              <span class="match-team-name">${nameWithCheck(team1Name2)}</span>
            </div>
            <span class="match-vs">vs</span>
            <div class="match-team" style="text-align:right">
              <span class="match-team-name">${nameWithCheck(team2Name1)}</span>
              <span class="match-team-name">${nameWithCheck(team2Name2)}</span>
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
              : Store.isAdministrator() ? `<div class="text-center text-sm text-secondary mt-sm">Tap to score</div>` : ''
          }
        </div>
      `;
    });

    // Action buttons (admin only)
    if (Store.isAdministrator() && isLatestRound && !tournament.isCompleted) {
      const allScored = tournament.rounds.every(r => isRoundComplete(r));

      html += '<div class="mt-lg flex flex-col gap-sm">';
      if (roundComplete) {
        html += `<button class="btn btn-primary btn-block" id="next-round-btn">Next Round</button>`;
      }
      html += `<button class="btn btn-danger btn-block" id="end-tournament-btn">End Tournament</button>`;
      if (!allScored) {
        html += `<p class="text-sm text-secondary text-center">Unscored matches will be removed when ending</p>`;
      }
      html += `<button class="btn btn-ghost btn-block" id="delete-tournament-btn" style="color:var(--color-danger)">Delete Tournament</button>`;
      html += '</div>';
    } else if (Store.isAdministrator() && !tournament.isCompleted) {
      // Not the latest round view but still an incomplete tournament — allow delete
      html += '<div class="mt-lg flex flex-col gap-sm">';
      html += `<button class="btn btn-ghost btn-block" id="delete-tournament-btn" style="color:var(--color-danger)">Delete Tournament</button>`;
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

    // Event: confirm attendance (self-confirm, any player)
    content.querySelector('#confirm-attendance-btn')?.addEventListener('click', async () => {
      const user = Store.getCurrentUser();
      const btn = content.querySelector('#confirm-attendance-btn');
      let btnLabel;
      if (btn) {
        btn.disabled = true;
        btnLabel = btn.textContent;
        btn.textContent = 'Confirming… don\u2019t close';
      }
      showToast('Saving confirmation… keep this page open');
      let result;
      try {
        // Persist to GitHub (immediate + verified) BEFORE alerting, so the
        // Telegram alert can never fire while the backend is left un-updated.
        result = await confirmAttendanceAndPush(user);
      } catch (err) {
        console.warn('[attendance] confirm push failed:', err);
        showToast('Confirm failed — check your connection and retry');
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        return;
      }
      if (result.changed) {
        Store.set(`confirmed_tournament_${tournament.tournamentDate}`, true);
        import('../services/telegram.js').then(({ sendTournamentConfirmationAlert }) => {
          sendTournamentConfirmationAlert(user, tournament.tournamentDate)
            .catch(err => console.warn('[telegram] confirmation alert error:', err));
        }).catch(() => {});
        showToast('Attendance confirmed!');
        tournament = getActiveTournament() || tournament;
        render();
      } else if (btn) {
        btn.disabled = false;
        btn.textContent = btnLabel;
      }
    });

    // Event: click match to score (disabled for completed tournaments or non-admin)
    if (Store.isAdministrator() && !tournament.isCompleted) {
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

      showProgressConfirmDialog(title, message, [
        { id: 'finalize', label: 'Finalizing results & ELO' },
        { id: 'push', label: 'Saving matches to GitHub' },
        { id: 'index', label: 'Updating tournaments index' },
        { id: 'telegram', label: 'Sending Telegram alert' },
      ], async (api) => {
        if (unscoredCount > 0) {
          for (const round of tournament.rounds) {
            round.matches = round.matches.filter(m => isMatchComplete(m));
          }
          tournament.rounds = tournament.rounds.filter(r => r.matches.length > 0);
        }

        // completeTournament reports finalize/push/index progress. When any
        // GitHub step fails it rejects — the step status already shows the error,
        // so swallow here and still attempt the (independent) Telegram alert.
        try {
          await completeTournament(tournament, (id, status, detail) => api.setStep(id, status, detail));
        } catch (err) {
          console.warn('[tournament] completion sync failed:', err);
          import('../services/round-log.js')
            .then(({ logError }) => logError('end tournament', err))
            .catch(() => {});
        }

        api.setStep('telegram', 'running');
        try {
          const { sendTournamentCompletedAlert } = await import('../services/telegram.js');
          await sendTournamentCompletedAlert(tournament);
          api.setStep('telegram', 'success');
        } catch (err) {
          console.warn('[telegram] tournament-completed alert failed:', err);
          api.setStep('telegram', 'error', err);
          import('../services/round-log.js')
            .then(({ logError }) => logError('telegram tournament-completed', err))
            .catch(() => {});
        }

        try {
          const { sendTournamentCompletedPush } = await import('../services/push.js');
          await sendTournamentCompletedPush(tournament);
        } catch (err) {
          console.warn('[push] tournament-completed push failed:', err);
        }

        render();
      });
    });

    // Event: delete tournament (admin only, incomplete only)
    content.querySelector('#delete-tournament-btn')?.addEventListener('click', () => {
      const title = 'Delete Tournament?';
      const message = 'This permanently removes the tournament from the index and deletes its match file. This cannot be undone.';

      showConfirmDialog(title, message, async () => {
        try {
          await deleteTournament(date);
          showToast('Tournament deleted');
          window.location.hash = '/tournaments';
        } catch (err) {
          showToast(err.message || 'Failed to delete tournament');
        }
      });
    });
  }

  // ─── Leaderboard Tab ───
  async function renderLeaderboardTab(content) {
    content.innerHTML = '<p class="text-center mt-lg">🎾 Loading…</p>';
    const allMatches = Store.getMatches();
    const dayMatches = allMatches.filter(m => m.date === date);

    if (dayMatches.length > 0) {
      const isLatest = date === getLatestCompleteTournamentDate();
      await renderDayStatsInto(content, dayMatches, date, isLatest, name => showPlayerProfile(name));
      return;
    }

    // No match history in store — fall back to tournament.players[] (active/in-progress)
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
        <td class="name-cell">${esc(p.name)}${p.confirmed ? ' <span class="confirm-check" title="Confirmed attendance" style="color:var(--color-success)">✅</span>' : ''}</td>
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

  // ─── Confirm dialog with live operation status ───
  // Shows the same confirm prompt, but on confirm keeps the dialog open and
  // renders a checklist of async steps that flip to ✅ / ❌ as they settle.
  // `onConfirm(api)` receives { setStep(id, status, detail) } and returns a
  // promise; the dialog surfaces a Close/Done button once it resolves.
  function showProgressConfirmDialog(title, message, steps, onConfirm) {
    const STATUS_ICON = { pending: '○', running: '⏳', success: '✅', error: '❌' };
    const state = new Map(steps.map(s => [s.id, { ...s, status: 'pending', detail: '' }]));

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog-header">
          <strong>${esc(title)}</strong>
        </div>
        <div class="dialog-body">
          <p class="text-sm text-secondary mb-md">${esc(message)}</p>
          <div id="dialog-steps" style="display:none;" class="mb-md"></div>
          <div class="flex gap-sm">
            <button class="btn btn-secondary" style="flex:1" id="dialog-cancel">Cancel</button>
            <button class="btn btn-danger" style="flex:1" id="dialog-confirm">Confirm</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const stepsEl = overlay.querySelector('#dialog-steps');
    const cancelBtn = overlay.querySelector('#dialog-cancel');
    const confirmBtn = overlay.querySelector('#dialog-confirm');

    function renderSteps() {
      stepsEl.innerHTML = [...state.values()].map(s => {
        const color = s.status === 'error' ? 'var(--danger, #e53935)'
          : s.status === 'success' ? 'var(--success, #2e7d32)'
          : 'var(--text-primary)';
        const detail = s.status === 'error' && s.detail
          ? `<div style="font-size:var(--font-size-xs);color:var(--danger, #e53935);margin:0 0 4px 22px;white-space:pre-wrap;word-break:break-word;">${esc(s.detail)}</div>`
          : '';
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:var(--font-size-sm);color:${color};">
            <span style="width:16px;text-align:center;">${STATUS_ICON[s.status]}</span>
            <span>${esc(s.label)}</span>
          </div>${detail}`;
      }).join('');
    }

    function setStep(id, status, detail) {
      const s = state.get(id);
      if (!s) return;
      s.status = status;
      if (detail !== undefined && detail !== null) {
        s.detail = detail instanceof Error ? (detail.message || String(detail)) : String(detail);
      }
      renderSteps();
    }

    function close() {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    }

    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && confirmBtn.dataset.running !== '1') close();
    });

    confirmBtn.addEventListener('click', async () => {
      if (confirmBtn.dataset.running === '1') return;
      confirmBtn.dataset.running = '1';
      cancelBtn.style.display = 'none';
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Working…';
      stepsEl.style.display = '';
      renderSteps();

      try {
        await onConfirm({ setStep });
      } catch (err) {
        console.warn('[tournament] finish dialog handler failed:', err);
      }

      const anyError = [...state.values()].some(s => s.status === 'error');
      confirmBtn.disabled = false;
      confirmBtn.dataset.running = '0';
      confirmBtn.textContent = anyError ? 'Close' : 'Done';
      confirmBtn.className = anyError ? 'btn btn-secondary' : 'btn btn-primary';
      confirmBtn.style.flex = '1';
      const newBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
      newBtn.addEventListener('click', close);
      if (!anyError) showToast('Tournament completed!');
    });
  }

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
