import { useState } from 'react';
import { VerifiedBadge } from './VerifiedBadge';
import { Link, useNavigate } from 'react-router-dom';
import { canAnnounce, canModerate } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { useInvalidatePosts, useProfileById } from '../lib/hooks';
import { REACTIONS, type Reaction, deletePost, setReaction, votePoll } from '../lib/ops';
import { fetchMyPollVote } from '../lib/queries';
import { useQuery } from '@tanstack/react-query';
import type { Post } from '../lib/types';
import { friendlyError, fullDate, linkify, timeAgo } from '../lib/util';
import { Icon } from './Icon';
import { Menu, type MenuItem } from './Menu';
import { ReportDialog } from './ReportDialog';
import { useToast } from './Toast';
import { Avatar, Button, Modal } from './ui';
import { MediaGallery } from './media';
import { townShortName } from '@siwu/shared';

/** Plain text with safe links, #hashtags (→ tag page) and @mentions (→ profile). Never renders HTML. */
export function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  linkify(text).forEach((part, i) => {
    if (part.href) {
      parts.push(
        <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-brand-700 underline">
          {part.text}
        </a>,
      );
      return;
    }
    const re = /(^|\s)([#@])([\p{L}\p{N}_]{2,30})/gu;
    let last = 0;
    for (const m of part.text.matchAll(re)) {
      const start = m.index! + m[1]!.length;
      if (start > last) parts.push(<span key={`${i}-${last}`}>{part.text.slice(last, start)}</span>);
      const word = m[3]!;
      parts.push(
        m[2] === '#' ? (
          <Link key={`${i}-${start}`} to={`/tag/${word.toLowerCase()}`} className="font-semibold text-brand-700 hover:underline">
            #{word}
          </Link>
        ) : (
          <Link key={`${i}-${start}`} to={`/u/${word.toLowerCase()}`} className="font-semibold text-brand-700 hover:underline">
            @{word}
          </Link>
        ),
      );
      last = start + 1 + word.length;
    }
    if (last < part.text.length) parts.push(<span key={`${i}-${last}-end`}>{part.text.slice(last)}</span>);
  });
  return <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-900">{parts}</p>;
}

function PollView({ post }: { post: Post }) {
  const { user, profile } = useMe();
  const toast = useToast();
  const mine = useQuery({ queryKey: ['pollVote', post.id], queryFn: () => fetchMyPollVote(user.uid, post.id) });
  const [counts, setCounts] = useState(post.poll!.counts);
  const [voted, setVoted] = useState<number | null>(null);
  const choice = voted ?? mine.data ?? null;
  const total = counts.reduce((a, b) => a + b, 0);
  const vote = async (i: number) => {
    const before = counts;
    setVoted(i);
    setCounts(counts.map((c, j) => (j === i ? c + 1 : c)));
    try {
      await votePoll(db, user.uid, { id: post.id, poll: { counts: before } }, i);
    } catch (e) {
      setVoted(null);
      setCounts(before);
      toast(friendlyError(e), 'error');
    }
  };
  return (
    <div className="mt-3 space-y-2" aria-label="Poll">
      {post.poll!.options.map((o, i) =>
        choice === null && !mine.isPending && profile.status === 'active' ? (
          <button
            key={i}
            onClick={() => vote(i)}
            className="block min-h-[44px] w-full rounded-xl border-2 border-brand-600 px-4 text-left text-sm font-bold text-brand-700 hover:bg-brand-50"
          >
            {o}
          </button>
        ) : (
          <div key={i} className="relative overflow-hidden rounded-xl bg-sand-100">
            <div className={`absolute inset-y-0 left-0 ${choice === i ? 'bg-brand-200' : 'bg-sand-200'}`} style={{ width: `${total ? (counts[i]! / total) * 100 : 0}%` }} />
            <div className="relative flex min-h-[44px] items-center justify-between px-4 text-sm">
              <span className="font-semibold text-gray-900">
                {o} {choice === i && '✓'}
              </span>
              <span className="font-bold tabular-nums">{total ? Math.round((counts[i]! / total) * 100) : 0}%</span>
            </div>
          </div>
        ),
      )}
      <p className="text-xs text-gray-600">
        {total} {total === 1 ? 'vote' : 'votes'}
        {choice === null ? ' · tap an option to vote' : ''}
      </p>
    </div>
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
            {name} {author.verified && <VerifiedBadge className="h-4 w-4" />}
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

function PostAvatar({ uid }: { uid: string }) {
  const { data: author } = useProfileById(uid);
  const name = author?.displayName ?? '…';
  return author ? (
    <Link to={`/u/${author.username}`} className="shrink-0 self-start">
      <Avatar url={author.photoUrl} name={name} size={42} />
    </Link>
  ) : (
    <span className="shrink-0 self-start">
      <Avatar url={null} name={author === null ? 'Deleted account' : '…'} size={42} />
    </span>
  );
}

/** Compact time like X: now, 5m, 3h, 2d, 24 Nov. */
function shortAgo(d: Date | null): string {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** X-style header line: Name @username · 2h · Town */
function PostHeader({ uid, townId, date, edited }: { uid: string; townId: string; date: Date | null; edited: boolean }) {
  const { data: author } = useProfileById(uid);
  const name = author?.displayName ?? (author === null ? 'Deleted account' : '…');
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-[15px] leading-5">
      {author ? (
        <Link to={`/u/${author.username}`} className="truncate font-bold text-gray-900 hover:underline">
          {name}
          {author.verified && <VerifiedBadge className="ml-0.5 h-[17px] w-[17px]" />}
          {author.vibe && <span className="ml-1 font-normal">{author.vibe}</span>}
        </Link>
      ) : (
        <span className="font-bold text-gray-500">{name}</span>
      )}
      {author && <span className="truncate text-gray-600">@{author.username}</span>}
      <span className="text-gray-600">·</span>
      <time dateTime={date?.toISOString()} title={fullDate(date)} className="text-gray-600">
        {shortAgo(date)}
      </time>
      <span className="text-gray-600">·</span>
      <Link to={`/towns/${townId}`} className="text-[13px] font-semibold text-brand-700 hover:underline">
        {townShortName(townId)}
      </Link>
      {edited && <span className="text-xs text-gray-500">· edited</span>}
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

export function PostCard({ post, liked: initialReaction, linkToDetail = true }: { post: Post; liked: string | null; linkToDetail?: boolean }) {
  const { user, profile, role } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidatePosts();
  const [reaction, setReactionState] = useState<Reaction | null>(initialReaction as Reaction | null);
  const [likes, setLikes] = useState(post.reactionCount);
  const [counts, setCounts] = useState<Record<string, number>>(post.reactions);
  const [liking, setLiking] = useState(false);
  const [picker, setPicker] = useState(false);
  const liked = !!reaction;
  const [reporting, setReporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'remove'>(null);
  const [busy, setBusy] = useState(false);
  const isAuthor = post.authorId === user.uid;
  const active = profile.status === 'active';

  const react = async (next: Reaction | null) => {
    if (liking || next === reaction) return;
    const prev = reaction;
    setPicker(false);
    setLiking(true);
    setReactionState(next);
    setLikes((n) => n + (next ? 1 : 0) - (prev ? 1 : 0));
    setCounts((c) => {
      const n = { ...c };
      if (prev) n[prev] = Math.max(0, (n[prev] ?? 0) - 1);
      if (next) n[next] = (n[next] ?? 0) + 1;
      return n;
    });
    try {
      await setReaction(db, user.uid, post, prev, next);
    } catch (e) {
      setReactionState(prev);
      setLikes(post.reactionCount);
      setCounts(post.reactions);
      toast(friendlyError(e), 'error');
    } finally {
      setLiking(false);
    }
  };
  const toggleLike = () => react(reaction ? null : 'like');
  const top = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([t]) => REACTIONS.find((r) => r.id === t)?.emoji);
  const current = REACTIONS.find((r) => r.id === reaction);

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
    <article className="-mx-4 border-b border-sand-200 px-4 pb-1 pt-3 transition-colors hover:bg-sand-100/40" aria-label="Post">
      {post.pinned && (
        <div className="mb-1 ml-8 flex items-center gap-1 text-[13px] font-bold text-gray-600">
          <Icon name="pin" className="h-3.5 w-3.5" /> Pinned
        </div>
      )}
      <div className="flex gap-3">
        <PostAvatar uid={post.authorId} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <PostHeader uid={post.authorId} townId={post.townId} date={post.createdAt} edited={!!post.editedAt} />
            <div className="-mr-2 -mt-1.5">
              <Menu items={items} label="Post actions" />
            </div>
          </div>
          <div className="mt-0.5">
            {linkToDetail ? (
              <Link to={`/p/${post.id}`} className="block">
                <RichText text={post.text.length > 600 ? `${post.text.slice(0, 600)}…` : post.text} />
              </Link>
            ) : (
              <RichText text={post.text} />
            )}
            <MediaGallery media={post.media} />
            {post.poll && <PollView post={post} />}
            {post.visibility === 'town' && <p className="mt-2 text-xs text-gray-600">Shared in this town's feed only</p>}
          </div>

          <div className="relative -ml-2 mt-1 flex max-w-md items-center justify-between text-[13px] text-gray-600">
            {picker && (
              <div className="absolute -top-14 left-0 z-10 flex gap-1 rounded-full bg-white px-2 py-1.5 shadow-xl ring-1 ring-sand-200" role="menu" aria-label="Reactions">
                {REACTIONS.map((r) => (
                  <button
                    key={r.id}
                    role="menuitem"
                    onClick={() => react(r.id)}
                    className={`rounded-full p-1 text-2xl transition-transform hover:scale-125 ${reaction === r.id ? 'bg-brand-50' : ''}`}
                    aria-label={`React ${r.id}`}
                  >
                    {r.emoji}
                  </button>
                ))}
              </div>
            )}
            <Link
              to={`/p/${post.id}#comments`}
              className="group inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-2 hover:text-blue-600"
              aria-label={`Comment${post.commentCount ? `, ${post.commentCount} comments` : ''}`}
            >
              <span className="rounded-full p-1.5 group-hover:bg-blue-50">
                <Icon name="comment" className="h-[18px] w-[18px]" />
              </span>
              {post.commentCount > 0 && <span className="tabular-nums">{post.commentCount}</span>}
            </Link>
            <span className="inline-flex items-center">
              <button
                onClick={toggleLike}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPicker(true);
                }}
                disabled={!active}
                aria-pressed={liked}
                aria-label={liked ? 'Unlike' : 'Like'}
                className={`group inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-2 disabled:opacity-50 ${liked ? 'text-pink-600' : 'hover:text-pink-600'}`}
              >
                <span className="rounded-full p-1.5 group-hover:bg-pink-50">
                  {current && current.id !== 'like' ? (
                    <span className="block h-[18px] w-[18px] text-[16px] leading-[18px]">{current.emoji}</span>
                  ) : (
                    <Icon name="heart" filled={liked} className="h-[18px] w-[18px]" />
                  )}
                </span>
                {likes > 0 && (
                  <span className="tabular-nums">
                    {top.length > 1 && <span className="mr-0.5 tracking-tighter">{top.join('')}</span>}
                    {likes}
                  </span>
                )}
              </button>
              <button
                onClick={() => setPicker((x) => !x)}
                disabled={!active}
                className="rounded-full p-1.5 text-base grayscale hover:bg-gold-100 hover:grayscale-0 disabled:opacity-50"
                aria-label="Choose a reaction"
                aria-expanded={picker}
              >
                😊
              </button>
            </span>
            <button
              onClick={() => sharePost(post, toast)}
              className="group inline-flex min-h-[40px] items-center rounded-full px-2 hover:text-brand-600"
              aria-label="Share"
            >
              <span className="rounded-full p-1.5 group-hover:bg-brand-50">
                <Icon name="share" className="h-[18px] w-[18px]" />
              </span>
            </button>
          </div>
        </div>
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
