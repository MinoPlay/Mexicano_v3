const { test, expect } = require('@playwright/test');

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mexicano_test_mode', 'true');
    });
    await page.goto('/#/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('navigate to settings page via bottom nav', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.click('a[data-path="/settings"]');
    await page.waitForTimeout(500);

    await expect(page).toHaveURL(/#\/settings/);
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  test('add members to the list', async ({ page }) => {
    const input = page.locator('#new-member-input');
    const addBtn = page.locator('#add-member-form button[type="submit"]');

    // Add first member
    await input.fill('Alice');
    await addBtn.click();
    await page.waitForTimeout(300);

    // Add second member
    await input.fill('Bob');
    await addBtn.click();
    await page.waitForTimeout(300);

    // Add third member
    await input.fill('Carol');
    await addBtn.click();
    await page.waitForTimeout(300);

    // Verify all members appear
    const memberItems = page.locator('#members-list .member-item');
    await expect(memberItems).toHaveCount(3);
    await expect(page.locator('.member-item[data-name="Alice"]')).toBeVisible();
    await expect(page.locator('.member-item[data-name="Bob"]')).toBeVisible();
    await expect(page.locator('.member-item[data-name="Carol"]')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/settings-members.png' });
  });

  test('reject duplicate member', async ({ page }) => {
    // Seed a member
    await page.evaluate(() => {
      localStorage.setItem('mexicano_members', JSON.stringify(['Alice']));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const input = page.locator('#new-member-input');
    const addBtn = page.locator('#add-member-form button[type="submit"]');

    // Try adding duplicate (case-insensitive)
    await input.fill('Alice');
    await addBtn.click();
    await page.waitForTimeout(300);

    // Should still only have 1 member
    const memberItems = page.locator('#members-list .member-item');
    await expect(memberItems).toHaveCount(1);
  });

  test('remove a member', async ({ page }) => {
    // Seed members
    await page.evaluate(() => {
      localStorage.setItem('mexicano_members', JSON.stringify(['Alice', 'Bob', 'Carol']));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page.locator('#members-list .member-item')).toHaveCount(3);

    // Handle the confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Click delete on Bob
    await page.locator('.member-item[data-name="Bob"] .member-delete').click();
    await page.waitForTimeout(300);

    // Verify Bob is removed
    await expect(page.locator('#members-list .member-item')).toHaveCount(2);
    await expect(page.locator('.member-item[data-name="Bob"]')).toHaveCount(0);
    await expect(page.locator('.member-item[data-name="Alice"]')).toBeVisible();
    await expect(page.locator('.member-item[data-name="Carol"]')).toBeVisible();
  });

  test('select current user from dropdown', async ({ page }) => {
    // Seed members
    await page.evaluate(() => {
      localStorage.setItem('mexicano_members', JSON.stringify(['Alice', 'Bob']));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const select = page.locator('#settings-user-select');
    await select.selectOption('Alice');
    await page.waitForTimeout(300);

    // Verify avatar updates to show 'A'
    await expect(page.locator('#settings-avatar')).toHaveText('A');

    // Verify localStorage was updated
    const currentUser = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mexicano_current_user'))
    );
    expect(currentUser).toBe('Alice');
  });

  test('export data initiates download', async ({ page }) => {
    // Seed some data to export
    await page.evaluate(() => {
      localStorage.setItem('mexicano_members', JSON.stringify(['Alice']));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Listen for download event
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    // Verify download file name pattern
    expect(download.suggestedFilename()).toMatch(/^mexicano-backup-.*\.json$/);
  });

  test('theme toggle changes data-theme attribute', async ({ page }) => {
    // Default should be light
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Click theme toggle
    await page.locator('#theme-toggle').click();
    await page.waitForTimeout(300);

    // Should now be dark
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.screenshot({ path: 'tests/screenshots/settings-dark-theme.png' });

    // Toggle back
    await page.locator('#theme-toggle').click();
    await page.waitForTimeout(300);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
