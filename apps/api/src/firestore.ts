/**
 * Minimal Firestore REST client for the Worker (the Firebase Admin SDK does not
 * run on Cloudflare Workers). Uses admin credentials, so security rules do not
 * apply here — every caller must check permissions first.
 */
import type { Env } from './env';
import { googleAccessToken } from './google-auth';

type Json = null | boolean | number | string | Date | Json[] | { [k: string]: Json | FieldValue };

export class FieldValue {
  private constructor(
    readonly kind: 'serverTimestamp' | 'increment',
    readonly amount = 0,
  ) {}
  static serverTimestamp() {
    return new FieldValue('serverTimestamp');
  }
  static increment(n: number) {
    return new FieldValue('increment', n);
  }
}

export type Data = Record<string, Json | FieldValue | undefined>;
export interface Doc<T = Record<string, unknown>> {
  id: string;
  path: string;
  data: T;
}

type FsValue = Record<string, unknown>;

function encode(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  throw new Error(`Cannot encode ${typeof v}`);
}

function encodeFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v instanceof FieldValue) continue;
    out[k] = encode(v);
  }
  return out;
}

function decode(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue as string);
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(decode);
  if ('mapValue' in v) return decodeFields((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  return null;
}

function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
  return out;
}

export interface Write {
  kind: 'set' | 'update' | 'create' | 'delete';
  path: string;
  data?: Data;
}

export type Filter =
  | [field: string, op: 'EQUAL' | 'LESS_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN_OR_EQUAL', value: unknown]
  | [field: string, op: 'IN' | 'ARRAY_CONTAINS', value: unknown];

export interface QueryOptions {
  parent?: string;
  collection: string;
  allDescendants?: boolean;
  where?: Filter[];
  orderBy?: [field: string, dir: 'ASCENDING' | 'DESCENDING'][];
  limit?: number;
}

export class Firestore {
  private readonly root: string;
  private readonly docsPrefix: string;

  constructor(private readonly env: Env) {
    const base = env.FIRESTORE_EMULATOR_HOST
      ? `http://${env.FIRESTORE_EMULATOR_HOST}`
      : 'https://firestore.googleapis.com';
    this.docsPrefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    this.root = `${base}/v1/${this.docsPrefix}`;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await googleAccessToken(this.env);
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new FirestoreError(res.status, body);
    }
    return (await res.json()) as T;
  }

  newId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  async get<T = Record<string, unknown>>(path: string): Promise<Doc<T> | null> {
    try {
      const raw = await this.request<{ name: string; fields?: Record<string, FsValue> }>(`${this.root}/${path}`);
      return { id: path.split('/').pop()!, path, data: decodeFields(raw.fields ?? {}) as T };
    } catch (e) {
      if (e instanceof FirestoreError && e.status === 404) return null;
      throw e;
    }
  }

  async query<T = Record<string, unknown>>(q: QueryOptions): Promise<Doc<T>[]> {
    const filters = (q.where ?? []).map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op, value: encode(value) },
    }));
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: q.collection, allDescendants: q.allDescendants ?? false }],
    };
    if (filters.length === 1) structuredQuery.where = filters[0];
    if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    if (q.orderBy) structuredQuery.orderBy = q.orderBy.map(([f, d]) => ({ field: { fieldPath: f }, direction: d }));
    if (q.limit) structuredQuery.limit = q.limit;
    const url = q.parent ? `${this.root}/${q.parent}:runQuery` : `${this.root}:runQuery`;
    const rows = await this.request<{ document?: { name: string; fields?: Record<string, FsValue> } }[]>(url, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery }),
    });
    return rows
      .filter((r) => r.document)
      .map((r) => {
        const path = r.document!.name.split('/documents/')[1]!;
        return { id: path.split('/').pop()!, path, data: decodeFields(r.document!.fields ?? {}) as T };
      });
  }

  /**
   * Every document in a collection group, exactly as Firestore stores it (typed fields), for backups.
   * Ordered by document name so it can continue after `afterName`.
   */
  async exportGroup(collectionId: string, pageSize: number, afterName?: string): Promise<{ name: string; fields: Record<string, FsValue> }[]> {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId, allDescendants: true }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: pageSize,
    };
    if (afterName) structuredQuery.startAt = { values: [{ referenceValue: afterName }], before: false };
    const rows = await this.request<{ document?: { name: string; fields?: Record<string, FsValue> } }[]>(`${this.root}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery }),
    });
    return rows.filter((r) => r.document).map((r) => ({ name: r.document!.name, fields: r.document!.fields ?? {} }));
  }

  /** Atomically applies all writes (max 500). */
  async commit(writes: Write[]): Promise<void> {
    const body = writes.map((w) => this.toRestWrite(w));
    await this.request(`${this.root}:commit`, { method: 'POST', body: JSON.stringify({ writes: body }) });
  }

  private toRestWrite(w: Write): Record<string, unknown> {
    const name = `${this.docsPrefix}/${w.path}`;
    if (w.kind === 'delete') return { delete: name };
    const data = w.data ?? {};
    const out: Record<string, unknown> = { update: { name, fields: encodeFields(data) } };
    const transforms = Object.entries(data)
      .filter(([, v]) => v instanceof FieldValue)
      .map(([k, v]) => {
        const fv = v as FieldValue;
        return fv.kind === 'serverTimestamp'
          ? { fieldPath: k, setToServerValue: 'REQUEST_TIME' }
          : { fieldPath: k, increment: { integerValue: String(fv.amount) } };
      });
    if (transforms.length) out.updateTransforms = transforms;
    if (w.kind === 'update') {
      out.updateMask = {
        fieldPaths: Object.entries(data)
          .filter(([, v]) => !(v instanceof FieldValue) && v !== undefined)
          .map(([k]) => k),
      };
      out.currentDocument = { exists: true };
    }
    if (w.kind === 'create') out.currentDocument = { exists: false };
    return out;
  }
}

export class FirestoreError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Firestore request failed (${status}): ${body.slice(0, 300)}`);
  }
}
