// Renders the PWA PNG icons from apps/web/public/favicon.svg using the preinstalled Chromium.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('apps/web/public/favicon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-512-maskable.png', 512, 0.12],
  ['apple-touch-icon.png', 180, 0],
]) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#14532d;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
     <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: `apps/web/public/${file}`, omitBackground: false });
}
await browser.close();
console.log('icons written');
