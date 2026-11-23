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
}

export interface Post {
  id: string;
  authorId: string;
  townId: string;
  text: string;
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
  };
}

export function toPost(s: DocumentSnapshot): Post {
  const d = s.data()!;
  return {
    id: s.id,
    authorId: d.authorId,
    townId: d.townId,
    text: d.text,
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
