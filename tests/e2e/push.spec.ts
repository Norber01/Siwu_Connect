/**
 * Phone notifications in the browser: the "turn on" prompt and the choices in Settings.
 * (Delivery itself is tested in apps/api/test/push.test.ts; the dev server has no service worker.)
 */
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('notification prompt and choices', async ({ page }) => {
  // Headless Chrome always reports notifications as blocked; act like a phone that has not been asked yet.
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'default' }));
  for (const url of ['http://127.0.0.1:8080', 'http://127.0.0.1:9099']) {
    await expect.poll(() => fetch(url).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
  }
  execFileSync('node', ['scripts/demo-data.mjs'], { stdio: 'ignore' });
  await page.goto('/login');
  await page.getByLabel('Email').fill('kofi_mensah@example.com');
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  // A friendly prompt on the home page, which "Not now" hides.
  const prompt = page.getByText('Don’t miss messages and goals');
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Turn on', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(prompt).toHaveCount(0);

  // Settings: choose what to be notified about; it is saved for all devices.
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeVisible({ timeout: 15_000 });
  const likes = page.getByRole('checkbox', { name: /Reactions and reposts/ });
  await expect(likes).toBeChecked();
  // Members don't see the staff option.
  await expect(page.getByRole('checkbox', { name: /Reports and approvals/ })).toHaveCount(0);
  let saved = page.waitForResponse((r) => r.url().endsWith('/push/prefs') && r.request().method() === 'POST');
  await likes.uncheck();
  expect((await saved).status()).toBe(200);
  saved = page.waitForResponse((r) => r.url().endsWith('/push/prefs') && r.request().method() === 'POST');
  await page.getByText('All matches').click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Reactions and reposts/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'All matches' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Messages/ })).toBeChecked();
});
