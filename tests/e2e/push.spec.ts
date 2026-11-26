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
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: /Notifications/ }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
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

test('settings are grouped, and autoplay can be switched off', async ({ page }) => {
  execFileSync('node', ['scripts/demo-data.mjs'], { stdio: 'ignore' });
  await page.goto('/login');
  await page.getByLabel('Email').fill('kofi_mensah@example.com');
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.goto('/settings');
  const list = page.getByRole('navigation', { name: 'Settings' });
  for (const name of ['Profile', 'Privacy', 'Notifications', 'Videos and data', 'Appearance', 'Help and feedback', 'Account']) {
    await expect(list.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  }
  await list.getByRole('link', { name: /Videos and data/ }).click();
  const autoplay = page.getByRole('checkbox', { name: /Autoplay videos/ });
  await expect(autoplay).toBeChecked();
  await autoplay.uncheck();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Autoplay videos/ })).not.toBeChecked();
});

test('comments can be liked and replied to', async ({ page }) => {
  execFileSync('node', ['scripts/demo-data.mjs'], { stdio: 'ignore' });
  await page.goto('/login');
  await page.getByLabel('Email').fill('kofi_mensah@example.com');
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.goto('/p/p2');
  const tag = Date.now().toString(36);
  await page.getByLabel('Add a comment').fill(`Akwaaba ${tag}`);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const mine = page.getByRole('article', { name: 'Comment' }).filter({ hasText: `Akwaaba ${tag}` });
  await expect(mine).toBeVisible();
  await mine.getByRole('button', { name: 'Like comment' }).click();
  await expect(mine.getByRole('button', { name: 'Unlike comment' })).toContainText('1');
  await mine.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByText('Replying to Kofi Mensah')).toBeVisible();
  await page.waitForTimeout(5200); // one comment every 5 seconds
  await page.getByLabel('Add a comment').fill(`Thanks ${tag}`);
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click(); // the send button (above the list)
  await expect(page.getByRole('list', { name: 'Replies' }).getByText(`Thanks ${tag}`)).toBeVisible();
  await page.screenshot({ path: '/tmp/claude-0/comments.png' });
});

test('stickers in chat, including your own from the gallery', async ({ page }) => {
  execFileSync('node', ['scripts/demo-data.mjs'], { stdio: 'ignore' });
  await page.goto('/login');
  await page.getByLabel('Email').fill('kofi_mensah@example.com');
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.goto('/chat/room_all');
  await page.getByRole('button', { name: 'Stickers and emoji' }).click();
  await page.getByRole('button', { name: 'Send sticker Akwaaba!' }).click();
  await expect(page.getByRole('img', { name: 'Sticker: Akwaaba!' }).last()).toBeVisible();
  // My stickers: make one from a picture.
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await page.getByLabel('Choose a picture for a sticker').setInputFiles('apps/web/public/icon-512.png');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Sticker added')).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Send my sticker' }).first().click();
  await expect(page.getByRole('img', { name: 'Sticker' }).last()).toBeVisible();
  // Emoji go into the message box.
  await page.getByRole('tab', { name: 'Emoji' }).click();
  await page.getByRole('button', { name: 'Add 🔥' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('🔥');
  await page.screenshot({ path: '/tmp/claude-0/stickers.png' });
});
