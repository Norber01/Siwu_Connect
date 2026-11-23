import { ApiError } from './errors';
import { API_URL, auth } from './firebase';

export { ApiError };

/** Calls the Siwu Connect API (Cloudflare Worker) with the user's Firebase ID token. */
export async function api<T = { ok: true }>(
  path: string,
  init: { method?: string; json?: unknown; body?: Blob; contentType?: string } = {},
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'Please sign in again.');
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': init.contentType ?? 'application/json',
      },
      body: init.body ?? (init.json === undefined ? undefined : JSON.stringify(init.json)),
    });
  } catch {
    throw new ApiError(0, 'Could not reach Siwu Connect. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong. Please try again.');
  return data as T;
}
