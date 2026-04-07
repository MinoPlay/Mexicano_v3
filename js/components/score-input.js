/**
 * Score input bottom sheet for entering match scores.
 */
export function openScoreInput(match, onConfirm) {
  const p1 = match.player1?.name || match.team1Player1Name || '?';
  const p2 = match.player2?.name || match.team1Player2Name || '?';
  const p3 = match.player3?.name || match.team2Player1Name || '?';
  const p4 = match.player4?.name || match.team2Player2Name || '?';

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';

  // Create sheet
  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';

  sheet.innerHTML = `
    <div class="bottom-sheet-handle"></div>
    <div class="score-input-header">
      <div class="score-input-teams">
        <strong>${p1} & ${p2}</strong> vs <strong>${p3} & ${p4}</strong>
      </div>
    </div>
    <div class="score-input-fields">
      <div class="flex flex-col items-center gap-xs">
        <label class="text-xs text-secondary">Team 1</label>
        <input type="number" class="score-input-field" id="score1" min="0" max="25" value="${match.team1Score || ''}" inputmode="numeric">
      </div>
      <span class="text-lg text-secondary" style="padding-top:18px">–</span>
      <div class="flex flex-col items-center gap-xs">
        <label class="text-xs text-secondary">Team 2</label>
        <input type="number" class="score-input-field" id="score2" min="0" max="25" value="${match.team2Score || ''}" inputmode="numeric">
      </div>
    </div>
    <div class="score-presets">
      <button class="score-preset" data-s1="13" data-s2="12">13 – 12</button>
      <button class="score-preset" data-s1="15" data-s2="10">15 – 10</button>
      <button class="score-preset" data-s1="17" data-s2="8">17 – 8</button>
      <button class="score-preset" data-s1="20" data-s2="5">20 – 5</button>
      <button class="score-preset" data-s1="12" data-s2="13">12 – 13</button>
      <button class="score-preset" data-s1="10" data-s2="15">10 – 15</button>
      <button class="score-preset" data-s1="8" data-s2="17">8 – 17</button>
      <button class="score-preset" data-s1="5" data-s2="20">5 – 20</button>
    </div>
    <div id="score-error" class="text-danger text-sm" style="min-height:20px;text-align:center"></div>
    <div class="score-actions">
      <button class="btn btn-secondary" style="flex:1" id="score-cancel">Cancel</button>
      <button class="btn btn-primary" style="flex:1" id="score-confirm">Confirm</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('active');
    sheet.classList.add('active');
  });

  const score1 = sheet.querySelector('#score1');
  const score2 = sheet.querySelector('#score2');
  const error = sheet.querySelector('#score-error');

  // Auto-calculate complement
  score1.addEventListener('input', () => {
    const v = parseInt(score1.value);
    if (!isNaN(v) && v >= 0 && v <= 25) {
      score2.value = 25 - v;
      error.textContent = '';
    }
  });

  score2.addEventListener('input', () => {
    const v = parseInt(score2.value);
    if (!isNaN(v) && v >= 0 && v <= 25) {
      score1.value = 25 - v;
      error.textContent = '';
    }
  });

  // Presets
  sheet.querySelectorAll('.score-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      score1.value = btn.dataset.s1;
      score2.value = btn.dataset.s2;
      error.textContent = '';
    });
  });

  function close() {
    overlay.classList.remove('active');
    sheet.classList.remove('active');
    setTimeout(() => {
      overlay.remove();
      sheet.remove();
    }, 300);
  }

  // Cancel
  sheet.querySelector('#score-cancel').addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Confirm
  sheet.querySelector('#score-confirm').addEventListener('click', () => {
    const s1 = parseInt(score1.value);
    const s2 = parseInt(score2.value);

    if (isNaN(s1) || isNaN(s2)) {
      error.textContent = 'Please enter both scores';
      return;
    }
    if (s1 < 0 || s2 < 0) {
      error.textContent = 'Scores must be non-negative';
      return;
    }
    if (s1 + s2 !== 25) {
      error.textContent = 'Scores must sum to 25';
      return;
    }

    onConfirm(s1, s2);
    close();
  });

  // Focus first input
  setTimeout(() => score1.focus(), 300);
}
