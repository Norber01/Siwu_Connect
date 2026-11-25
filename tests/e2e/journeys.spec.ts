/**
 * Phase 1 user journeys (brief §5) and key acceptance criteria (§13),
 * exercised in a real browser against the local emulators + API Worker.
 * All data here is TEST DATA in the demo-siwu emulator project.
 */
import { execFileSync } from 'node:child_process';
import { type Page, expect, test } from '@playwright/test';

const PROJECT = 'demo-siwu';
const run = Date.now().toString(36);

async function waitFor(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${url} did not start`);
}

async function resetEmulators() {
  await waitFor('http://127.0.0.1:8080');
  await waitFor('http://127.0.0.1:9099');
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  execFileSync('node', ['scripts/admin-cli.mjs', 'seed-towns'], { stdio: 'ignore' });
}

async function register(page: Page, opts: { email: string; name: string; username: string; town: string; photo?: boolean }) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByRole('link', { name: 'Create Account' }).click();
  await page.getByLabel('Email').fill(opts.email);
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
  await page.getByLabel('Username').fill(opts.username);
  await expect(page.getByText(`@${opts.username} is available`)).toBeVisible();
  await page.getByLabel('Display name').fill(opts.name);
  await page.getByRole('radio', { name: opts.town }).check();
  await page.getByLabel('Where do you live now? (optional)').selectOption('abroad');
  await page.getByLabel('Country (optional)').selectOption('GB');
  if (opts.photo) {
    await page.getByLabel('Choose profile photo').setInputFiles('apps/web/public/icon-512.png');
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Finish and enter Siwu Connect' }).click();
  await expect(page.getByRole('tab', { name: opts.town })).toBeVisible();
}

async function signOut(page: Page) {
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/welcome/);
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('Phase 1 journeys', async ({ page }, info) => {
  await resetEmulators();
  const alice = { email: `alice-${run}@example.com`, name: 'Ama Mensah', username: `ama_${run}`.slice(0, 20), town: 'Akpafu Odomi' };
  const bob = { email: `bob-${run}@example.com`, name: 'Kofi Asante', username: `kofi_${run}`.slice(0, 20), town: 'Akpafu Todzi' };
  const carol = { email: `carol-${run}@example.com`, name: 'Siwu Admin', username: `boss_${run}`.slice(0, 20), town: 'Akpafu Adokor' };
  const postText = `Clean-up day at the Odomi market on Saturday ${run}`;

  // Journey 1–2: register, choose town, see own town feed (empty state).
  await register(page, { ...alice, photo: true });
  await expect(page.getByText('No posts in Akpafu Odomi yet')).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-1-home-empty.png` });

  // Journey 4: publish a text post.
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: /^Post/ }).click();
  await page.getByLabel('Your post').fill(postText);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Your post is live.')).toBeVisible();
  await expect(page.getByText(postText)).toBeVisible();

  // Edit own post.
  await page.getByRole('button', { name: 'Post actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit post' }).click();
  await page.getByLabel('Your post').fill(`${postText} — bring brooms`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('bring brooms')).toBeVisible();
  await expect(page.getByText('edited')).toBeVisible();

  // Profile shows hometown and the post.
  if (await page.getByRole('button', { name: 'More', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'More', exact: true }).click(); // phone: side menu from "More"
  }
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: alice.name })).toBeVisible();
  await expect(page.getByText('Lives in United Kingdom')).toBeVisible();
  await expect(page.getByText('bring brooms')).toBeVisible();
  await signOut(page);

  // Bob from Todzi: town feed must NOT show the Odomi post; Akpafu-wide feed must.
  await register(page, bob);
  await expect(page.getByText('No posts in Akpafu Todzi yet')).toBeVisible();
  await expect(page.getByText(postText)).toHaveCount(0);
  await page.getByRole('tab', { name: 'All Akpafu' }).click();
  await expect(page.getByText(postText)).toBeVisible();

  // Like (no duplicates) and comment.
  const like = page.getByRole('button', { name: 'Like', exact: true });
  await like.click();
  await expect(page.getByRole('button', { name: 'Unlike' })).toBeVisible();
  await page.waitForTimeout(1500); // let the like reach the server before the full page reload
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unlike' })).toBeVisible(); // persisted, still one like
  await page.getByText(postText).click();
  await page.getByLabel('Add a comment').fill('I will be there with my family.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('I will be there with my family.')).toBeVisible();

  // Journey 6: report the post.
  await page.getByRole('button', { name: 'Post actions' }).click();
  await page.getByRole('menuitem', { name: 'Report post' }).click();
  await page.getByRole('radio', { name: 'Spam or scam' }).check();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('A moderator will review your report.')).toBeVisible();

  // Search finds the post and the person.
  await page.goto(`/search?q=${run}`);
  await expect(page.getByText(postText)).toBeVisible();
  await page.goto(`/search?q=ama&tab=people`);
  await expect(page.getByText(alice.name)).toBeVisible();

  // Ordinary users have no admin area.
  await expect(page.getByRole('link', { name: 'Admin area' })).toHaveCount(0);
  await signOut(page);

  // Super Admin (granted with the admin CLI, as at launch).
  await register(page, carol);
  execFileSync('node', ['scripts/admin-cli.mjs', 'grant-super-admin', carol.username], { stdio: 'ignore' });
  await page.reload();
  await page.getByRole('link', { name: 'Admin area' }).click();

  // Journey 5: publish an announcement for all five towns.
  await page.getByRole('link', { name: 'Announcements' }).click();
  await page.getByLabel('Title').fill('Akpafu Youth Meeting');
  await page.getByLabel('Message').fill('All youth are invited to the meeting on 1 December at Odomi.');
  await page.getByRole('button', { name: 'Publish announcement' }).click();
  await expect(page.getByText('Announcement published.')).toBeVisible();

  // Journey 6 (moderator side): review and resolve the report.
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByText('Spam or scam')).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-2-admin-reports.png` });
  await page.getByRole('button', { name: 'Remove content' }).click();
  await expect(page.getByText('Action taken. Report resolved.')).toBeVisible();
  await expect(page.getByText('No open reports')).toBeVisible();

  // Audit log records the actions.
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('report.remove_content')).toBeVisible();
  await expect(page.getByText('announcement.create')).toBeVisible();
  await signOut(page);

  // Bob sees the announcement and the removed post is gone.
  await signIn(page, bob.email);
  await expect(page.getByText('Akpafu Youth Meeting')).toBeVisible();
  await page.getByRole('tab', { name: 'All Akpafu' }).click();
  await expect(page.getByText('Akpafu Youth Meeting')).toBeVisible();
  await expect(page.getByText(postText)).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}-3-feed-announcement.png`, fullPage: true });
});

test('signed-out visitors cannot see community content', async ({ page }) => {
  await page.goto('/towns/odomi');
  await expect(page).toHaveURL(/\/welcome/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/welcome/);
  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: 'Community rules' })).toBeVisible();
});

test('password reset flow is available', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill('someone@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/we've sent a link to reset your password/)).toBeVisible();
});
