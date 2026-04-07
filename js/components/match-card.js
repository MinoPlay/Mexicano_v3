/**
 * Render a match card.
 * @param {Object} match - match object with player1..4, team1Score, team2Score
 * @param {number} courtNumber - 1-based court number
 * @param {Function} onClick - callback when card is clicked
 */
export function renderMatchCard(match, courtNumber, onClick) {
  const el = document.createElement('div');
  el.className = `match-card${isComplete(match) ? ' completed' : ''}`;

  const p1 = match.player1?.name || match.team1Player1Name || '?';
  const p2 = match.player2?.name || match.team1Player2Name || '?';
  const p3 = match.player3?.name || match.team2Player1Name || '?';
  const p4 = match.player4?.name || match.team2Player2Name || '?';

  const complete = isComplete(match);
  const s1 = match.team1Score;
  const s2 = match.team2Score;
  const team1Won = s1 > s2;

  el.innerHTML = `
    <div class="match-court">Court ${courtNumber}</div>
    <div class="match-teams">
      <div class="match-team" style="text-align:left">
        <span class="match-team-name${complete && team1Won ? ' text-bold' : ''}">${p1}</span>
        <span class="match-team-name${complete && team1Won ? ' text-bold' : ''}">${p2}</span>
      </div>
      <span class="match-vs">vs</span>
      <div class="match-team" style="text-align:right">
        <span class="match-team-name${complete && !team1Won ? ' text-bold' : ''}">${p3}</span>
        <span class="match-team-name${complete && !team1Won ? ' text-bold' : ''}">${p4}</span>
      </div>
    </div>
    ${complete
      ? `<div class="match-score">
          <span class="match-score-value${team1Won ? ' text-success' : ''}">${s1}</span>
          <span class="match-score-separator">–</span>
          <span class="match-score-value${!team1Won ? ' text-success' : ''}">${s2}</span>
        </div>`
      : `<div class="match-score text-secondary text-sm" style="margin-top:var(--space-sm)">Tap to score</div>`
    }
  `;

  if (onClick) {
    el.addEventListener('click', () => onClick(match));
  }

  return el;
}

function isComplete(match) {
  return (match.team1Score || 0) + (match.team2Score || 0) === 25;
}
