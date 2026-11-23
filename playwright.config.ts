import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the full local stack:
 * Firebase emulators + API Worker (wrangler dev) + web app (vite).
 * Run with `npm run test:e2e` (servers are started automatically if not running).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      // Stops any leftover emulator from an interrupted run first, then waits for the auth emulator
      // (it starts last), so a stray database emulator can never be mistaken for a ready stack.
      command: 'bash scripts/test-emulators.sh',
      url: 'http://127.0.0.1:9099',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'cp -n apps/api/.dev.vars.example apps/api/.dev.vars; cd apps/api && npx wrangler dev --local --port 8787',
      url: 'http://localhost:8787/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    { command: 'npm run dev -w @siwu/web', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
