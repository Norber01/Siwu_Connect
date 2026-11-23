import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canAnnounce, canModerate } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { useInvalidatePosts, useProfileById } from '../lib/hooks';
import { deletePost, setLike } from '../lib/ops';
import type { Post } from '../lib/types';
import { friendlyError, fullDate, linkify, timeAgo } from '../lib/util';
import { Icon } from './Icon';
import { Menu, type MenuItem } from './Menu';
import { ReportDialog } from './ReportDialog';
import { useToast } from './Toast';
import { Avatar, Button, Modal, TownBadge } from './ui';

export function RichText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-900">
      {linkify(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-brand-700 underline">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function AuthorLine({ uid, townId, date, edited }: { uid: string; townId?: string; date: Date | null; edited?: boolean }) {
  const { data: author } = useProfileById(uid);
  const name = author?.displayName ?? (author === null ? 'Deleted account' : '…');
  return (
    <div className="flex min-w-0 items-center gap-3">
      {author ? (
        <Link to={`/u/${author.username}`} className="shrink-0">
          <Avatar url={author.photoUrl} name={name} />
        </Link>
      ) : (
        <Avatar url={null} name={name} />
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {author ? (
            <Link to={`/u/${author.username}`} className="truncate font-semibold text-gray-900 hover:underline">
              {name}
            </Link>
          ) : (
            <span className="font-semibold text-gray-500">{name}</span>
          )}
          {townId && <TownBadge townId={townId} />}
        </div>
        <div className="text-xs text-gray-600">
          {author && <span>@{author.username} · </span>}
          <time dateTime={date?.toISOString()} title={fullDate(date)}>
            {timeAgo(date)}
          </time>
          {edited && <span> · edited</span>}
        </div>
      </div>
    </div>
  );
}

export function PostCard({ post, liked: initiallyLiked, linkToDetail = true }: { post: Post; liked: boolean; linkToDetail?: boolean }) {
  const { user, profile, role } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidatePosts();
  const [liked, setLiked] = useState(initiallyLiked);
  const [likes, setLikes] = useState(post.reactionCount);
  const [liking, setLiking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'remove'>(null);
  const [busy, setBusy] = useState(false);
  const isAuthor = post.authorId === user.uid;
  const active = profile.status === 'active';

  const toggleLike = async () => {
    if (liking) return;
    const next = !liked;
    setLiking(true);
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      await setLike(db, user.uid, post.id, next);
    } catch (e) {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
      toast(friendlyError(e), 'error');
    } finally {
      setLiking(false);
    }
  };

  const runConfirmed = async () => {
    setBusy(true);
    try {
      if (confirm === 'delete') {
        await deletePost(db, post.id);
        toast('Post deleted.');
      } else {
        await api(`/admin/posts/${post.id}/remove`, { json: { note: '' } });
        toast('Post removed from Siwu Connect.');
      }
      setConfirm(null);
      invalidate();
      if (!linkToDetail) navigate('/');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async () => {
    try {
      await api(`/admin/posts/${post.id}/pin`, { json: { pinned: !post.pinned } });
      toast(post.pinned ? 'Post unpinned.' : 'Post pinned to the top of the town feed.');
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const items: MenuItem[] = [];
  if (isAuthor && active) items.push({ label: 'Edit post', icon: 'edit', onSelect: () => navigate(`/p/${post.id}/edit`) });
  if (isAuthor) items.push({ label: 'Delete post', icon: 'trash', danger: true, onSelect: () => setConfirm('delete') });
  if (!isAuthor && active) items.push({ label: 'Report post', icon: 'flag', onSelect: () => setReporting(true) });
  if (canAnnounce(role, post.townId))
    items.push({ label: post.pinned ? 'Unpin post' : 'Pin post', icon: 'pin', onSelect: togglePin });
  if (!isAuthor && canModerate(role, post.townId))
    items.push({ label: 'Remove post (moderator)', icon: 'shield', danger: true, onSelect: () => setConfirm('remove') });

  return (
    <article className="rounded-2xl border border-sand-200 bg-white p-4" aria-label="Post">
      {post.pinned && (
        <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-gold-800">
          <Icon name="pin" className="h-3.5 w-3.5" /> Pinned
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <AuthorLine uid={post.authorId} townId={post.townId} date={post.createdAt} edited={!!post.editedAt} />
        <Menu items={items} label="Post actions" />
      </div>
      <div className="mt-3">
        {linkToDetail ? (
          <Link to={`/p/${post.id}`} className="block">
            <RichText text={post.text.length > 600 ? `${post.text.slice(0, 600)}…` : post.text} />
          </Link>
        ) : (
          <RichText text={post.text} />
        )}
        {post.visibility === 'town' && (
          <p className="mt-2 text-xs text-gray-600">Shared in this town's feed only</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-1 border-t border-sand-100 pt-2">
        <button
          onClick={toggleLike}
          disabled={!active}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-sand-100 disabled:opacity-50 ${
            liked ? 'text-red-600' : 'text-gray-700'
          }`}
        >
          <Icon name="heart" filled={liked} />
          <span>{likes > 0 ? likes : ''}</span>
          <span className="sr-only">likes</span>
        </button>
        <Link
          to={`/p/${post.id}#comments`}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-sand-100"
        >
          <Icon name="comment" />
          <span>{post.commentCount > 0 ? post.commentCount : ''}</span>
          <span className="sr-only">comments</span>
        </Link>
      </div>

      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        target={{ targetType: 'post', targetId: post.id, targetPath: `posts/${post.id}`, townId: post.townId }}
      />
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'delete' ? 'Delete this post?' : 'Remove this post?'}
      >
        <p className="text-sm text-gray-700">
          {confirm === 'delete'
            ? 'Your post and its text will be permanently removed. This cannot be undone.'
            : 'The post will be hidden from everyone. This action is recorded in the audit log and can be reversed from the admin area.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} onClick={runConfirmed}>
            {confirm === 'delete' ? 'Delete' : 'Remove'}
          </Button>
        </div>
      </Modal>
    </article>
  );
}
