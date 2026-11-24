/**
 * Stories, polls, emoji reactions, #hashtags, @mentions, Explore, directory and dark mode
 * (sample accounts from scripts/demo-data.mjs, emulator only).
 */
import { execFileSync } from 'node:child_process';
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

test('Gen Z features', async ({ page }) => {
  for (const url of ['http://127.0.0.1:8080', 'http://127.0.0.1:9099']) {
    await expect.poll(() => fetch(url).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
  }
  execFileSync('node', ['scripts/demo-data.mjs'], { stdio: 'ignore' });
  const tag = `fest${Date.now().toString(36)}`;

  await signIn(page, 'ama_serwaa');

  // Poll post with a hashtag and a mention.
  await page.goto('/new?town=mempeasem');
  await page.getByLabel('Your post').fill(`Which day for the #${tag} clean-up, @kofi_mensah?`);
  await page.getByRole('button', { name: '📊 Add a poll' }).click();
  await page.getByPlaceholder('Option 1').fill('Saturday');
  await page.getByPlaceholder('Option 2').fill('Sunday');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Your post is live.')).toBeVisible();
  const postedAt = Date.now();
  await page.getByRole('button', { name: 'Saturday' }).click();
  await expect(page.getByText('1 vote')).toBeVisible();
  await expect(page.getByRole('link', { name: `#${tag}` })).toBeVisible();

  // Emoji reaction.
  await page.getByRole('button', { name: 'Choose a reaction' }).click();
  await page.getByRole('menuitem', { name: 'React fire' }).click();
  await expect(page.getByRole('button', { name: 'Unlike' })).toBeVisible();

  // Hashtag page and Explore trending.
  await page.getByRole('link', { name: `#${tag}` }).click();
  await expect(page.getByRole('heading', { name: `#${tag}` })).toBeVisible();
  await page.getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(`#${tag}`) })).toBeVisible();
  await expect(page.getByText('Town spirit this week')).toBeVisible();

  // Directory: add a job.
  await page.getByRole('link', { name: /Jobs/ }).click();
  await page.getByRole('link', { name: 'Add' }).click();
  await page.getByLabel('Title').fill(`Shop assistant ${tag}`);
  await page.getByLabel('Category').fill('Retail');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Sent for approval')).toBeVisible();

  // Story (text).
  await page.goto('/stories/new');
  await page.getByLabel('Story text').fill('Good morning Akpafu ☀️');
  await page.getByRole('button', { name: 'Share to your story' }).click();
  await expect(page.getByText('Your story is up for 24 hours')).toBeVisible();
  await page.getByRole('button', { name: 'View story' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Story' }).getByText('Good morning Akpafu ☀️')).toBeVisible();
  await page.getByRole('button', { name: 'Close story' }).click();

  // Predictions league: predict the score of an upcoming match; the league shows sample points.
  await page.goto('/sports/m2');
  await page.getByRole('button', { name: 'Todzi one more' }).click();
  await page.getByRole('button', { name: 'Save prediction' }).click();
  await expect(page.getByText('Prediction saved: Todzi 1 – 0 Adokor')).toBeVisible();
  await page.goto('/sports?tab=predictions');
  await expect(page.getByText('Top predictors')).toBeVisible();
  await expect(page.getByText(/You: #1 with 3 points/)).toBeVisible();

  // Repost (posting has a short cool-down after the poll above).
  await page.waitForTimeout(Math.max(0, 21_000 - (Date.now() - postedAt)));
  await page.goto('/?town=all');
  await page.getByRole('button', { name: 'Repost' }).first().click();
  await page.getByRole('menuitem', { name: 'Repost' }).click();
  await expect(page.getByText('Reposted 🔁')).toBeVisible();

  // Bio + dark mode.
  await page.goto('/settings');
  await page.getByLabel('Bio').fill('Proud daughter of Mempeasem 💚');
  await page.getByRole('button', { name: '🔥' }).click();
  await page.getByRole('button', { name: 'Save bio' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await page.getByRole('radio', { name: '🌙 Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', { name: '☀️ Light' }).click();
  await signOutAndCheckMention(page);
});

async function signOutAndCheckMention(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await signIn(page, 'kofi_mensah');
  await page.getByRole('link', { name: /Notifications/ }).click();
  await expect(page.getByText('mentioned you in a post')).toBeVisible();
}
