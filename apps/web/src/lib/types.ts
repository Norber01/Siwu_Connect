import type { DocumentSnapshot, Timestamp } from 'firebase/firestore';
import type { AdminRole, PostVisibility, Residence } from '@siwu/shared';

export interface Profile {
  uid: string;
  displayName: string;
  username: string;
  photoUrl: string | null;
  hometownId: string;
  residence: Residence | null;
  countryCode: string | null;
  status: 'active' | 'suspended';
  createdAt: Date | null;
  bio: string;
  vibe: string;
  /** Verified by a Siwu Connect admin (blue tick). */
  verified: boolean;
}

export interface Post {
  id: string;
  authorId: string;
  townId: string;
  text: string;
  /** Photos and videos (older posts' single imageUrl is folded in here). */
  media: Array<{ type: 'image' | 'video'; url: string; posterUrl: string | null; width?: number; height?: number }>;
  poll: { options: string[]; counts: number[] } | null;
  tags: string[];
  reactions: Record<string, number>;
  visibility: PostVisibility;
  status: 'published' | 'removed' | 'deleted';
  pinned: boolean;
  reactionCount: number;
  commentCount: number;
  createdAt: Date | null;
  editedAt: Date | null;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  townId: string;
  text: string;
  status: 'published' | 'removed' | 'deleted';
  createdAt: Date | null;
}

export interface Announcement {
  id: string;
  townId: string;
  title: string;
  body: string;
  pinned: boolean;
  status: 'published' | 'archived';
  authorId: string;
  createdAt: Date | null;
  expiresAt: Date | null;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  targetPath: string;
  townId: string;
  reason: string;
  details: string;
  status: 'open' | 'actioned' | 'dismissed';
  createdAt: Date | null;
}

export interface RoleAssignment extends AdminRole {
  uid: string;
  username?: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetPath: string;
  townId: string;
  details: Record<string, unknown>;
  at: Date | null;
}

const date = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null);

export function toProfile(s: DocumentSnapshot): Profile {
  const d = s.data()!;
  return {
    uid: s.id,
    displayName: d.displayName,
    username: d.username,
    photoUrl: d.photoUrl ?? null,
    hometownId: d.hometownId,
    residence: d.residence ?? null,
    countryCode: d.countryCode ?? null,
    status: d.status,
    createdAt: date(d.createdAt),
    bio: d.bio ?? '',
    vibe: d.vibe ?? '',
    verified: d.verified === true,
  };
}

export function toPost(s: DocumentSnapshot): Post {
  const d = s.data()!;
  return {
    id: s.id,
    authorId: d.authorId,
    townId: d.townId,
    text: d.text,
    media: [
      ...(d.imageUrl ? [{ type: 'image' as const, url: d.imageUrl as string, posterUrl: null }] : []),
      ...((d.media ?? []) as Post['media']),
    ],
    poll: d.poll ?? null,
    tags: d.tags ?? [],
    reactions: d.reactions ?? {},
    visibility: d.visibility,
    status: d.status,
    pinned: !!d.pinned,
    reactionCount: d.reactionCount ?? 0,
    commentCount: d.commentCount ?? 0,
    createdAt: date(d.createdAt),
    editedAt: date(d.editedAt),
  };
}

export function toComment(s: DocumentSnapshot): Comment {
  const d = s.data()!;
  return {
    id: s.id,
    postId: s.ref.parent.parent!.id,
    authorId: d.authorId,
    townId: d.townId,
    text: d.text,
    status: d.status,
    createdAt: date(d.createdAt),
  };
}

export function toAnnouncement(s: DocumentSnapshot): Announcement {
  const d = s.data()!;
  return {
    id: s.id,
    townId: d.townId,
    title: d.title,
    body: d.body,
    pinned: !!d.pinned,
    status: d.status,
    authorId: d.authorId,
    createdAt: date(d.createdAt),
    expiresAt: date(d.expiresAt),
  };
}

export function toReport(s: DocumentSnapshot): Report {
  const d = s.data()!;
  return { id: s.id, ...(d as Omit<Report, 'id' | 'createdAt'>), createdAt: date(d.createdAt) };
}

export function toAudit(s: DocumentSnapshot): AuditEntry {
  const d = s.data()!;
  return {
    id: s.id,
    actorId: d.actorId,
    action: d.action,
    targetPath: d.targetPath,
    townId: d.townId,
    details: d.details ?? {},
    at: date(d.at),
  };
}

// ---------------- events, marketplace, sports, notifications ----------------

export interface CommunityEvent {
  id: string;
  authorId: string;
  townId: string;
  title: string;
  description: string;
  category: string;
  location: string;
  startsAt: Date;
  endsAt: Date | null;
  imageUrl: string | null;
  status: 'published' | 'cancelled' | 'removed' | 'deleted';
  goingCount: number;
  interestedCount: number;
  createdAt: Date | null;
}

