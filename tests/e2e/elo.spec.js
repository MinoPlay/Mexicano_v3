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

function seedMatchData(page) {
  return page.evaluate((matches) => {
    localStorage.setItem('mexicano_matches', JSON.stringify(matches));
  }, SEED_MATCHES);
}

test.describe('ELO Leaderboard & Charts', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mexicano_test_mode', 'true');
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await seedMatchData(page);
    await page.waitForTimeout(300);
  });

  test('home page shows ELO leaderboard with players', async ({ page }) => {
    // Reload to pick up seeded data
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Verify ELO Leaderboard section
    await expect(page.locator('.card-title').filter({ hasText: 'ELO Leaderboard' })).toBeVisible();

    // Verify leaderboard items exist
    const leaderboardItems = page.locator('.leaderboard-item');
    await expect(leaderboardItems).not.toHaveCount(0);

    // Verify at least our 4 players appear
    const names = await page.locator('.leaderboard-name').allTextContents();
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).toContain('Carol');
    expect(names).toContain('Dave');

    // Verify ELO values are shown
    const eloValues = page.locator('.leaderboard-value');
    const count = await eloValues.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // First ranked player should have gold class
    await expect(page.locator('.leaderboard-rank').first()).toHaveClass(/gold/);

    await page.screenshot({ path: 'tests/screenshots/home-elo-leaderboard.png' });
  });

  test('home page quick stats are populated', async ({ page }) => {
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Verify tournaments count card shows 1
    const statValues = page.locator('.quick-stat-card .stat-value');
    const statLabels = page.locator('.quick-stat-card .stat-label');

    // Find the "Tournaments" stat
    const labels = await statLabels.allTextContents();
    const tournamentsIdx = labels.indexOf('Tournaments');
    expect(tournamentsIdx).toBeGreaterThanOrEqual(0);

    const values = await statValues.allTextContents();
    expect(values[tournamentsIdx].trim()).toBe('1');
  });

  test('ELO charts page renders correctly', async ({ page }) => {
    // Navigate via hash change to preserve localStorage
    await page.evaluate(() => { window.location.hash = '#/elo-charts'; });
    await page.waitForTimeout(1500);

    await expect(page.locator('h1')).toHaveText('ELO Charts');

    // Verify tabs exist and All-Time is active
    const tabs = page.locator('.tabs .tab');
    await expect(tabs.first()).toHaveText('All-Time');
    await expect(tabs.first()).toHaveClass(/active/);

    // Verify the chart area is present (chart-container or fallback text)
    const chartArea = page.locator('.page-content .mt-md');
    await expect(chartArea).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/elo-charts.png' });
  });

  test('ELO charts tab switching works', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#/elo-charts'; });
    await page.waitForTimeout(1500);

    // Both tabs should be present
    const allTimeTab = page.locator('.tabs .tab').filter({ hasText: 'All-Time' });
    const latestTab = page.locator('.tabs .tab').filter({ hasText: 'Latest Tournament' });
    await expect(allTimeTab).toBeVisible();
    await expect(latestTab).toBeVisible();

    // Switch to "Latest Tournament" tab
    await latestTab.click();
    await page.waitForTimeout(1000);

    await expect(latestTab).toHaveClass(/active/);
    await expect(allTimeTab).not.toHaveClass(/active/);

    // Switch back to All-Time
    await allTimeTab.click();
    await page.waitForTimeout(500);
    await expect(allTimeTab).toHaveClass(/active/);
  });

  test('home page links to statistics and ELO charts', async ({ page }) => {
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Verify action links
    const statsLink = page.locator('a[href="#/statistics"]').filter({ hasText: 'View All Statistics' });
    await expect(statsLink).toBeVisible();

    const eloLink = page.locator('a[href="#/elo-charts"]').filter({ hasText: 'ELO Charts' });
    await expect(eloLink).toBeVisible();

    // Click ELO Charts link
    await eloLink.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/elo-charts/);
  });
});
