const { test, expect } = require('@playwright/test');

test.describe('Tournament Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mexicano_test_mode', 'true');
    });
    // Seed 4 members via localStorage
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      localStorage.setItem('mexicano_members', JSON.stringify(['Alice', 'Bob', 'Carol', 'Dave']));
      // Clear any existing tournament data
      localStorage.removeItem('mexicano_active_tournament');
      localStorage.removeItem('mexicano_matches');
    });
    await page.waitForTimeout(300);
  });

  test('full tournament lifecycle: create, score, next round, complete', async ({ page }) => {
    // Navigate to create tournament
    await page.goto('/#/create-tournament');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page.locator('h1')).toHaveText('New Tournament');

    // Date should default to today
    const dateInput = page.locator('#tournament-date');
    const today = new Date().toISOString().split('T')[0];
    await expect(dateInput).toHaveValue(today);

    // Select 4 players
    await page.locator('[data-count="4"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-count="4"]')).toHaveClass(/selected/);

    // Verify 4 player input slots appeared
    const playerSlots = page.locator('#player-slots .player-slot');
    await expect(playerSlots).toHaveCount(4);

    // Fill in player names
    const playerInputs = page.locator('#player-slots .player-slot input');
    await playerInputs.nth(0).fill('Alice');
    await playerInputs.nth(1).fill('Bob');
    await playerInputs.nth(2).fill('Carol');
    await playerInputs.nth(3).fill('Dave');

    await page.screenshot({ path: 'tests/screenshots/create-tournament.png' });

    // Click Start Tournament
    const startBtn = page.locator('#start-btn');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await page.waitForTimeout(1000);

    // Verify navigation to tournament page
    await expect(page).toHaveURL(new RegExp(`#/tournament/${today}`));

    // Verify Round 1 is displayed
    await expect(page.locator('.badge-primary')).toHaveText('In Progress');

    // Verify 1 match card for 4 players (1 court)
    const matchCards = page.locator('.match-card');
    await expect(matchCards).toHaveCount(1);

    // Verify match card shows "Tap to score"
    await expect(matchCards.first()).toContainText('Tap to score');

    await page.screenshot({ path: 'tests/screenshots/tournament-round1.png' });

    // Click the match card to open score input
    await matchCards.first().click();
    await page.waitForTimeout(500);

    // Verify score input bottom sheet opened
    await expect(page.locator('.bottom-sheet.active')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/score-input.png' });

    // Click the 15-10 preset button
    await page.locator('.score-preset[data-s1="15"][data-s2="10"]').click();
    await page.waitForTimeout(200);

    // Verify score fields populated
    await expect(page.locator('#score1')).toHaveValue('15');
    await expect(page.locator('#score2')).toHaveValue('10');

    // Confirm the score
    await page.locator('#score-confirm').click();
    await page.waitForTimeout(500);

    // Verify score displays on match card
    const scoreValues = page.locator('.match-card .match-score-value');
    await expect(scoreValues.first()).toHaveText('15');
    await expect(scoreValues.last()).toHaveText('10');

    // Verify match card has 'completed' class
    await expect(page.locator('.match-card').first()).toHaveClass(/completed/);

    await page.screenshot({ path: 'tests/screenshots/tournament-scored.png' });

    // Click "Next Round" to generate round 2
    const nextRoundBtn = page.locator('#next-round-btn');
    await expect(nextRoundBtn).toBeVisible();
    await nextRoundBtn.click();
    await page.waitForTimeout(500);

    // Verify round 2 appears (round navigation should now be visible)
    await expect(page.locator('.match-card')).toHaveCount(1);
    // The match card should show "Tap to score" (unscored)
    await expect(page.locator('.match-card').first()).toContainText('Tap to score');

    // Score round 2
    await page.locator('.match-card').first().click();
    await page.waitForTimeout(500);
    await page.locator('.score-preset[data-s1="13"][data-s2="12"]').click();
    await page.waitForTimeout(200);
    await page.locator('#score-confirm').click();
    await page.waitForTimeout(500);

    // Verify round 2 scored
    const round2ScoreValues = page.locator('.match-card .match-score-value');
    await expect(round2ScoreValues.first()).toHaveText('13');
    await expect(round2ScoreValues.last()).toHaveText('12');

    // Click "End Tournament"
    const endBtn = page.locator('#end-tournament-btn');
    await expect(endBtn).toBeVisible();
    await endBtn.click();
    await page.waitForTimeout(300);

    // Confirm dialog should appear
    await expect(page.locator('.dialog-overlay')).toBeVisible();
    await page.locator('#dialog-confirm').click();
    await page.waitForTimeout(500);

    // Verify tournament is now completed
    await expect(page.locator('.badge-success')).toHaveText('Completed');

    await page.screenshot({ path: 'tests/screenshots/tournament-complete.png' });

    // Navigate to tournaments list and verify tournament appears
    await page.goto('/#/tournaments');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // The tournament should appear in the list
    const tournamentItem = page.locator(`.tournament-list-item[data-date="${today}"]`);
    await expect(tournamentItem).toBeVisible();
    await expect(tournamentItem).toContainText('4 players');
  });

  test('create tournament page validation - empty names', async ({ page }) => {
    await page.goto('/#/create-tournament');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Select 4 players
    await page.locator('[data-count="4"]').click();
    await page.waitForTimeout(300);

    // Leave player names empty and try to start
    await page.locator('#start-btn').click();
    await page.waitForTimeout(300);

    // Error should be visible
    const slotsError = page.locator('#slots-error');
    await expect(slotsError).not.toHaveClass(/hidden/);
    await expect(slotsError).toContainText('required');
  });

  test('start button disabled until player count selected', async ({ page }) => {
    await page.goto('/#/create-tournament');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Start button should be disabled initially
    await expect(page.locator('#start-btn')).toBeDisabled();

    // Select count
    await page.locator('[data-count="4"]').click();
    await page.waitForTimeout(300);

    // Start button should now be enabled
    await expect(page.locator('#start-btn')).toBeEnabled();
  });
});
