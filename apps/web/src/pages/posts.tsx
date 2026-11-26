import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LIMITS, type PostVisibility, TOWNS, type TownId, canModerate, isTownId, myTowns, postSchema, postTextSchema, townName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { useInvalidatePosts } from '../lib/hooks';
import { type MediaItem, createPost, editPost, extractMentions } from '../lib/ops';
import { resolveMentions } from '../lib/queries';
import { fetchLastPostAt, fetchMyLikes, fetchPost } from '../lib/queries';
import { friendlyError, isPermissionDenied } from '../lib/util';
import { PostCard, QuotedPost } from '../components/PostCard';
import { Comments } from '../components/Comments';
import { MediaPicker } from '../components/media';
import { useToast } from '../components/Toast';
import { Alert, Button, EmptyState, ErrorState, PageHeader, PageSpinner, SelectField, TextArea, TextField } from '../components/ui';

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
  const { user, profile, role } = useMe();
  // Members post in their hometown (and choose whether it also shows in the All Akpafu feed).
  const towns = TOWNS.filter((t) => myTowns(profile.hometownId, role).includes(t.id));
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invalidate = useInvalidatePosts();
  const toast = useToast();
  const initialTown = params.get('town');
  const quoteId = params.get('quote');
  const quoted = useQuery({ queryKey: ['post', quoteId], queryFn: () => fetchPost(quoteId!), enabled: !!quoteId });
  const [townId, setTownId] = useState<TownId>(
    isTownId(initialTown) && towns.some((t) => t.id === initialTown) ? initialTown : (profile.hometownId as TownId),
  );
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
    if (!parsed.data.text && !media.length && !quoteId) {
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
      const q = quoted.data;
      if (quoteId && (!q || q.status !== 'published')) {
        setError('The post you are quoting is no longer available.');
        return;
      }
      const id = await createPost(db, user.uid, parsed.data, media, {
        poll: options,
        mentions,
        quoteOf: q ? { id: q.id, authorId: q.authorId } : null,
      });
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
        {towns.length > 1 ? (
          <SelectField label="Town" value={townId} onChange={(e) => setTownId(e.target.value as TownId)}>
            {towns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="text-sm text-gray-700">
            Posting in <strong>{townName(townId)}</strong>, your hometown.
          </p>
        )}
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
        {quoteId && <QuotedPost id={quoteId} />}
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
      // Back to the post, unless the member already went somewhere else while it was saving.
      if (window.location.pathname === `/p/${postId}/edit`) navigate(`/p/${postId}`, { replace: true });
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

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found" icon="alert">
      <Link to="/" className="font-medium text-brand-800 underline">
        Go to the home feed
      </Link>
    </EmptyState>
  );
}
