import { createApp } from './app';
import type { Env } from './env';
import { kvBucket } from './kv-bucket';
import { runBackup } from './backup';

const app = createApp();

// Photos live in R2 when it is enabled; otherwise in the free Workers KV namespace.
const storage = (env: Env): Env => (env.AVATARS || !env.PHOTOS_KV ? env : { ...env, AVATARS: kvBucket(env.PHOTOS_KV) });

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, storage(env), ctx);
  },
  /** Nightly database backup (see wrangler.toml [triggers]). */
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runBackup(storage(env)).then(
        (r) => console.log(`Backup ${r.key}: ${r.documents} documents, ${r.bytes} bytes${r.complete ? '' : ` — ${r.note}`}`),
        (e) => console.error('Backup failed', e),
      ),
    );
  },
};
