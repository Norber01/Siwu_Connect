import { createApp } from './app';
import type { Env } from './env';
import { kvBucket } from './kv-bucket';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Photos live in R2 when it is enabled; otherwise in the free Workers KV namespace.
    const withPhotos: Env = env.AVATARS || !env.PHOTOS_KV ? env : { ...env, AVATARS: kvBucket(env.PHOTOS_KV) };
    return app.fetch(request, withPhotos, ctx);
  },
};
