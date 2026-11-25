import { createApp } from './app';
import type { Env } from './env';
import { kvBucket } from './kv-bucket';
import { runBackup } from './backup';
import { runHourly } from './push';

const app = createApp();
const HOURLY = '7 * * * *'; // must match wrangler.toml

// Photos live in R2 when it is enabled; otherwise in the free Workers KV namespace.
const storage = (env: Env): Env => (env.AVATARS || !env.PHOTOS_KV ? env : { ...env, AVATARS: kvBucket(env.PHOTOS_KV) });

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, storage(env), ctx);
  },
  /** Hourly: event reminders, birthdays (07:00), tidy-up. Nightly: database backup (see wrangler.toml [triggers]). */
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === HOURLY) {
      ctx.waitUntil(runHourly(storage(env)).then((r) => console.log(`Hourly: ${r}`), (e) => console.error('Hourly failed', e)));
      return;
    }
    ctx.waitUntil(
      runBackup(storage(env)).then(
        (r) => console.log(`Backup ${r.key}: ${r.documents} documents, ${r.bytes} bytes${r.complete ? '' : ` — ${r.note}`}`),
        (e) => console.error('Backup failed', e),
      ),
    );
  },
};
