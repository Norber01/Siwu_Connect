/**
 * The four initial town spaces. IDs are stable and must never change once data
 * exists; display names are also stored in Firestore `towns/{id}` so they can be
 * edited later without a code change. Names confirmed by the founder 2026-11-23.
 */
export const TOWNS = [
  { id: 'odomi', name: 'Akpafu Odomi', shortName: 'Odomi', order: 1 },
  { id: 'mempeasem', name: 'Akpafu Mempeasem', shortName: 'Mempeasem', order: 2 },
  { id: 'todzi', name: 'Akpafu Todzi', shortName: 'Todzi', order: 3 },
  { id: 'adokor', name: 'Akpafu Adokor', shortName: 'Adokor', order: 4 },
] as const;

export type TownId = (typeof TOWNS)[number]['id'];

export const TOWN_IDS = TOWNS.map((t) => t.id) as unknown as readonly [TownId, ...TownId[]];

export function isTownId(value: unknown): value is TownId {
  return typeof value === 'string' && (TOWN_IDS as readonly string[]).includes(value);
}

export function townName(id: string): string {
  return TOWNS.find((t) => t.id === id)?.name ?? 'Unknown town';
}

export function townShortName(id: string): string {
  return TOWNS.find((t) => t.id === id)?.shortName ?? 'Unknown';
}
