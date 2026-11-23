/**
 * The founder's one-time setup from a phone (emulator: rules/indexes are skipped,
 * towns and Super Admin are real). FOUNDER_EMAIL comes from apps/api/.dev.vars.
 */
import { expect, test } from '@playwright/test';

const PROJECT = 'demo-siwu';

test('founder runs first-time setup and becomes Super Admin', async ({ page }) => {
  for (const url of ['http://127.0.0.1:8080', 'http://127.0.0.1:9099']) {
    await expect.poll(() => fetch(url).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
  }
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  // A stranger cannot run it.
  await page.goto('/register');
  await page.getByLabel('Email').fill('stranger@example.com');
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.goto('/setup');
  await expect(page.getByText(/Only the founder account can run the setup|verify your email/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up Siwu Connect' })).toBeDisabled();
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/welcome/);

  // The founder signs up, verifies the email, then runs setup.
  await page.goto('/register');
  await page.getByLabel('Email').fill('founder@example.com');
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name: /first-time setup/ }).click();
  await expect(page.getByText(/verify your email/)).toBeVisible();
  const accounts = (await (
    await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
      method: 'POST',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: '{}',
    })
  ).json()) as { userInfo: { localId: string; email: string }[] };
  const founder = accounts.userInfo.find((u) => u.email === 'founder@example.com')!;
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ localId: founder.localId, emailVerified: true }),
  });
  await page.getByRole('button', { name: 'I have verified' }).click();
  await page.getByRole('button', { name: 'Set up Siwu Connect' }).click();
  await expect(page.getByText('🎉 Siwu Connect is set up!')).toBeVisible();
  await expect(page.getByText('5 towns ready: Odomi, Mempeasem, Todzi, Adokor, Sokpo.')).toBeVisible();
  await expect(page.getByText('Your account is now Super Admin.')).toBeVisible();

  // Then creates the profile and lands in the app with admin access.
  await page.getByRole('link', { name: 'Next: create your profile' }).click();
  await page.getByLabel('Username').fill('siwu_admin');
  await page.getByLabel('Display name').fill('Siwu Connect');
  await page.getByRole('radio', { name: 'Akpafu Sokpo' }).check();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Finish and enter Siwu Connect' }).click();
  await expect(page.getByRole('link', { name: 'Admin area' })).toBeVisible();
  await page.getByRole('link', { name: 'Admin area' }).click();
  await expect(page.getByText('Signed in as Super Admin')).toBeVisible();
});
