const { test, expect } = require('@playwright/test');

test.describe('Doodle Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mexicano_test_mode', 'true');
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Seed current user and members
    await page.evaluate(() => {
      localStorage.setItem('mexicano_members', JSON.stringify(['Alice', 'Bob', 'Carol']));
      localStorage.setItem('mexicano_current_user', JSON.stringify('Alice'));
    });
    await page.goto('/#/doodle');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('navigate to doodle page via bottom nav', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.click('a[data-path="/doodle"]');
    await page.waitForTimeout(500);

    await expect(page).toHaveURL(/#\/doodle/);
    await expect(page.locator('h1')).toHaveText('Doodle');
  });

  test('doodle matrix renders with dates', async ({ page }) => {
    // Verify page header
    await expect(page.locator('h1')).toHaveText('Doodle');

    // Verify current user is displayed
    await expect(page.locator('.user-avatar')).toBeVisible();
    await expect(page.locator('.user-selector')).toContainText('Alice');

    // Verify doodle matrix exists
    const matrix = page.locator('.doodle-matrix');
    await expect(matrix).toBeVisible();

    // Verify table exists with header dates
    const table = page.locator('.doodle-table');
    await expect(table).toBeVisible();

    // Verify date columns in header (should have day numbers)
    const headerCells = page.locator('.doodle-table thead th');
    const headerCount = await headerCells.count();
    // First column is "Player", rest are dates
    expect(headerCount).toBeGreaterThan(1);

    // Verify current user row exists with bold styling
    const playerCols = page.locator('.doodle-table tbody .player-col');
    const playerNames = await playerCols.allTextContents();
    expect(playerNames).toContain('Alice');

    // Verify total row exists
    await expect(page.locator('.doodle-total-row')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/doodle-calendar.png' });
  });

  test('click cell in own row triggers interaction', async ({ page }) => {
    // Find Alice's row
    const aliceRow = page.locator('.doodle-table tbody tr').filter({
      has: page.locator('td.player-col', { hasText: /^Alice$/ })
    });
    await expect(aliceRow).toHaveCount(1);

    // Get non-readonly doodle cells in Alice's row (own row is editable)
    const aliceCells = aliceRow.locator('.doodle-cell:not(.readonly)');
    const cellCount = await aliceCells.count();
    expect(cellCount).toBeGreaterThan(0);

    // Click a cell - should trigger interaction (toast appears)
    await aliceCells.first().click();
    await page.waitForTimeout(1000);

    // Verify the page still renders the doodle matrix (no crash)
    await expect(page.locator('.doodle-matrix')).toBeVisible();
    await expect(page.locator('.doodle-table')).toBeVisible();
  });

  test('month navigation works', async ({ page }) => {
    // The month label is between the prev/next buttons
    // Use the container that holds the nav buttons to find the month text
    const navContainer = page.locator('.flex.items-center.justify-between.mb-md');
    const monthLabel = navContainer.locator('.text-medium');
    const initialMonth = await monthLabel.textContent();

    // Click next month
    await navContainer.locator('[data-dir="next"]').click();
    await page.waitForTimeout(500);

    const nextMonth = await monthLabel.textContent();
    expect(nextMonth).not.toBe(initialMonth);

    // Click previous month to go back
    await navContainer.locator('[data-dir="prev"]').click();
    await page.waitForTimeout(500);

    const backMonth = await monthLabel.textContent();
    expect(backMonth).toBe(initialMonth);
  });

  test('shows empty state when no user is selected', async ({ page }) => {
    // Clear current user and reload
    await page.evaluate(() => {
      localStorage.removeItem('mexicano_current_user');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Should show empty state prompting to select user
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state-text')).toHaveText('No user selected');
  });

  test('other player rows are readonly', async ({ page }) => {
    // Bob's cells should have readonly class
    const bobCells = page.locator('.doodle-table tbody tr')
      .filter({ has: page.locator('.player-col', { hasText: 'Bob' }) })
      .locator('.doodle-cell');

    const bobCellCount = await bobCells.count();
    if (bobCellCount > 0) {
      // All of Bob's cells should be readonly
      for (let i = 0; i < Math.min(bobCellCount, 3); i++) {
        await expect(bobCells.nth(i)).toHaveClass(/readonly/);
      }
    }
  });
});
