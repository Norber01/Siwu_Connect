/**
 * Events, Marketplace, Sports Centre, notifications and tester feedback,
 * exercised in a real browser. Uses the fictional sample accounts from
 * scripts/demo-data.mjs (emulator only).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** Records a 1-second WebM test clip in the browser (Chromium has no MP4 encoder). */
async function recordTestVideo(page: Page): Promise<Buffer> {
  await page.goto('/rules');
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < 15; i++) {
      ctx.fillStyle = `hsl(${i * 24}, 70%, 45%)`;
      ctx.fillRect(0, 0, 160, 120);
      await new Promise((r) => setTimeout(r, 66));
    }
    rec.stop();
    await stopped;
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    buf.forEach((x) => (s += String.fromCharCode(x)));
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

async function signOut(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/welcome/);
}

test('events, marketplace, sports, notifications and feedback', async ({ page }) => {
  for (const url of ['http://127.0.0.1:8080', 'http://127.0.0.1:9099']) {
    await expect.poll(() => fetch(url).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
  }
  execFileSync('node', ['scripts/demo-data.mjs'], { stdio: 'ignore' });
  const tag = Date.now().toString(36);

  // --- Members cannot add events: they ask an admin instead.
  await signIn(page, 'kofi_mensah');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('button', { name: /^Event/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/events');
  await page.getByRole('button', { name: 'Request event' }).click();
  await expect(page.getByRole('dialog', { name: 'Ask an admin to add your event' })).toBeVisible();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText('Thank you!')).toBeVisible();
  await signOut(page);

  // --- An admin adds the event through the "+" menu.
  await signIn(page, 'demo_admin');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: /^Event/ }).click();
  await page.getByLabel('Event name').fill(`Todzi town meeting ${tag}`);
  await page.getByLabel('Type').selectOption('meeting');
  await page.getByLabel('Town').selectOption('todzi');
  const start = new Date(Date.now() + 2 * 86400_000);
  start.setHours(17, 0, 0, 0);
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Starts').fill(local);
  await page.getByLabel('Place (optional)').fill('Chief’s palace');
  await page.getByRole('button', { name: 'Publish event' }).click();
  await expect(page.getByText('Your event is published.')).toBeVisible();
  const eventUrl = page.url();
  await signOut(page);

  // --- Ama RSVPs, lists an item with a photo, votes on a match and likes Kofi's post.
  await signIn(page, 'ama_serwaa');
  await page.goto(eventUrl);
  await page.getByRole('button', { name: /Going · 0/ }).click();
  await expect(page.getByRole('button', { name: /Going · 1/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Interested · 0/ }).click(); // switch
  await expect(page.getByRole('button', { name: /Going · 0/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Interested · 1/ })).toBeVisible();

  await page.goto('/market');
  await page.getByRole('link', { name: 'Sell' }).click();
  await page.getByLabel('Choose photo').setInputFiles('apps/web/public/icon-512.png');
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();
  await page.getByLabel('What are you selling?').fill(`Kente cloth ${tag}`);
  await page.getByLabel('Category').selectOption('clothing');
  await page.getByLabel('Price in GH₵').fill('850');
  await page.getByLabel('Phone number for buyers (optional)').fill('0241234567');
  await expect(page.getByText('Enter a phone number')).toHaveCount(0);
  await page.getByRole('button', { name: 'List item' }).click();
  await expect(page.getByText('Sent for approval')).toBeVisible();
  await expect(page.getByText('Waiting for a moderator to approve this listing')).toBeVisible();
  const listingUrl = page.url();

  await page.goto('/sports');
  await page.getByText('Odomi').first().click();
  await page.getByRole('button', { name: 'Mempeasem' }).click();
  await expect(page.getByText('Your vote is in!')).toBeVisible();
  await expect(page.getByText(/votes · just for fun/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw' })).toHaveCount(0); // cannot vote twice

  // A post with a photo and a video, and the new event shows on the home feed's "Coming up" strip.
  const webm = await recordTestVideo(page);
  await page.goto('/new?town=mempeasem');
  await page.getByLabel('Your post').fill(`Sunset over Mempeasem ${tag}`);
  await page.getByLabel('Choose photos or videos').setInputFiles([
    { name: 'photo.png', mimeType: 'image/png', buffer: readFileSync('apps/web/public/icon-512.png') },
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
  ]);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Your post is live.')).toBeVisible();
  await expect(page.locator('article img[src*="/images/"]')).toBeVisible();
  await expect(page.locator('article video[src*="/videos/"]')).toHaveCount(1);
  // Tapping the photo opens the full-screen viewer.
  await page.locator('article img[src*="/images/"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Photo viewer' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.goto('/?town=todzi');
  await expect(page.getByRole('region', { name: 'Upcoming events' }).getByText(`Todzi town meeting ${tag}`)).toBeVisible();

  await page.goto('/?town=todzi');
  await page.getByRole('button', { name: 'Like', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Unlike' }).first()).toBeVisible();
  await page.waitForTimeout(1500); // let the like reach the server before the full page reload below

  // Chat: Ama asks Kofi to be friends (private chat needs an accepted request), and says hi in the Todzi room.
  await page.goto('/u/kofi_mensah');
  await expect(page.getByRole('button', { name: 'Message' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add friend' }).click();
  await expect(page.getByRole('button', { name: 'Requested · Cancel' })).toBeVisible();
  await page.goto('/chat');
  await page.getByRole('link', { name: /Todzi/ }).first().click();
  await page.getByLabel('Message', { exact: true }).fill(`Hello Todzi room ${tag}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(`Hello Todzi room ${tag}`)).toBeVisible();

  // Tester feedback from the Beta badge.
  await page.getByRole('button', { name: 'Beta' }).click();
  await page.getByLabel('Your feedback').fill(`The sports centre is brilliant ${tag}`);
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText('Thank you! Your feedback')).toBeVisible();
  await signOut(page);

  // --- A moderator approves Ama's listing.
  await signIn(page, 'demo_admin');
  await page.goto('/admin/approvals');
  await expect(page.getByText(`Kente cloth ${tag}`)).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByText('Approved — it is live now.')).toBeVisible();
  await signOut(page);

  // --- Efua (buyer) sees Ama's listing with a WhatsApp link in Ghana format.
  await signIn(page, 'efua_adokor');
  await page.goto('/market?town=mempeasem');
  await page.getByText(`Kente cloth ${tag}`).click();
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/233241234567\?text=/);
  await expect(page.getByRole('link', { name: 'Call seller' })).toHaveAttribute('href', 'tel:0241234567');
  await signOut(page);

  // --- Kofi gets notifications for Ama's like and friend request, accepts it and messages her.
  await signIn(page, 'kofi_mensah');
  await expect(page.getByRole('link', { name: /Notifications, 2 unread/ })).toBeVisible();
  await page.getByRole('link', { name: /Notifications/ }).click();
  await expect(page.getByText('reacted to your post')).toBeVisible();
  await expect(page.getByText('sent you a friend request')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible(); // count cleared
  await page.getByRole('link', { name: /^Chat/ }).click();
  await expect(page.getByRole('region', { name: 'Friend requests' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept request' }).click();
  await expect(page.getByText('are now friends')).toBeVisible();
  await page.goto('/u/ama_serwaa');
  await page.getByRole('button', { name: 'Message' }).click();
  await page.getByLabel('Message', { exact: true }).fill(`Akwaaba Ama ${tag}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(`Akwaaba Ama ${tag}`)).toBeVisible();
  await signOut(page);

  // --- Ama sees the approval and the unread chat.
  await signIn(page, 'ama_serwaa');
  await page.getByRole('link', { name: /^Chat, 1 unread/ }).click();
  await expect(page.getByText(`Akwaaba Ama ${tag}`)).toBeVisible();
  await page.goto('/notifications');
  await expect(page.getByText('Approved and now live')).toBeVisible();
  await page.goto(listingUrl);
  await expect(page.getByText('GH₵ 850')).toBeVisible();
  await signOut(page);

  // --- Super Admin posts a live goal and reads the feedback.
  await signIn(page, 'demo_admin');
  await page.goto('/sports');
  await page.getByText('Odomi').first().click();
  await page.getByLabel('What happened?').selectOption('goal');
  await page.getByLabel('Team').selectOption('away');
  await page.getByLabel('Comment (optional)').fill('Mempeasem equalise!');
  await page.getByRole('button', { name: 'Post goal for Mempeasem' }).click();
  await expect(page.getByText('Mempeasem equalise!')).toBeVisible();
  await expect(page.getByText('1 - 1').first()).toBeVisible();
  // Adding a match asks for length and break; a match that kicked off 2 minutes ago is live and counting.
  await page.goto('/sports/new');
  await page.getByLabel('Competition').fill(`Clock test ${tag}`);
  const ko = new Date(Date.now() - 2 * 60_000);
  await page.getByLabel('Kick-off (date and time)').fill(new Date(ko.getTime() - ko.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  await page.getByLabel('Match length (minutes)').fill('20');
  await page.getByLabel('Half-time break (minutes)').fill('5');
  await page.getByRole('button', { name: 'Add match' }).click();
  await expect(page.getByText('Match added to the Sports Centre.')).toBeVisible();
  await expect(page.getByText(/⏱ [23]:\d\d/)).toBeVisible();
  await expect(page.getByText('20 min, 5-min break')).toBeVisible();

  await page.goto('/admin/feedback');
  await expect(page.getByText(`The sports centre is brilliant ${tag}`)).toBeVisible();
});
