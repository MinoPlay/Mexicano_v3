const { test, expect } = require('@playwright/test');

const SEED_MATCHES = [
  {
    date: '2026-01-15',
    roundNumber: 1,
    team1Player1Name: 'Alice',
    team1Player2Name: 'Dave',
    team2Player1Name: 'Bob',
    team2Player2Name: 'Carol',
    scoreTeam1: 15,
    scoreTeam2: 10,
    _key: '2026-01-15_R1M1'
  },
  {
    date: '2026-01-15',
    roundNumber: 2,
    team1Player1Name: 'Alice',
    team1Player2Name: 'Carol',
    team2Player1Name: 'Dave',
    team2Player2Name: 'Bob',
    scoreTeam1: 13,
    scoreTeam2: 12,
    _key: '2026-01-15_R2M1'
  }
];

test.describe('Statistics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mexicano_test_mode', 'true');
    });
    // Seed match data
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate((matches) => {
      localStorage.setItem('mexicano_matches', JSON.stringify(matches));
    }, SEED_MATCHES);
    await page.goto('/#/statistics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('statistics table renders with player names', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Statistics');

    // Table should be visible
    const table = page.locator('.data-table table');
    await expect(table).toBeVisible();

    // All 4 players should appear
    const nameCells = page.locator('.data-table tbody .name-cell');
    const names = await nameCells.allTextContents();
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).toContain('Carol');
    expect(names).toContain('Dave');

    await page.screenshot({ path: 'tests/screenshots/statistics-table.png' });
  });

  test('statistics show correct data', async ({ page }) => {
    // Alice played 2 games, won both (15>10 and 13>12)
    // Find Alice's row
    const rows = page.locator('.data-table tbody tr');
    const count = await rows.count();

    let aliceRow = null;
    for (let i = 0; i < count; i++) {
      const nameText = await rows.nth(i).locator('.name-cell').textContent();
      if (nameText.trim() === 'Alice') {
        aliceRow = rows.nth(i);
        break;
      }
    }

    expect(aliceRow).not.toBeNull();

    // Alice: 2 wins, 0 losses, total points = 15 + 13 = 28
    const cells = aliceRow.locator('.num-cell');
    const cellTexts = await cells.allTextContents();
    // Columns order: W, L, Pts, Avg, Win%, TW, SW, DW
    expect(cellTexts[0].trim()).toBe('2');  // W
    expect(cellTexts[1].trim()).toBe('0');  // L
    expect(cellTexts[2].trim()).toBe('28'); // Pts
  });

  test('filter chips work', async ({ page }) => {
    // "All Time" chip should be selected by default
    const allTimeChip = page.locator('.chip').filter({ hasText: 'All Time' });
    await expect(allTimeChip).toHaveClass(/selected/);

    // Click "Latest" chip
    const latestChip = page.locator('.chip').filter({ hasText: 'Latest' });
    await latestChip.click();
    await page.waitForTimeout(300);

    await expect(latestChip).toHaveClass(/selected/);

    // Table should still show data (only one tournament date)
    await expect(page.locator('.data-table table')).toBeVisible();
  });

  test('click player name opens profile dialog', async ({ page }) => {
    // Click on a player name
    const aliceCell = page.locator('.data-table tbody .name-cell').filter({ hasText: 'Alice' });
    await aliceCell.first().click();
    await page.waitForTimeout(500);

    // Profile dialog should open
    const dialog = page.locator('.dialog-overlay.active .dialog');
    await expect(dialog).toBeVisible();

    // Dialog should show player name
    await expect(dialog.locator('h2')).toContainText('Alice');

    // Tabs should be present
    const tabs = dialog.locator('.tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText('Overview');
    await expect(tabs.nth(1)).toHaveText('Head-to-Head');
    await expect(tabs.nth(2)).toHaveText('Partners');

    // Overview tab should be active and show stats
    await expect(tabs.nth(0)).toHaveClass(/active/);
    await expect(dialog.locator('.quick-stat-card')).not.toHaveCount(0);

    await page.screenshot({ path: 'tests/screenshots/player-profile.png' });

    // Switch to Head-to-Head tab
    await tabs.nth(1).click();
    await page.waitForTimeout(300);
    await expect(tabs.nth(1)).toHaveClass(/active/);

    // Switch to Partners tab
    await tabs.nth(2).click();
    await page.waitForTimeout(300);
    await expect(tabs.nth(2)).toHaveClass(/active/);

    // Close dialog
    await dialog.locator('.dialog-close').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.dialog-overlay.active')).toHaveCount(0);
  });
});