export interface Listing {
  id: string;
  sellerId: string;
  townId: string;
  title: string;
  description: string;
  category: string;
  price: number | null;
  priceUnit: string;
  imageUrl: string | null;
  contactPhone: string | null;
  contactWhatsApp: boolean;
  status: 'available' | 'sold' | 'removed' | 'deleted' | 'pending' | 'rejected';
  createdAt: Date | null;
}

export interface Team {
  name: string;
  townId: string | null;
}

export interface Match {
  id: string;
  competition: string;
  home: Team;
  away: Team;
  venue: string;
  kickoffAt: Date;
  durationMinutes: number;
  breakMinutes: number;
  actualKickoffAt: Date | null;
  secondHalfStartAt: Date | null;
  status: 'scheduled' | 'live' | 'halftime' | 'finished' | 'postponed' | 'cancelled';
  homeScore: number;
  awayScore: number;
  minute: number | null;
  votesHome: number;
  votesDraw: number;
  votesAway: number;
}

export interface MatchUpdate {
  id: string;
  type: string;
  team: 'home' | 'away' | null;
  minute: number | null;
  text: string;
  createdAt: Date | null;
}

export interface AppNotification {
  id: string;
  type: 'like' | 'comment' | 'mention' | 'friend_request' | 'friend_accepted' | 'approved' | 'rejected' | 'verified';
  actorId: string;
  postId: string | null;
  commentId: string | null;
  /** For approvals: the listing or directory entry, e.g. "listings/abc". */
  targetPath?: string | null;
  title?: string | null;
  note?: string | null;
  read: boolean;
  createdAt: Date | null;
}

export interface Feedback {
  id: string;
  userId: string;
  text: string;
  page: string;
  createdAt: Date | null;
}

export function toEvent(s: DocumentSnapshot): CommunityEvent {
  const d = s.data()!;
  return {
    id: s.id,
    authorId: d.authorId,
    townId: d.townId,
    title: d.title,
    description: d.description ?? '',
    category: d.category,
    location: d.location ?? '',
    startsAt: date(d.startsAt) ?? new Date(0),
    endsAt: date(d.endsAt),
    imageUrl: d.imageUrl ?? null,
    status: d.status,
    goingCount: d.goingCount ?? 0,
    interestedCount: d.interestedCount ?? 0,
    createdAt: date(d.createdAt),
  };
}

export function toListing(s: DocumentSnapshot): Listing {
  const d = s.data()!;
  return {
    id: s.id,
    sellerId: d.sellerId,
    townId: d.townId,
    title: d.title,
    description: d.description ?? '',
    category: d.category,
    price: d.price ?? null,
    priceUnit: d.priceUnit ?? '',
    imageUrl: d.imageUrl ?? null,
    contactPhone: d.contactPhone ?? null,
    contactWhatsApp: !!d.contactWhatsApp,
    status: d.status,
    createdAt: date(d.createdAt),
  };
}

export function toMatch(s: DocumentSnapshot): Match {
  const d = s.data()!;
  return {
    id: s.id,
    competition: d.competition,
    home: d.home,
    away: d.away,
    venue: d.venue ?? '',
    kickoffAt: date(d.kickoffAt) ?? new Date(0),
    durationMinutes: d.durationMinutes ?? 90,
    breakMinutes: d.breakMinutes ?? 15,
    actualKickoffAt: date(d.actualKickoffAt),
    secondHalfStartAt: date(d.secondHalfStartAt),
    status: d.status,
    homeScore: d.homeScore ?? 0,
    awayScore: d.awayScore ?? 0,
    minute: d.minute ?? null,
    votesHome: d.votesHome ?? 0,
    votesDraw: d.votesDraw ?? 0,
    votesAway: d.votesAway ?? 0,
  };
}

export function toMatchUpdate(s: DocumentSnapshot): MatchUpdate {
  const d = s.data()!;
  return { id: s.id, type: d.type, team: d.team ?? null, minute: d.minute ?? null, text: d.text ?? '', createdAt: date(d.createdAt) };
}

export function toNotification(s: DocumentSnapshot): AppNotification {
  const d = s.data()!;
  return {
    id: s.id,
    type: d.type,
    actorId: d.actorId,
    postId: d.postId ?? null,
    commentId: d.commentId ?? null,
    targetPath: d.targetPath ?? null,
    title: d.title ?? null,
    note: d.note ?? null,
    read: !!d.read,
    createdAt: date(d.createdAt),
  };
}

export function toFeedback(s: DocumentSnapshot): Feedback {
  const d = s.data()!;
  return { id: s.id, userId: d.userId, text: d.text, page: d.page ?? '', createdAt: date(d.createdAt) };
}
