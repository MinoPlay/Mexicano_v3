import { createTournament, startTournament, getActiveTournament, loadTournamentByDate } from '../services/tournament.js';
import { getRecentMembers } from '../services/members.js';
import { showToast } from '../components/toast.js';

const PLAYER_COUNTS = [4, 8, 12, 16];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function renderCreateTournament(container, params = {}) {
  let selectedCount = 0;
  let playerInputs = [];

  container.innerHTML = `
    <div class="page-header">
      <h1>New Tournament</h1>
    </div>
    <div class="page-content">
      <div class="form-group">
        <label class="form-label" for="tournament-date">Date</label>
        <input type="date" id="tournament-date" value="${todayStr()}">
      </div>

      <div class="form-group">
        <label class="form-label">Number of Players</label>
        <div class="player-count-selector" id="count-selector">
          ${PLAYER_COUNTS.map(n => `
            <button class="player-count-option" data-count="${n}">${n}</button>
          `).join('')}
        </div>
        <div id="count-error" class="text-danger text-xs mt-xs hidden"></div>
      </div>

      <div class="form-group">
        <label class="form-label">Players</label>
        <div class="player-slots" id="player-slots"></div>
        <div id="slots-error" class="text-danger text-xs mt-xs hidden"></div>
      </div>

      <datalist id="member-suggestions"></datalist>

      <button class="btn btn-primary btn-block mt-lg" id="start-btn" disabled>
        Start Tournament
      </button>
    </div>
  `;

  const dateInput = container.querySelector('#tournament-date');
  const countSelector = container.querySelector('#count-selector');
  const slotsContainer = container.querySelector('#player-slots');
  const countError = container.querySelector('#count-error');
  const slotsError = container.querySelector('#slots-error');
  const startBtn = container.querySelector('#start-btn');
  const datalist = container.querySelector('#member-suggestions');

  // Populate member suggestions, filtering out already-selected names
  const members = getRecentMembers();

  function updateSuggestions() {
    const taken = new Set(
      playerInputs
        .map(inp => inp.value.trim().toLowerCase())
        .filter(Boolean)
    );
    datalist.innerHTML = members
      .filter(m => !taken.has(m.toLowerCase()))
      .map(m => `<option value="${m}">`)
      .join('');
  }

  datalist.innerHTML = members.map(m => `<option value="${m}">`).join('');

  // Player count selection
  countSelector.addEventListener('click', (e) => {
    const btn = e.target.closest('.player-count-option');
    if (!btn) return;
    const count = parseInt(btn.dataset.count, 10);
    selectedCount = count;

    countSelector.querySelectorAll('.player-count-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    countError.classList.add('hidden');

    renderPlayerSlots(count);
  });

  function renderPlayerSlots(count) {
    playerInputs = [];
    slotsContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const slot = document.createElement('div');
      slot.className = 'player-slot';
      slot.innerHTML = `
        <span class="player-slot-number">${i + 1}</span>
        <input type="text" placeholder="Player ${i + 1}" list="member-suggestions"
               maxlength="50" autocomplete="off">
      `;
      const input = slot.querySelector('input');
      input.addEventListener('focus', updateSuggestions);
      input.addEventListener('input', updateSuggestions);
      playerInputs.push(input);
      slotsContainer.appendChild(slot);
    }
    startBtn.disabled = false;
  }

  // Prepopulate from params (e.g. coming from Doodle)
  if (params.names) {
    const preNames = params.names.split(',').map(n => decodeURIComponent(n));
    if (preNames.length > 0) {
      // Find the smallest valid player count that fits all names
      const fitCount = PLAYER_COUNTS.find(c => c >= preNames.length) || PLAYER_COUNTS[PLAYER_COUNTS.length - 1];
      selectedCount = fitCount;

      // Highlight the selected count button
      countSelector.querySelectorAll('.player-count-option').forEach(b => {
        b.classList.toggle('selected', parseInt(b.dataset.count, 10) === fitCount);
      });

      renderPlayerSlots(fitCount);

      // Fill in the names
      const namesToFill = preNames.slice(0, fitCount);
      namesToFill.forEach((name, i) => {
        if (playerInputs[i]) playerInputs[i].value = name;
      });
    }
  }

  if (params.date) {
    dateInput.value = params.date;
  }

  // Start tournament
  startBtn.addEventListener('click', async () => {
    slotsError.classList.add('hidden');
    countError.classList.add('hidden');

    // Validate count
    if (!selectedCount) {
      countError.textContent = 'Please select the number of players';
      countError.classList.remove('hidden');
      return;
    }

    const date = dateInput.value;
    if (!date) {
      showToast('Please select a date');
      return;
    }

    // Check for existing tournament on this date
    const existing = loadTournamentByDate(date);
    if (existing) {
      showToast('A tournament already exists for this date');
      return;
    }

    const active = getActiveTournament();
    if (active && active.date === date) {
      showToast('A tournament already exists for this date');
      return;
    }

    // Validate names
    const names = playerInputs.map(inp => inp.value.trim());
    const errors = [];

    for (let i = 0; i < names.length; i++) {
      if (!names[i]) {
        errors.push(`Player ${i + 1} name is required`);
      } else if (names[i].length > 50) {
        errors.push(`Player ${i + 1} name is too long (max 50 chars)`);
      }
    }

    // Check duplicates (case-insensitive)
    const lowerNames = names.map(n => n.toLowerCase());
    const seen = new Set();
    for (let i = 0; i < lowerNames.length; i++) {
      if (!lowerNames[i]) continue;
      if (seen.has(lowerNames[i])) {
        errors.push(`"${names[i]}" is a duplicate name`);
      }
      seen.add(lowerNames[i]);
    }

    if (errors.length) {
      slotsError.innerHTML = errors.join('<br>');
      slotsError.classList.remove('hidden');
      return;
    }

    try {
      const tournament = createTournament(date, names);
      startTournament(tournament);
      window.location.hash = `#/tournament/${date}`;
    } catch (err) {
      showToast(err.message || 'Failed to create tournament');
    }
  });
}
