# Tournament — Matches Panel (all rounds)

## Summary
The Matches panel on `#/tournament/:date` (`js/pages/tournament.js`, `renderMatchesTab`) shows
**every round at once** instead of one round at a time. Controls in the panel header choose the
round order and filter by player. Each match is a compact **one-line** row; all rows share one
grid that fills the panel width.

There is no round navigation (◀ Round N ▶) any more and no `viewingRound` state.

## Behaviour

### All rounds visible
- Every round of `tournament.rounds` renders as a `.round-section`: a **round label on the left**
  (`.round-label` > `.round-title` = `Round N`, N = array index + 1) spanning all the courts of that
  round, and its `.round-matches` court cards to the right of it. There is no round header row
  above the cards (no `.round-header`); one label per round, not one per court.
- All round sections (plus the admin actions) live in ONE `.round-list` wrapper. Warning card and
  confirm-attendance button stay above it, outside the list.
- Layout (best practice: intrinsic grid tracks + `subgrid`, no fixed widths, no JS measuring):
  `.tournament-desktop .round-list` is a grid sized from the Matches panel with columns
  `max-content | max-content | minmax(0, auto) | max-content | minmax(0, auto)` =
  `round label | court | team 1 | score | team 2`. Every direct child spans all columns.
  `.round-section`, `.round-matches` (columns 2..end) and each `.match-card` use
  `grid-template-columns: subgrid`, so the label, court, score and team columns line up across
  every row of every round. Label vertically centered against its round's cards.
- Works for in-progress and completed tournaments alike.
- No rounds => "No rounds yet" empty state (unchanged), no order control.

### Round order control
- Lives in the Matches panel header (`#matches-order`, a `.panel-actions` group), two buttons:
  **Last round first** (`data-order="desc"`) and **First round first** (`data-order="asc"`, default).
- Active option has `aria-pressed="true"` and `btn-primary`; the other is `btn-secondary`.
- Only rendered when the tournament has **2+ rounds** (nothing to reorder otherwise).
- `desc` = latest round on top, round 1 at the bottom. `asc` = round 1 on top.
- Only the **round sections** swap. Court cards inside a round always stay in court order
  (Court 1, Court 2, …).
- Switching order re-renders only the Matches panel (the Leaderboard is not reloaded).
- Order is page-local state (`matchesOrder`): default `asc` every time a tournament is opened.
  Not persisted.

### One-line court cards, full panel width
- Each match is ONE row, left to right: **court**, **team 1 player 1**, **team 1 player 2**,
  **team 1 score**, `vs`, **team 2 score**, **team 2 player 1**, **team 2 player 2**.
  DOM order of `.match-court`, `.match-team-name`, `.match-score-value`, `.match-vs` matches that
  sequence; a `.match-card` has 4 cells: `.match-court`, `.match-team` (team 1), `.match-score`,
  `.match-team` (team 2).
- Unscored match: no score numbers, only `vs`. For an admin on an in-progress tournament the score
  cell shows the muted `Tap to score` hint (`.match-hint`) instead of `vs`. Non-admins never see
  the hint.
- Rows use the whole Matches panel width (no max-width caps); label, court and score columns take
  their content width, the two team columns grow to the longest team names and share any extra
  width. Team 1 is right-aligned and team 2 left-aligned so names hug the score; scores line up
  in every row.
- Names never wrap. Only when the panel is narrower than the longest teams do the team columns
  shrink (shorter column kept whole first) and names end with `…`. Wider panel => fewer/no cuts
  (measured on real days: 0 cut names at 1920px wide and in the single-column ≤1100px layout).
- Completed matches also show a per-player ELO change badge (`▲16.0` / `▼15.3` / `–`) inside each
  `.match-team-name`, on the inner side of the name (left team `Alice ▲16.0`, right team
  `▼15.3 Charlie`). It only adds text to the name cell: the 4-cell card and the grid columns are
  unchanged. Rules: `.github/features/tournament-management.md` → "Match ELO Change Indicators".
