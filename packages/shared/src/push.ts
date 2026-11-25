/**
 * Phone and computer notifications (Web Push). Each member chooses which kinds they want; every device they
 * turn notifications on for gets the same choices. The server turns the choices into "topics" on each device,
 * which is how it finds who to notify (for example everyone following Todzi's matches).
 */
import { z } from 'zod';
import type { AdminRole } from './permissions';
import { TOWN_IDS } from './towns';

export const PUSH_CATEGORIES = [
  { id: 'messages', label: 'Messages', help: 'Private and group chats, and replies to your stories.' },
  { id: 'friends', label: 'Friends', help: 'Friend requests, and when a friend is home visiting.' },
  { id: 'social', label: 'Comments and mentions', help: 'Comments on your posts, and when someone @mentions you.' },
  { id: 'likes', label: 'Reactions and reposts', help: 'When someone reacts to or reposts your post.' },
  { id: 'announcements', label: 'Announcements', help: 'Official news for your town and for all of Akpafu.' },
  { id: 'events', label: 'New events', help: 'New events in your hometown.' },
  { id: 'reminders', label: 'Event reminders', help: 'About an hour before an event you said you are going to.' },
  { id: 'birthdays', label: 'Friends’ birthdays', help: 'In the morning on a friend’s birthday.' },
  { id: 'staff', label: 'Reports and approvals', help: 'For admins and moderators: new reports and listings to review.' },
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number]['id'];

export const SPORTS_FOLLOW = [
  { id: 'town', label: 'My town’s matches' },
  { id: 'all', label: 'All matches' },
  { id: 'off', label: 'Off' },
] as const;

export const pushPrefsSchema = z
  .object({
    messages: z.boolean(),
    friends: z.boolean(),
    social: z.boolean(),
    likes: z.boolean(),
    announcements: z.boolean(),
    events: z.boolean(),
    reminders: z.boolean(),
    birthdays: z.boolean(),
    staff: z.boolean(),
    sports: z.enum(['town', 'all', 'off']),
  })
  .strict();

export type PushPrefs = z.infer<typeof pushPrefsSchema>;

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  messages: true,
  friends: true,
  social: true,
  likes: true,
  announcements: true,
  events: true,
  reminders: true,
  birthdays: true,
  staff: true,
  sports: 'town',
};

/** Reads saved choices, filling in anything missing (e.g. a kind added later) with the default. */
export function normalizePushPrefs(saved: unknown): PushPrefs {
  const out = { ...DEFAULT_PUSH_PREFS };
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(out) as (keyof PushPrefs)[]) {
      const v = (saved as Record<string, unknown>)[k];
      if (k === 'sports') {
        if (v === 'town' || v === 'all' || v === 'off') out.sports = v;
      } else if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/** Topic for a team's town in a match (teams from outside the five towns use "other"). */
export const sportsTopic = (townId: string | null | undefined): string => `sports:${townId && (TOWN_IDS as readonly string[]).includes(townId) ? townId : 'other'}`;

/** Topics for everyone in one town, or in all towns. */
export const townTopics = (prefix: 'ann' | 'events', townId: string): string[] =>
  townId === 'all' ? TOWN_IDS.map((t) => `${prefix}:${t}`) : [`${prefix}:${townId}`];

/** Staff topics that should hear about something in a town. */
export const staffTopics = (townId: string): string[] => ['staff:all', `staff:${townId}`];

/** The topics a member's devices listen to. "account" (approvals, verification) is always on. */
export function pushTopics(prefs: PushPrefs, hometownId: string, role: AdminRole | null): string[] {
  const t = ['account'];
  for (const k of ['messages', 'friends', 'social', 'likes', 'reminders', 'birthdays'] as const) if (prefs[k]) t.push(k);
  if (prefs.announcements) t.push(`ann:${hometownId}`);
  if (prefs.events) t.push(`events:${hometownId}`);
  if (prefs.sports === 'town') t.push(sportsTopic(hometownId));
  if (prefs.sports === 'all') t.push(...TOWN_IDS.map((x) => `sports:${x}`), 'sports:other');
  if (prefs.staff && role && role.role !== 'reporter') {
    if (role.role === 'town_admin') t.push(...role.townIds.map((x) => `staff:${x}`));
    else t.push('staff:all');
  }
  return t;
}

/** What the app tells the server after it saved something that should notify people. */
export const PUSH_NOTIFY_KINDS = ['notification', 'message', 'match', 'event', 'report', 'approval', 'homevisit', 'story'] as const;
export const pushNotifySchema = z
  .object({
    kind: z.enum(PUSH_NOTIFY_KINDS),
    path: z
      .string()
      .max(300)
      .regex(/^[A-Za-z0-9_]+(\/[A-Za-z0-9_]+)+$/),
    event: z.enum(['kickoff', 'halftime', 'fulltime', 'goal']).optional(),
  })
  .strict();
export type PushNotifyInput = z.infer<typeof pushNotifySchema>;

export const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(40) }).strict(),
  })
  .strict();
