# Tournament — ELO Progression Chart

## Summary
The Tournament detail page (`#/tournament/:date`, `js/pages/tournament.js`) has a second panel in
the right column, **under the Leaderboard**: **ELO Progression**. It plots how every player's ELO
moved through the rounds of that day, starting at **Round 0** (ELO before the tournament). Each
player has a toggle chip; switching a chip off hides that player's curve.

The chart is the one from the ELO Charts page ("Latest Tournament" section,
`js/pages/elo-charts.js`): `drawLineChart`, `drawEmptyChart`, `setupTooltip`, `buildDatasets` are
exported from that module and reused as-is. There is no second chart implementation.

## Behaviour

### Data — `calculateTournamentEloProgression(tournament, summary)` (`js/services/elo.js`)
- Same shape as `getEloHistoryForLatestTournament`:
  `{ players: { name: [{ round, elo, delta }] }, rounds: [0, ...] }`.
- **Round 0** = pre-tournament ELO from `resolvePreTournamentElo` (the baseline of the match ELO
  badges: `previousElo` when the player's latest ELO row is this tournament, otherwise `elo`),
  `delta` 0.
- Completed matches are replayed round by round (ordered by `roundNumber`) with `processMatchElo`
  from that baseline. It is the SAME replay as `calculateTournamentMatchEloChanges` (shared private
  helper), so chart and match badges can never disagree.
- A player gets a point `{ round, elo, delta }` for every round in which they played a completed
  match. `delta` = ELO change vs the player's previous point, 1 decimal. A round the player sat out
  has no point (the line connects the previous and next point), as in "Latest Tournament".
- `rounds` = `0` + every round number with at least one completed match, ascending.
- Unscored matches are ignored (their players need not be in the summary).
- Baseline unknown (a player missing from the summary, or a later tournament already rewrote the
  player's ELO row) => `null`. No completed match => `{ players: {}, rounds: [] }`.

### Panel
- Right column of `.tournament-desktop`: `aside.tournament-side` is a plain wrapper holding two
  `.panel`s, **Leaderboard** first and **ELO Progression** second (`#tournament-elo`, subtitle
  `Round 0 = before the tournament`). Visible to everyone (not admin gated).
- Body: a chip row (`.elo-member-picker.elo-cache-picker`) above the chart box
  (`.chart-container-bleed` > `canvas.chart-canvas`, same classes as the ELO Charts page).
- **Chips**: one `button.elo-cache-chip` per player that has chart data, alphabetical. A coloured
  dot (`.elo-member-chip-dot`) shows the curve colour. `.active` + `aria-pressed="true"` = curve
  visible. Clicking a chip toggles that player's curve; the chart redraws immediately.
- All players visible by default. Hiding everyone is allowed (chart shows "No players selected").
- **Matches player filter drives the chart**: picking a player in the Matches panel's player
  filter (`#matches-player-filter`) shows only that player's curve (every other player hidden,
  only their chip `.active`). Picking `All players` shows every curve again. Chips still toggle
  freely afterwards; the next filter change resets the selection again. Changing the filter
  re-renders only the Matches panel and the ELO panel (Leaderboard not reloaded).
- **ELO change labels toggle**: a `Δ` button (`#tournament-elo-deltas`,
  `.elo-header-smooth-btn`, same as the ELO Charts page `Δᴸ`) in the panel header, shown only
  when the chart has data. `.active` + `aria-pressed="true"` = each point from round 1 on gets
  its ELO change label (`+16`, `-17.4`; green up, red down). Off by default (all players).
  Filter change sets it: a picked player => on; `All players` => off. Clicking flips it and
  redraws. Page-local (`eloShowDeltas`), not persisted, survives re-renders.
- **Colours** come from `buildEntryColorMap(all players, alphabetical)` (same palette as the ELO
  Charts page), so hiding a player never changes another player's colour.
- **Chart**: X axis labels `0, 1, 2, ...` (Round 0 first), smooth lines, a dot per point. Click/tap
  a dot => tooltip with player, `Round N`, ELO and delta. The Y axis fits the visible curves.
  Drawn on the next animation frame once the canvas has a width, and again on window resize.
- **Empty states** (no chips, no canvas): nothing scored yet => `No ELO data yet`;
  baseline unknown => `ELO progression not available for this tournament` (same limitation as the
  match ELO badges: an older day whose players already have later ELO rows).
- **Live**: every full re-render (scoring, changed result, `tournament-changed`) rebuilds the panel
  from the current tournament, so a newly scored round appears as a new point.
- **State**: the hidden-player set (`eloHidden`) is page-local, default empty, not persisted. It
  survives full re-renders; hidden names that no longer have data are simply not shown.
- **Cleanup**: the resize listener, pending animation frame and tooltip are released on every
  re-render and when the page is left.

### Layout (`css/desktop.css`)
- `.tournament-desktop > .tournament-side` = flex column, gap `var(--space-lg)`, still sticky at
  `top: 88px`, now with `max-height: calc(100vh - 104px)` + `overflow-y: auto` so a tall rail
  (long leaderboard + chart) can be scrolled; its panels do not shrink (`flex: none`).
  `.tournament-elo-chart .chart-canvas` is `18rem` high.
- ≤1100px: single column, the rail is static (no max-height), the chart panel sits under the
  Leaderboard full width.
- `.tournaments-desktop > .tournament-side` (Tournaments list page) is unchanged.

## Acceptance (input => expected)
Fixture: Alice+Bob vs Charlie+Diana, all four at 1000 (latest ELO rows older than the day).

### Service
- Round 1 `15-10` => `rounds [0, 1]`; Alice/Bob elo `[1000, 1016]`, delta `[0, 16]`;
  Charlie/Diana elo `[1000, 984.74]`, delta `[0, -15.3]`.
- Add round 2 `10-15` => `rounds [0, 1, 2]`; Alice/Bob elo `[1000, 1016, 998.56]`, delta
  `[0, 16, -17.4]`; Charlie/Diana elo `[1000, 984.74, 1001.38]`, delta `[0, -15.3, 16.6]`
  (matches the badges `▲16.0`, `▼15.3`, `▼17.4`, `▲16.6`).
- Rounds are walked by `roundNumber`, not array order.
- Summary already holds the day (`eloDate` = day, `previousElo` 1000, `elo` 1016 / 984.74) => same
  output as round 1 above (round 0 = `previousElo`).
- Own baselines Alice 1100, Bob 1000, Charlie 950, Diana 1020, round 1 `15-10` => round 0 =
  `1100, 1000, 950, 1020`; round 1 = `1110.92, 1015.34, 939.08, 1006.02`.
- Sit-out (round 1 Alice+Bob vs Charlie+Diana `15-10`, round 2 Alice+Charlie vs Bob+Eve `13-12`,
  Eve at 1000) => `rounds [0, 1, 2]`; Eve has points for rounds `[0, 2]`, Diana for `[0, 1]`.
- A round whose matches are all unscored is not in `rounds`; unscored players need no summary row.
- A player missing from the summary, or a later `eloDate` => `null`.
- No completed match => `{ players: {}, rounds: [] }`.

### Page
- Rounds 1+2 above => right column panels `Leaderboard`, `ELO Progression` (in that order);
  chips `Alice, Bob, Charlie, Diana`, all `.active`; chart x labels `[0, 1, 2]`; curves
  `Alice [1000, 1016, 998.56]`, `Bob` same, `Charlie [1000, 984.74, 1001.38]`, `Diana` same, in
  colours `#e6194b, #3cb44b, #4363d8, #911eb4`; tooltip point labels `Round 0, Round 1, Round 2`.
- Click chip `Bob` => chip not `.active` / `aria-pressed="false"`; curves `Alice, Charlie, Diana`;
  `Charlie` is still `#4363d8`. Click `Bob` again => all four curves.
- Click all four chips => no curves (empty chart), all chips inactive.
- Hide `Bob`, then `tournament-changed` re-render => `Bob` is still hidden.
- Matches filter `Charlie` => curves `Charlie` only; only chip `Charlie` `.active`. Then filter
  `All players` => curves `Alice, Bob, Charlie, Diana`, all chips `.active`.
- Matches filter `Charlie`, then click chip `Alice` => curves `Alice, Charlie`.
- `15-10` then `10-15`: `Δ` button not `.active` / `aria-pressed="false"`, no change labels. Click
  `Δ` => labels `+16, -17.4, +16, -17.4, -15.3, +16.6, -15.3, +16.6`; click again => none.
- Matches filter `Charlie` => `Δ` on, labels `-15.3, +16.6`. Filter `All players` => `Δ` off,
  no labels.
- Nothing scored => no `Δ` button.
- Nothing scored => text `No ELO data yet`, no chips, no canvas. Score `15-10` => 4 chips, x labels
  `[0, 1]`.
- Diana missing from the summary => text `ELO progression not available for this tournament`, no
  chips, no canvas (match badges stay absent too).
- Re-render 3 times, then leave the page => every `resize` listener that was added got removed.

## Related
- `.github/skills/tab-tournament/SKILL.md` (page reference), `.github/skills/tab-elo-charts/SKILL.md`
  (chart helpers), `.github/features/elo-rating-system.md` (ELO maths),
  `.github/features/tournament-management.md` → "Match ELO Change Indicators" (same replay + baseline),
  `.github/features/tournament-matches-panel.md`, `.github/features/desktop-ui.md`.