- The round title sits to the left of its cards (see "All rounds visible"), not above them.
- The admin action group (Next Round / End Tournament / Delete Tournament) is capped to `21rem`
  and centered (`.round-actions`).

### Player filter
- `<select id="matches-player-filter">` in the Matches panel header (left of the order control),
  option `All players` (value `""`, default) + every player who has a match that day, sorted
  alphabetically (names taken from the matches of all rounds, `?` placeholders ignored).
- Shown whenever the tournament has 1+ rounds; not rendered with no rounds.
- Choosing a player keeps ONLY the match cards that player is in (any seat, partner or opponent).
  Rounds where the player has no match (sit-out) are hidden entirely.
- Cards keep their real court label and `data-round-idx` / `data-match-idx`, so clicking a
  filtered card still scores/edits the exact right match.
- Works together with the order control (filter first, order applies to what is left).
- Admin actions (Next Round / End Tournament / Delete) and their "latest round fully scored"
  logic are computed from ALL rounds, not the filtered view. They keep the latest round's slot even
  when the filter hides that round.
- Switching the filter re-renders only the Matches panel (Leaderboard not reloaded).
- Page-local state (`playerFilter`, default `""`), not persisted. It survives full re-renders
  (e.g. after scoring); if the chosen player no longer appears in any match the filter resets to
  `All players`.

### Admin behaviour (unchanged rules, new placement)
- Match cards carry `data-round-idx` + `data-match-idx`. Admins click **any** card of an
  in-progress tournament to open the score sheet for that exact round/match
  (`openScoreSheet(roundIdx, matchIdx)`). Completed tournaments / non-admins stay read-only.
- Admin actions (Next Round when the latest round is fully scored, End Tournament, Delete
  Tournament) render directly after the **latest** round section, so they stay next to the active
  round in both orders.
- One warning card `⚠ Editing a previous round will regenerate subsequent rounds` shows at the top
  of the list, **only** for an admin on an in-progress tournament with 2+ rounds
  (previously it was repeated for every past round, even for read-only viewers).
- Confirm-attendance button stays on top (not part of the round list).

### Page header
- Subtitle under the date = `N rounds` (`1 round`, `No rounds`) — replaces `Round X/N`.

## Acceptance (input => expected)
Fixture: 8 players, 3 rounds x 2 courts. Round 1 scores `15-10`, `14-11`; round 2 `13-12`, `16-9`;
round 3 `18-7` and one unscored match.

- Render, default (in-progress or completed) => 6 `.match-card`; `.round-title` =
  `Round 1, Round 2, Round 3`; card scores = `15–10, 14–11, 13–12, 16–9, 18–7, (none)`;
  header subtitle `3 rounds`; button states `asc` pressed, `desc` not.
- Click **Last round first** => `.round-title` = `Round 3, Round 2, Round 1`;
  scores = `18–7, (none), 13–12, 16–9, 15–10, 14–11`; button states `desc` pressed, `asc` not.
- Click **First round first** again => back to the default order.
- Select **Last round first**, then reopen the tournament => `Round 1, Round 2, Round 3`.
- Court labels in either order => `Court 1, Court 2` repeated per round (never reversed).
- Same tournament with 1 round => 2 cards, no `[data-order]` buttons.
- Admin on the 3-round in-progress fixture => `#end-tournament-btn` is after `Round 3` title and
  before the `Round 2` title (desc); after the `Round 3` title (asc); one warning card.
- Completed tournament or non-admin => zero warning cards.
- Admin clicks the round-1 / court-1 card => score sheet inputs prefilled `15` / `10`; clicks the
  round-2 / court-2 card => `16` / `9`.

