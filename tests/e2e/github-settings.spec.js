const { test, expect } = require('@playwright/test');

test.describe('GitHub Backend Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    // Clear any existing GitHub config after the page has loaded
    await page.evaluate(() => localStorage.removeItem('mexicano_github_config'));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  // ── Section visibility ─────────────────────────────────────────────────────

  test('GitHub Backend section is visible on settings page', async ({ page }) => {
    const section = page.locator('.settings-section-title').filter({ hasText: 'GitHub Backend' });
    await expect(section).toBeVisible();

    await expect(page.locator('#github-owner')).toBeVisible();
    await expect(page.locator('#github-repo')).toBeVisible();
    await expect(page.locator('#github-pat')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/github-settings-empty.png' });
  });

  // ── Sync icon ──────────────────────────────────────────────────────────────

  test('sync icon is present and shows idle state by default', async ({ page }) => {
    const icon = page.locator('#github-sync-icon');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveText('⬜');
    await expect(icon).toHaveAttribute('title', 'Sync: idle');
  });

  // ── Save config ────────────────────────────────────────────────────────────

  test('save button persists config to localStorage', async ({ page }) => {
    await page.fill('#github-owner', 'myorg');
    await page.fill('#github-repo', 'my-data');
    await page.fill('#github-pat', 'ghp_testtoken123');

    await page.click('#github-save-btn');
    await page.waitForTimeout(300);

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('mexicano_github_config');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored).not.toBeNull();
    expect(stored.owner).toBe('myorg');
    expect(stored.repo).toBe('my-data');
    expect(stored.pat).toBe('ghp_testtoken123');

    await expect(page.locator('#github-status-msg')).toHaveText('Configuration saved.');

    await page.screenshot({ path: 'tests/screenshots/github-settings-saved.png' });
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  test('save shows error when fields are empty', async ({ page }) => {
    await page.click('#github-save-btn');
    await page.waitForTimeout(200);

    await expect(page.locator('#github-status-msg')).toHaveText('All three fields are required.');
  });

  test('test button shows error when fields are empty', async ({ page }) => {
    await page.click('#github-test-btn');
    await page.waitForTimeout(200);

    await expect(page.locator('#github-status-msg')).toHaveText('Fill in all fields before testing.');
  });

  // ── Clear config ───────────────────────────────────────────────────────────

  test('clear button removes config from localStorage and resets inputs', async ({ page }) => {
    // Seed config before reload so pre-fill logic picks it up
    await page.addInitScript(() => {
      localStorage.setItem(
        'mexicano_github_config',
        JSON.stringify({ owner: 'testowner', repo: 'testrepo', pat: 'ghp_abc' })
      );
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Inputs should be pre-filled
    await expect(page.locator('#github-owner')).toHaveValue('testowner');
    await expect(page.locator('#github-repo')).toHaveValue('testrepo');

    await page.click('#github-clear-btn');
    await page.waitForTimeout(200);

    // Inputs should be empty
    await expect(page.locator('#github-owner')).toHaveValue('');
    await expect(page.locator('#github-repo')).toHaveValue('');
    await expect(page.locator('#github-pat')).toHaveValue('');

    // localStorage should be cleared
    const stored = await page.evaluate(() => localStorage.getItem('mexicano_github_config'));
    expect(stored).toBeNull();

    // Sync icon should reset to idle
    await expect(page.locator('#github-sync-icon')).toHaveText('⬜');

    await page.screenshot({ path: 'tests/screenshots/github-settings-cleared.png' });
  });

  // ── Pre-fill from saved config ─────────────────────────────────────────────

  test('existing config is pre-filled in inputs on page load', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'mexicano_github_config',
        JSON.stringify({ owner: 'acme', repo: 'data-store', pat: 'ghp_xyz' })
      );
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page.locator('#github-owner')).toHaveValue('acme');
    await expect(page.locator('#github-repo')).toHaveValue('data-store');
    await expect(page.locator('#github-pat')).toHaveValue('ghp_xyz');
  });

  // ── Push/Pull buttons visible ──────────────────────────────────────────────

  test('Push All and Pull All buttons are visible', async ({ page }) => {
    await expect(page.locator('#github-push-btn')).toBeVisible();
    await expect(page.locator('#github-pull-btn')).toBeVisible();
  });

  test('Push All shows error if no config saved', async ({ page }) => {
    await page.click('#github-push-btn');
    await page.waitForTimeout(300);

    await expect(page.locator('#github-status-msg')).toHaveText('Save a valid config first.');
  });

  test('Pull All shows error if no config saved', async ({ page }) => {
    await page.click('#github-pull-btn');
    await page.waitForTimeout(300);

    await expect(page.locator('#github-status-msg')).toHaveText('Save a valid config first.');
  });
});
