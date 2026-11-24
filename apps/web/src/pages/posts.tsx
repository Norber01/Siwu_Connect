import { useEffect, useState } from 'react';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LIMITS,
  type PostVisibility,
  TOWNS,
  type TownId,
  canModerate,
  commentTextSchema,
  isTownId,
  postSchema,
  postTextSchema,
} from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { useInvalidatePosts, useProfileById } from '../lib/hooks';
import { type MediaItem, addComment, createPost, deleteComment, editPost, extractMentions } from '../lib/ops';
import { resolveMentions } from '../lib/queries';
import { fetchComments, fetchLastPostAt, fetchMyLikes, fetchPost } from '../lib/queries';
import type { Comment, Post } from '../lib/types';
import { friendlyError, isPermissionDenied, timeAgo } from '../lib/util';
import { PostCard, RichText } from '../components/PostCard';
import { MediaPicker } from '../components/media';
import { Menu, type MenuItem } from '../components/Menu';
import { ReportDialog } from '../components/ReportDialog';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Button, EmptyState, ErrorState, Modal, PageHeader, PageSpinner, SelectField, TextArea, TextField } from '../components/ui';

function VisibilityPicker({ value, onChange }: { value: PostVisibility; onChange: (v: PostVisibility) => void }) {
  const opt = (v: PostVisibility, title: string, desc: string) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
        value === v ? 'border-brand-700 bg-brand-50' : 'border-sand-200 bg-white'
      }`}
    >
      <input type="radio" name="visibility" checked={value === v} onChange={() => onChange(v)} className="mt-1 h-4 w-4 accent-brand-800" />
      <span>
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-600">{desc}</span>
      </span>
    </label>
  );
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-gray-800">Who sees it in their feed?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {opt('akpafu', 'All Akpafu', 'The town feed and the Akpafu-wide feed.')}
        {opt('town', 'This town only', "Only this town's feed.")}
      </div>
    </fieldset>
  );
}

export function NewPostPage() {
  const { user, profile } = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invalidate = useInvalidatePosts();
  const toast = useToast();
  const initialTown = params.get('town');
  const [townId, setTownId] = useState<TownId>(isTownId(initialTown) ? initialTown : (profile.hometownId as TownId));
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('akpafu');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (profile.status !== 'active') {
    return (
      <EmptyState title="Posting is unavailable" icon="ban">
        Your account is suspended, so you cannot create posts.
      </EmptyState>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = postSchema.safeParse({ townId, text, visibility });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    if (!parsed.data.text && !media.length) {
      setError('Write something or add a photo or video.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const last = await fetchLastPostAt(user.uid);
      const wait = last ? Math.ceil(LIMITS.postCooldownSeconds - (Date.now() - last.getTime()) / 1000) : 0;
      if (wait > 0) {
        setError(`You're posting quickly. Please wait ${wait} seconds and try again.`);
        return;
      }
      const options = poll?.map((o) => o.trim()).filter(Boolean) ?? null;
      if (poll && (!options || options.length < 2)) {
        setError('A poll needs at least two options.');
        return;
      }
      if (poll && !parsed.data.text) {
        setError('Write the poll question in your post.');
        return;
      }
      const mentions = await resolveMentions(extractMentions(parsed.data.text));
      const id = await createPost(db, user.uid, parsed.data, media, { poll: options, mentions });
      invalidate();
      toast('Your post is live.');
      navigate(`/p/${id}`, { replace: true });
    } catch (err) {
      setError(
        isPermissionDenied(err) ? "You're posting quickly. Please wait a few seconds and try again." : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Create post" back />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <SelectField label="Town" value={townId} onChange={(e) => setTownId(e.target.value as TownId)}>
          {TOWNS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <TextArea
          label="Your post"
          rows={5}
          maxLength={LIMITS.postMaxChars}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share news, a question, an event or an update for the community…"
          hint={`${text.length}/${LIMITS.postMaxChars}`}
          autoFocus
        />
        <p className="-mt-3 text-xs text-gray-600">Tip: use #hashtags to join a topic and @username to mention someone.</p>
        <MediaPicker value={media} onChange={setMedia} onBusyChange={setUploading} />
        {poll ? (
          <fieldset className="space-y-2 rounded-2xl border border-sand-200 bg-white p-3">
            <legend className="px-1 text-sm font-semibold text-gray-800">📊 Poll options</legend>
            {poll.map((o, i) => (
              <TextField
                key={i}
                label={`Option ${i + 1}`}
                className="[&_label]:sr-only"
                placeholder={`Option ${i + 1}`}
                maxLength={60}
                value={o}
                onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
            <div className="flex gap-2">
              {poll.length < 4 && (
                <Button type="button" small variant="secondary" icon="plus" onClick={() => setPoll([...poll, ''])}>
                  Add option
                </Button>
              )}
              <Button type="button" small variant="ghost" onClick={() => setPoll(null)}>
                Remove poll
              </Button>
            </div>
          </fieldset>
        ) : (
          <Button type="button" variant="secondary" small onClick={() => setPoll(['', ''])}>
            📊 Add a poll
          </Button>
        )}
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={uploading || (!text.trim() && !media.length)}>
            {uploading ? 'Uploading…' : 'Post'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function EditPostPage() {
  const { postId = '' } = useParams();
  const { user } = useMe();
  const navigate = useNavigate();
  const invalidate = useInvalidatePosts();
  const toast = useToast();
  const q = useQuery({ queryKey: ['post', postId, 'edit'], queryFn: () => fetchPost(postId) });
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('akpafu');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) {
      setText(q.data.text);
      setVisibility(q.data.visibility);
      setMedia(q.data.media);
    }
  }, [q.data]);

  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data || q.data.status !== 'published') return <EmptyState title="This post is no longer available" />;
  if (q.data.authorId !== user.uid) return <EmptyState title="You can only edit your own posts" icon="ban" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = postTextSchema.safeParse(text);
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    if (!parsed.data && !media.length) {
      setError('Write something or add a photo or video.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await editPost(db, postId, { text: parsed.data, visibility }, media);
      invalidate();
      toast('Post updated.');
      navigate(`/p/${postId}`, { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Edit post" back />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <TextArea
          label="Your post"
          rows={5}
          maxLength={LIMITS.postMaxChars}
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint={`${text.length}/${LIMITS.postMaxChars}`}
        />
        <MediaPicker value={media} onChange={setMedia} onBusyChange={setUploading} />
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={uploading}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}

export function PostDetailPage() {
  const { postId = '' } = useParams();
  const { user, profile, role } = useMe();
  const q = useQuery({
    queryKey: ['post', postId],
    queryFn: async () => {
      const post = await fetchPost(postId);
      const liked = post ? ((await fetchMyLikes(user.uid, [post.id])).get(post.id) ?? null) : null;
      return { post, liked };
    },
  });

  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const post = q.data.post;
  if (!post || post.status === 'deleted') {
    return (
      <div>
        <PageHeader title="Post" back />
        <EmptyState title="This post is no longer available">It may have been deleted by its author.</EmptyState>
      </div>
    );
  }
  const visibleToMe = post.status === 'published' || canModerate(role, post.townId);

  return (
    <div className="space-y-4">
      <PageHeader title="Post" back />
      {post.status === 'removed' && (
        <Alert kind="warning">
          {post.authorId === user.uid
            ? 'A moderator removed this post. Only you can see it. You can delete it.'
            : 'This post was removed by a moderator and is hidden from other users.'}
        </Alert>
      )}
      {visibleToMe && <PostCard post={post} liked={q.data.liked} linkToDetail={false} key={`${post.id}-${post.reactionCount}`} />}
      {post.status === 'published' && <Comments post={post} canComment={profile.status === 'active'} />}
    </div>
  );
}

const COMMENT_PAGE = 50;

function Comments({ post, canComment }: { post: Post; canComment: boolean }) {
  const { user, blocked } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [max, setMax] = useState(COMMENT_PAGE);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['comments', post.id, max], queryFn: () => fetchComments(post.id, max) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['comments', post.id] });
    void qc.invalidateQueries({ queryKey: ['post', post.id] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = commentTextSchema.safeParse(text);
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addComment(db, user.uid, post, parsed.data);
      setText('');
      refresh();
    } catch (err) {
      setError(
        isPermissionDenied(err)
          ? "Your comment couldn't be posted. Wait a few seconds and try again — or the author may have restricted comments from you."
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const comments = (q.data ?? []).filter((c) => !blocked.has(c.authorId));

  return (
    <section id="comments" aria-label="Comments" className="space-y-3">
      <h2 className="text-base font-bold text-gray-900">Comments</h2>
      {canComment && (
        <form onSubmit={submit} className="flex items-end gap-2 rounded-2xl border border-sand-200 bg-white p-2 shadow-sm">
          <label htmlFor="new-comment" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="new-comment"
            rows={1}
            maxLength={LIMITS.commentMaxChars}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a comment…"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl bg-sand-100 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-brand-200"
          />
          <Button type="submit" busy={busy} disabled={!text.trim()}>
            Comment
          </Button>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : comments.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-600">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} post={post} onChanged={refresh} toast={toast} />
          ))}
        </ul>
      )}
      {q.data && q.data.length >= max && (
        <div className="flex justify-center">
          <Button variant="secondary" small onClick={() => setMax((m) => m + COMMENT_PAGE)}>
            Show more comments
          </Button>
        </div>
      )}
    </section>
  );
}

function CommentItem({
  comment,
  post,
  onChanged,
  toast,
}: {
  comment: Comment;
  post: Post;
  onChanged: () => void;
  toast: (m: string, k?: 'success' | 'error') => void;
}) {
  const { user, profile, role } = useMe();
  const [reporting, setReporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'remove'>(null);
  const [busy, setBusy] = useState(false);
  const mine = comment.authorId === user.uid;

  const items: MenuItem[] = [];
  if (mine) items.push({ label: 'Delete comment', icon: 'trash', danger: true, onSelect: () => setConfirm('delete') });
  if (!mine && profile.status === 'active') items.push({ label: 'Report comment', icon: 'flag', onSelect: () => setReporting(true) });
  if (!mine && canModerate(role, comment.townId))
    items.push({ label: 'Remove comment (moderator)', icon: 'shield', danger: true, onSelect: () => setConfirm('remove') });

  const run = async () => {
    setBusy(true);
    try {
      if (confirm === 'delete') await deleteComment(db, post.id, comment.id, post.status === 'published');
      else await api(`/admin/posts/${post.id}/comments/${comment.id}/remove`, { json: { note: '' } });
      toast(confirm === 'delete' ? 'Comment deleted.' : 'Comment removed.');
      setConfirm(null);
      onChanged();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex gap-2">
      <CommentAvatar uid={comment.authorId} />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-sand-200">
          <div className="flex items-start justify-between gap-2">
            <CommentAuthor uid={comment.authorId} />
            <Menu items={items} label="Comment actions" />
          </div>
          <RichText text={comment.text} />
        </div>
        <p className="mt-1 pl-3 text-xs text-gray-600">{timeAgo(comment.createdAt)}</p>
      </div>
      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        target={{
          targetType: 'comment',
          targetId: comment.id,
          targetPath: `posts/${post.id}/comments/${comment.id}`,
          townId: comment.townId,
        }}
      />
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'delete' ? 'Delete comment?' : 'Remove comment?'}>
        <p className="text-sm text-gray-700">
          {confirm === 'delete' ? 'This cannot be undone.' : 'The comment will be hidden from everyone. This is recorded in the audit log.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} onClick={run}>
            {confirm === 'delete' ? 'Delete' : 'Remove'}
          </Button>
        </div>
      </Modal>
    </li>
  );
}

function CommentAvatar({ uid }: { uid: string }) {
  const { data } = useProfileById(uid);
  return (
    <span className="pt-1">
      <Avatar url={data?.photoUrl} name={data?.displayName ?? '?'} size={36} />
    </span>
  );
}

function CommentAuthor({ uid }: { uid: string }) {
  const { data } = useProfileById(uid);
  if (!data) return <span className="text-sm font-bold text-gray-500">{data === null ? 'Deleted account' : '…'}</span>;
  return (
    <Link to={`/u/${data.username}`} className="truncate text-sm font-bold text-gray-900 hover:underline">
      {data.displayName} {data.verified && <VerifiedBadge className="h-3.5 w-3.5" />}
    </Link>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found" icon="alert">
      <Link to="/" className="font-medium text-brand-800 underline">
        Go to the home feed
      </Link>
    </EmptyState>
  );
}
