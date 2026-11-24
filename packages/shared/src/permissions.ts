import type { Role } from './constants';

/**
 * Role hierarchy (founder-confirmed 2026-11-23):
 *  - Super Admin: everything a Town Admin or Moderator can do, in every town,
 *    plus roles, platform settings, town configuration and the audit log.
 *  - Town Admin: moderation, announcements, pins and suspensions in assigned towns.
 *  - Moderator: review reports and remove/restore content in assigned towns.
 *  - Sports reporter: create matches and post live score updates (no moderation powers).
 *
 * The same rules are mirrored in firestore.rules and enforced in the Worker.
 * The web app uses these helpers only to decide what to show.
 */
export interface AdminRole {
  role: Role;
  townIds: string[];
}

export const isSuperAdmin = (r: AdminRole | null | undefined): boolean => r?.role === 'super_admin';

function inScope(r: AdminRole, townId: string): boolean {
  if (r.role === 'super_admin') return true;
  if (r.role === 'reporter') return false;
  return r.townIds.includes(townId);
}

/** Review reports, remove/restore posts and comments. */
export function canModerate(r: AdminRole | null | undefined, townId: string): boolean {
  if (!r) return false;
  return inScope(r, townId);
}

/** Publish/edit announcements and pin posts. `townId` may be 'all' (platform-wide). */
export function canAnnounce(r: AdminRole | null | undefined, townId: string): boolean {
  if (!r) return false;
  if (r.role === 'super_admin') return true;
  if (r.role === 'town_admin') return townId !== 'all' && r.townIds.includes(townId);
  return false;
}

/** Suspend or restore a user whose hometown is `townId`. */
export function canSuspend(r: AdminRole | null | undefined, townId: string): boolean {
  if (!r) return false;
  if (r.role === 'super_admin') return true;
  return r.role === 'town_admin' && r.townIds.includes(townId);
}

export const canManageRoles = isSuperAdmin;
export const canViewAuditLog = isSuperAdmin;

/** Any moderation role — used to show the Admin area link (reporters only manage sports). */
export const hasAdminAccess = (r: AdminRole | null | undefined): boolean => !!r && r.role !== 'reporter';

/** Create matches and post live updates in the Sports Centre: every role, including reporters. */
export const canReportSports = (r: AdminRole | null | undefined): boolean => !!r;

/** Reporters limited to some towns manage only matches involving those towns (no towns = all towns). */
export function canReportMatch(r: AdminRole | null | undefined, m: { home: { townId: string | null }; away: { townId: string | null } }): boolean {
  if (!r) return false;
  if (r.role !== 'reporter' || r.townIds.length === 0) return true;
  return (!!m.home.townId && r.townIds.includes(m.home.townId)) || (!!m.away.townId && r.townIds.includes(m.away.townId));
}
