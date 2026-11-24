import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS, canModerate, commentTextSchema } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { useProfileById } from '../lib/hooks';
import { addComment, deleteComment } from '../lib/ops';
import { fetchComments } from '../lib/queries';
import type { Comment, Post } from '../lib/types';
import { friendlyError, isPermissionDenied, timeAgo } from '../lib/util';
import { Menu, type MenuItem } from './Menu';
import { RichText } from './PostCard';
import { ReportDialog } from './ReportDialog';
import { useToast } from './Toast';
import { Alert, Avatar, Button, ErrorState, Modal, PageSpinner } from './ui';
import { VerifiedBadge } from './VerifiedBadge';

const COMMENT_PAGE = 50;

export function Comments({ post, canComment, sheet = false }: { post: Post; canComment: boolean; sheet?: boolean }) {
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

  const form = canComment && (
    <form onSubmit={submit} className={`flex items-end gap-2 ${sheet ? 'border-t border-sand-200 bg-white p-2 pb-[calc(8px+env(safe-area-inset-bottom))]' : 'rounded-2xl border border-sand-200 bg-white p-2 shadow-sm'}`}>
      <label htmlFor={sheet ? 'sheet-comment' : 'new-comment'} className="sr-only">
        Add a comment
      </label>
      <textarea
        id={sheet ? 'sheet-comment' : 'new-comment'}
        rows={1}
        maxLength={LIMITS.commentMaxChars}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment…"
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-full bg-sand-100 px-4 py-2.5 text-base outline-none focus:ring-2 focus:ring-brand-200"
      />
      <Button type="submit" busy={busy} disabled={!text.trim()}>
        {sheet ? 'Send' : 'Comment'}
      </Button>
    </form>
  );

  const list = q.isPending ? (
    <PageSpinner />
  ) : q.isError ? (
    <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
  ) : comments.length === 0 ? (
    <p className="py-8 text-center text-sm text-gray-600">No comments yet. Start the conversation 💬</p>
  ) : (
    <ul className="space-y-3">
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} post={post} onChanged={refresh} toast={toast} />
      ))}
    </ul>
  );
  const more = q.data && q.data.length >= max && (
    <div className="flex justify-center">
      <Button variant="secondary" small onClick={() => setMax((m) => m + COMMENT_PAGE)}>
        Show more comments
      </Button>
    </div>
  );

  if (sheet)
    return (
      <>
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {list}
          {more}
        </div>
        {error && (
          <div className="px-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {form || (
          <p className="border-t border-sand-200 p-3 text-center text-sm text-gray-600">You cannot comment while suspended.</p>
        )}
      </>
    );

  return (
    <section id="comments" aria-label="Comments" className="space-y-3">
      <h2 className="text-base font-bold text-gray-900">Comments</h2>
      {form}
      {error && <Alert>{error}</Alert>}
      {list}
      {more}
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


/** TikTok-style: comments slide up over the feed; the post stays where it was. */
export function CommentsSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const { profile } = useMe();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const n = post.commentCount;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Comments">
      <button className={`absolute inset-0 bg-black/40 transition-opacity ${shown ? 'opacity-100' : 'opacity-0'}`} aria-label="Close comments" onClick={onClose} />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto flex h-[75vh] max-w-[600px] flex-col rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 ${shown ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="relative flex items-center justify-center border-b border-sand-200 py-3">
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-sand-200" />
          <h2 className="mt-1 text-sm font-bold text-gray-900">
            {n} {n === 1 ? 'comment' : 'comments'}
          </h2>
          <button onClick={onClose} className="absolute right-2 top-1.5 rounded-full p-2 text-gray-600 hover:bg-sand-100" aria-label="Close">
            ×
          </button>
        </div>
        <Comments post={post} canComment={profile.status === 'active'} sheet />
      </div>
    </div>
  );
}
