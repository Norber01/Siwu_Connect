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
import { Avatar, Button, Modal } from './ui';
import { townShortName } from '@siwu/shared';

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
          <Avatar url={author.photoUrl} name={name} size={44} />
        </Link>
      ) : (
        <Avatar url={null} name={name} size={44} />
      )}
      <div className="min-w-0">
        {author ? (
          <Link to={`/u/${author.username}`} className="block truncate font-bold text-gray-900 hover:underline">
            {name}
          </Link>
        ) : (
          <span className="block font-bold text-gray-500">{name}</span>
        )}
        <div className="text-[13px] text-gray-600">
          <time dateTime={date?.toISOString()} title={fullDate(date)}>
            {timeAgo(date)}
          </time>
          {townId && (
            <>
              {' · '}
              <Link to={`/towns/${townId}`} className="font-semibold text-brand-700 hover:underline">
                {townShortName(townId)}
              </Link>
            </>
          )}
          {edited && <span> · edited</span>}
        </div>
      </div>
    </div>
  );
}

/** Opens the phone's share sheet (WhatsApp etc.), or copies the link on desktop. */
async function sharePost(post: Post, toast: (m: string, k?: 'success' | 'error') => void) {
  const url = `${window.location.origin}/p/${post.id}`;
  const text = post.text.length > 120 ? `${post.text.slice(0, 120)}…` : post.text;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Siwu Connect', text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied. Paste it anywhere to share.');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // user closed the share sheet
    toast('Could not share this post on this device.', 'error');
  }
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
      await setLike(db, user.uid, post, next);
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
    <article className="rounded-2xl border border-sand-200 bg-white shadow-sm" aria-label="Post">
      <div className="p-4 pb-2">
        {post.pinned && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-xs font-bold text-gold-800">
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
          {post.imageUrl &&
            (linkToDetail ? (
              <Link to={`/p/${post.id}`} className="mt-3 block">
                <img src={post.imageUrl} alt="" loading="lazy" decoding="async" className="max-h-[28rem] w-full rounded-xl bg-sand-100 object-cover" />
              </Link>
            ) : (
              <a href={post.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block">
                <img src={post.imageUrl} alt="" decoding="async" className="w-full rounded-xl bg-sand-100 object-contain" />
              </a>
            ))}
          {post.visibility === 'town' && <p className="mt-2 text-xs text-gray-600">Shared in this town's feed only</p>}
        </div>
        {(likes > 0 || post.commentCount > 0) && (
          <div className="mt-3 flex items-center justify-between text-[13px] text-gray-600">
            <span className="inline-flex items-center gap-1">
              {likes > 0 && (
                <>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Icon name="thumb" filled className="h-3 w-3" />
                  </span>
                  {likes}
                </>
              )}
            </span>
            {post.commentCount > 0 && (
              <Link to={`/p/${post.id}#comments`} className="hover:underline">
                {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
              </Link>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 border-t border-sand-200 px-2 py-1">
        <button
          onClick={toggleLike}
          disabled={!active}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-sm font-semibold hover:bg-sand-100 disabled:opacity-50 ${
            liked ? 'text-brand-600' : 'text-gray-700'
          }`}
        >
          <Icon name="thumb" filled={liked} />
          {liked ? 'Liked' : 'Like'}
        </button>
        <Link
          to={`/p/${post.id}#comments`}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-sand-100"
        >
          <Icon name="comment" />
          Comment
        </Link>
        <button
          onClick={() => sharePost(post, toast)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-sand-100"
        >
          <Icon name="share" />
          Share
        </button>
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