### One shared grid
- Non-admin default => one `.round-list` whose children are `Round 1, Round 2, Round 3`.
- Admin => `Round 1, Round 2, Round 3, actions`; after **Last round first** =>
  `Round 3, actions, Round 2, Round 1`. The edit warning is outside `.round-list`.
- `css/desktop.css` => `.tournament-desktop .round-list` has `display: grid` and columns exactly
  `max-content max-content minmax(0, auto) max-content minmax(0, auto)`;
  `.tournament-desktop .round-list > *` has `grid-column: 1 / -1`.
- `.round-section`, `.round-matches`, `.round-matches .match-card` each have `display: grid` +
  `grid-template-columns: subgrid` and no `width`/`flex` sizing; `.round-label` is
  `grid-column: 1`, `.round-matches` `grid-column: 2 / -1`, card `grid-column: 1 / -1`.
  No `42rem` and no `.round-header` rule left in `css/desktop.css`.

### Round label on the left
- Default render (3 rounds x 2 courts) => 3 `.round-section`, each with exactly 1 `.round-title`;
  the section's first child is `.round-label` (contains `Round N`), its second child is
  `.round-matches` holding that round's 2 cards. No `.round-header` anywhere.
- A 1-round tournament => 1 section, label `Round 1` left of its 2 cards.
- Player filter on `Dave` => still 1 label per visible round (`Round 1, Round 2, Round 3`), each
  next to its single card.
- No `.tournament-desktop .round-header` rule in `css/desktop.css` (see "One shared grid").

### One-line cards
- Non-admin, default => token sequence of the 1st card (round 1, court 1) =
  `Court 1, Alice, Bob, 15, vs, 10, Carol, Dave`; 2nd card (round 1, court 2) =
  `Court 2, Eve, Frank, 14, vs, 11, Grace, Hank`; 6th card (round 3, court 2, unscored) =
  `Court 2, Carol, Grace, vs, Dave, Hank`.
- Admin => the unscored card reads `Court 2, Carol, Grace, Tap to score, Dave, Hank`.

### Player filter
- Filter options => `All players` + `Alice, Bob, Carol, Dave, Eve, Frank, Grace, Hank`; default `""`.
  A 1-round tournament also shows the filter.
- Pick `Dave` => 3 cards, titles `Round 1, Round 2, Round 3`, scores `15–10, 16–9, (none)`,
  courts `Court 1, Court 2, Court 2` (Dave sits in seat 4, 1 and 3).
- Pick `Frank` => scores `14–11, 16–9, 18–7`, courts `Court 2, Court 2, Court 1`.
- Pick `Alice`, then **Last round first** => scores `18–7, 13–12, 15–10`.
- Pick `All players` again => all 6 cards.
- Admin picks `Frank`, clicks the `14–11` card => score sheet prefilled `14` / `11`
  (round 1, match index 1 — indexes are not re-based by the filter).
- Sit-out fixture (5 players, 1 court, 3 rounds: R1 Alice+Bob vs Carol+Dave `15-10`;
  R2 Alice+Carol vs Bob+Eve `13-12`; R3 Alice+Dave vs Bob+Eve `18-7`):
  pick `Dave` => titles `Round 1, Round 3`; pick `Carol` => titles `Round 1, Round 2`.
- Admin on the sit-out fixture picks `Carol` (round 3 hidden) => exactly one `#end-tournament-btn`
  and one `#next-round-btn`; with last-round-first they come before the first round section, with
  first-round-first after the last card.
- Pick `Alice`, then a full re-render (`tournament-changed`) => select still `Alice`, 3 cards.
  Replace `Hank` by `Ivan` in the data while `Hank` is selected => select resets to `""`, 6 cards.
- Changing the filter does not call `renderDayStatsInto` again (Leaderboard not reloaded).

## Related
- `.github/skills/tab-tournament/SKILL.md` (page reference), `.github/features/desktop-ui.md`
  (desktop layout), `.github/features/tournament-management.md` (scoring / admin rules).
