import { useCrop } from '../components/Cropper';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Timestamp, collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { EXTRA_LIMITS, TOWNS, canModerate, isSuperAdmin, townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { useProfileById } from '../lib/hooks';
import { type StoryBg, createStory, deleteStory, openDm, recordStoryView, sendMessage } from '../lib/ops';
import { fetchFriendIds, useFriendships } from '../lib/friends';
import { friendlyError, isPermissionDenied, preparePhoto, timeAgo } from '../lib/util';
import { inspectVideo, uploadWithProgress } from '../components/media';
import { Icon } from '../components/Icon';
import { ReportDialog } from '../components/ReportDialog';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Button, PageHeader, SelectField } from '../components/ui';

export interface Story {
  id: string;
  authorId: string;
  townId: string;
  type: 'image' | 'video' | 'text';
  url: string | null;
  posterUrl: string | null;
  text: string;
  bg: StoryBg;
  createdAt: Date | null;
  expiresAt: Date;
  audience?: string[];
}

/** 'all', a town id, or null for a friends-only story. */
export function storyBroadcast(s: Pick<Story, 'audience'>): string | null {
  const t = (s.audience ?? []).find((a) => a.startsWith('public:'));
  return t ? t.slice('public:'.length) : null;
}

export const STORY_BGS: Record<StoryBg, string> = {
  green: 'bg-gradient-to-br from-brand-500 to-brand-900',
  gold: 'bg-gradient-to-br from-gold-400 to-orange-600',
  night: 'bg-gradient-to-br from-indigo-900 to-gray-900',
  sunset: 'bg-gradient-to-br from-pink-500 via-orange-400 to-gold-400',
  ocean: 'bg-gradient-to-br from-cyan-500 to-blue-800',
};

const toDate = (v: unknown) => (v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null);

/** My friends' stories, plus admins' stories for everyone or for my hometown. */
async function fetchStories(uid: string, hometownId: string): Promise<Story[]> {
  const snap = await getDocs(
    query(
      collection(db, 'stories'),
      where('audience', 'array-contains-any', [uid, 'public:all', `public:${hometownId}`]),
      where('status', '==', 'active'),
      where('expiresAt', '>', new Date()),
      orderBy('expiresAt', 'asc'),
      limit(150),
    ),
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, ...(x as Omit<Story, 'id' | 'createdAt' | 'expiresAt'>), createdAt: toDate(x.createdAt), expiresAt: toDate(x.expiresAt) ?? new Date() };
  });
}

const SEEN_KEY = 'siwu.seenStories';
function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(s: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* storage unavailable */
  }
}

/** Groups stories by author: me first, then unseen, then seen. */
function groupStories(stories: Story[], me: string, seen: Set<string>, blocked: Set<string>) {
  const by = new Map<string, Story[]>();
  for (const s of [...stories].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))) {
    if (blocked.has(s.authorId)) continue;
    by.set(s.authorId, [...(by.get(s.authorId) ?? []), s]);
  }
  return [...by.entries()]
    .map(([authorId, items]) => ({
      authorId,
      items,
      unseen: items.some((i) => !seen.has(i.id)),
      official: items.some((i) => storyBroadcast(i) !== null),
    }))
    // Mine first, then admins' announcements, then unseen friends' stories.
    .sort((a, b) =>
      a.authorId === me ? -1 : b.authorId === me ? 1 : Number(b.official) - Number(a.official) || Number(b.unseen) - Number(a.unseen),
    );
}

function Ring({ uid, unseen, label, official }: { uid: string; unseen: boolean; label?: string; official?: boolean }) {
  const { data: p } = useProfileById(uid);
  return (
    <>
      <span
        className={`relative rounded-full p-[3px] ${
          official ? (unseen ? 'bg-gradient-to-b from-gold-400 to-gold-600' : 'bg-gold-100') : unseen ? 'bg-gradient-to-tr from-gold-400 via-orange-500 to-brand-600' : 'bg-sand-200'
        }`}
      >
        <span className="block rounded-full bg-white p-[2px]">
          <Avatar url={p?.photoUrl} name={p?.displayName ?? '?'} size={56} />
        </span>
        {official && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gold-400 text-xs ring-2 ring-white" aria-label="Announcement">
            📢
          </span>
        )}
      </span>
      <span className="mt-1 block w-16 truncate text-center text-xs font-semibold text-gray-800">{label ?? p?.displayName.split(' ')[0] ?? '…'}</span>
    </>
  );
}

/** The row of story rings at the top of the home feed. */
export function StoriesBar() {
  const { user, profile, blocked } = useMe();
  const q = useQuery({ queryKey: ['stories', user.uid], queryFn: () => fetchStories(user.uid, profile.hometownId), staleTime: 60_000 });
  const [seen, setSeen] = useState(loadSeen);
  const [open, setOpen] = useState<number | null>(null);
  const groups = groupStories(q.data ?? [], user.uid, seen, blocked);
  const mineIndex = groups.findIndex((g) => g.authorId === user.uid);

  const markSeen = useCallback((id: string) => {
    setSeen((s) => {
      if (s.has(id)) return s;
      const n = new Set(s).add(id);
      saveSeen(n);
      return n;
    });
  }, []);

  return (
    <section aria-label="Stories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex gap-3 pb-1">
        {profile.status === 'active' && (
          <li className="shrink-0">
            <Link to="/stories/new" className="flex flex-col items-center" aria-label="Add to your story">
              <span className="relative">
                <span className="block rounded-full bg-sand-200 p-[5px]">
                  <Avatar url={profile.photoUrl} name={profile.displayName} size={56} />
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-white">
                  <Icon name="plus" className="h-4 w-4" />
                </span>
              </span>
              <span className="mt-1 block w-16 truncate text-center text-xs font-semibold text-gray-800">Your story</span>
            </Link>
          </li>
        )}
        {groups.map((g, i) => (
          <li key={g.authorId} className="shrink-0">
            <button onClick={() => setOpen(i)} className="flex flex-col items-center" aria-label="View story">
              <Ring uid={g.authorId} unseen={g.unseen} official={g.official} label={i === mineIndex ? 'You' : undefined} />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && groups[open] && (
        <StoryViewer
          groups={groups}
          start={open}
          onSeen={markSeen}
          onClose={() => {
            setOpen(null);
            void q.refetch();
          }}
        />
      )}
    </section>
  );
}

function StoryViewer({
  groups,
  start,
  onSeen,
  onClose,
}: {
  groups: ReturnType<typeof groupStories>;
  start: number;
  onSeen: (id: string) => void;
  onClose: () => void;
}) {
  const { user } = useMe();
  const toast = useToast();
  const [g, setG] = useState(start);
  const [i, setI] = useState(() => Math.max(0, groups[start]!.items.findIndex((s) => !loadSeen().has(s.id))));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reporting, setReporting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const group = groups[g]!;
  const story = group.items[i]!;
  const { data: author } = useProfileById(group.authorId);

  const next = useCallback(() => {
    if (i + 1 < group.items.length) setI(i + 1);
    else if (g + 1 < groups.length) {
      setG(g + 1);
      setI(0);
    } else onClose();
  }, [g, i, group.items.length, groups.length, onClose]);
  const prev = () => {
    if (i > 0) setI(i - 1);
    else if (g > 0) {
      setG(g - 1);
      setI(0);
    }
  };

  useEffect(() => {
    onSeen(story.id);
    setProgress(0);
    if (group.authorId !== user.uid) void recordStoryView(db, user.uid, story.id).catch(() => {});
  }, [story.id, onSeen, group.authorId, user.uid]);
  const mine = group.authorId === user.uid;
  const friends = useFriendships();
  const friendsWithAuthor = friends.get(group.authorId)?.status === 'accepted';
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setSendingReply(true);
    try {
      const chatId = await openDm(db, user.uid, group.authorId);
      await sendMessage(db, user.uid, chatId, text, null, null, {
        story: { id: story.id, text: story.text, url: story.type === 'image' ? story.url : story.posterUrl },
      });
      setReply('');
      toast('Reply sent 💬');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setSendingReply(false);
    }
  };
  const [showViewers, setShowViewers] = useState(false);
  const viewers = useQuery({
    queryKey: ['storyViews', story.id],
    queryFn: () => fetchStoryViews(story.id),
    enabled: mine,
    refetchInterval: mine ? 20_000 : false,
  });
  useEffect(() => setPaused(showViewers), [showViewers]);

  // Photos and text show for 5 seconds; videos play to the end.
  useEffect(() => {
    if (story.type === 'video' || paused) return;
    const t = setInterval(() => setProgress((p) => (p >= 1 ? 1 : p + 0.02)), 100);
    return () => clearInterval(t);
  }, [story.id, story.type, paused]);
  useEffect(() => {
    if (progress >= 1) next();
  }, [progress, next]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = '';
    };
  });

  const remove = async () => {
    try {
      await deleteStory(db, story.id);
      toast('Story deleted.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Story" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className={`relative h-full w-full max-w-md overflow-hidden ${story.type === 'text' ? STORY_BGS[story.bg] : 'bg-black'}`}>
        {story.type === 'image' && <img src={story.url!} alt="" className="h-full w-full object-contain" />}
        {story.type === 'video' && (
          <video
            ref={video}
            src={story.url!}
            poster={story.posterUrl ?? undefined}
            autoPlay
            playsInline
            className="h-full w-full object-contain"
            onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
            onEnded={next}
          />
        )}
        {story.type === 'text' && (
          <div className="flex h-full items-center justify-center p-8">
            <p className="whitespace-pre-wrap break-words text-center text-3xl font-black leading-tight text-white drop-shadow">{story.text}</p>
          </div>
        )}
        {!mine && friendsWithAuthor && (
          <form
            className="absolute inset-x-3 bottom-3 z-10 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendReply();
            }}
          >
            <label htmlFor="story-reply" className="sr-only">
              Reply to the story
            </label>
            <input
              id="story-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              maxLength={500}
              placeholder={`Reply to ${author?.displayName.split(' ')[0] ?? ''}…`}
              className="min-h-[44px] flex-1 rounded-full border border-white/60 bg-black/30 px-4 text-white placeholder-white/70 outline-none backdrop-blur"
            />
            <button type="submit" disabled={!reply.trim() || sendingReply} className="rounded-full bg-white px-4 text-sm font-bold text-gray-900 disabled:opacity-50">
              Send
            </button>
          </form>
        )}
        {mine && (
          <button
            onClick={() => setShowViewers(true)}
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/50 px-4 py-2 text-sm font-bold text-white"
            aria-label="See who viewed your story"
          >
            <Icon name="eye" className="h-4 w-4" /> {viewers.data ? viewers.data.length : '…'} {viewers.data?.length === 1 ? 'view' : 'views'}
          </button>
        )}
        {story.type !== 'text' && story.text && (
          <p className="absolute inset-x-0 bottom-16 bg-black/40 px-4 py-3 text-center text-lg font-semibold text-white">{story.text}</p>
        )}

        {/* tap zones */}
        <button className="absolute inset-y-0 left-0 w-1/3" aria-label="Previous" onClick={prev} />
        <button
          className="absolute inset-y-0 right-0 w-2/3"
          aria-label="Next"
          onClick={next}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
        />

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3 pb-8">
          <div className="flex gap-1">
            {group.items.map((s, j) => (
              <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/35">
                <div className="h-full bg-white" style={{ width: `${j < i ? 100 : j === i ? progress * 100 : 0}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-white">
            <Avatar url={author?.photoUrl} name={author?.displayName ?? '?'} size={32} />
            <span className="text-sm font-bold">{author?.displayName ?? '…'}</span>
            <span className="text-xs text-white/75">{timeAgo(story.createdAt)}</span>
            {storyBroadcast(story) && (
              <span className="rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-bold text-[#0f2f41]">
                📢 {storyBroadcast(story) === 'all' ? 'All towns' : townShortName(storyBroadcast(story)!)}
              </span>
            )}
            <span className="flex-1" />
            {group.authorId === user.uid ? (
              <button onClick={remove} className="relative z-10 rounded-full bg-white/15 p-2" aria-label="Delete story">
                <Icon name="trash" className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={() => setReporting(true)} className="relative z-10 rounded-full bg-white/15 p-2" aria-label="Report story">
                <Icon name="flag" className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="relative z-10 rounded-full bg-white/15 p-2" aria-label="Close story">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {showViewers && (
        <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-h-[60vh] max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 text-gray-900 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">
              <Icon name="eye" className="mr-1 inline h-4 w-4" />
              Viewed by {viewers.data?.length ?? 0}
            </h2>
            <button onClick={() => setShowViewers(false)} className="rounded-full p-2 hover:bg-sand-100" aria-label="Close viewers">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
          {viewers.data?.length === 0 && <p className="py-6 text-center text-sm text-gray-600">No views yet. Your friends will show here when they watch.</p>}
          <ul className="divide-y divide-sand-200">
            {(viewers.data ?? []).map((v) => (
              <ViewerRow key={v.uid} uid={v.uid} at={v.viewedAt} />
            ))}
          </ul>
        </div>
      )}
      {reporting && (
        <ReportDialog
          open
          onClose={() => setReporting(false)}
          target={{ targetType: 'story', targetId: story.id, targetPath: `stories/${story.id}`, townId: story.townId }}
        />
      )}
    </div>
  );
}

async function fetchStoryViews(storyId: string): Promise<{ uid: string; viewedAt: Date | null }[]> {
  const snap = await getDocs(query(collection(db, 'stories', storyId, 'views'), orderBy('viewedAt', 'desc'), limit(500)));
  return snap.docs.map((d) => ({ uid: d.id, viewedAt: toDate(d.data().viewedAt) }));
}

function ViewerRow({ uid, at }: { uid: string; at: Date | null }) {
  const { data: p } = useProfileById(uid);
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{p?.displayName ?? '…'}</span>
        <span className="block text-xs text-gray-600">{p ? `@${p.username} · ` : ''}{timeAgo(at)}</span>
      </span>
    </li>
  );
}

export function NewStoryPage() {
  const { user, profile, role } = useMe();
  // Admins can post a story for everyone (all towns) or everyone from one town, e.g. announcements.
  const audiences: { id: string; label: string }[] = [
    { id: '', label: '👥 My friends' },
    ...(isSuperAdmin(role) ? [{ id: 'all', label: '📢 Everyone — all towns' }] : []),
    ...TOWNS.filter((t) => canModerate(role, t.id)).map((t) => ({ id: t.id as string, label: `📢 Everyone from ${t.shortName}` })),
  ];
  const [audience, setAudience] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'text' | 'media'>('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState<StoryBg>('sunset');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crop = useCrop();
  const pick = async (picked: File | undefined) => {
    const f = picked && (await crop(picked, { shapes: ['story', 'original', 'square'] }));
    if (input.current) input.current.value = '';
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setMode('media');
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const friendIds = audience ? [] : await fetchFriendIds(user.uid);
      if (mode === 'text') {
        if (!text.trim()) throw new Error('Write something for your story.');
        await createStory(db, user.uid, profile.hometownId, { type: 'text', url: null, posterUrl: null, text: text.trim().slice(0, 200), bg }, friendIds, audience || null);
      } else if (file) {
        const isVideo = file.type.startsWith('video/');
        let url: string;
        let posterUrl: string | null = null;
        if (isVideo) {
          if (file.size > EXTRA_LIMITS.videoMaxBytes) throw new Error('Videos can be at most 50 MB.');
          const info = await inspectVideo(file);
          if (Number.isFinite(info.duration) && info.duration > 61) throw new Error('Story videos can be at most 60 seconds.');
          if (info.poster) posterUrl = await uploadWithProgress('/uploads/image', info.poster, () => {}).catch(() => null);
          url = await uploadWithProgress('/uploads/video', file, setProgress);
        } else {
          const blob = await preparePhoto(file, EXTRA_LIMITS.imageMaxPixels, EXTRA_LIMITS.imageMaxBytes);
          url = await uploadWithProgress('/uploads/image', blob, setProgress);
        }
        await createStory(db, user.uid, profile.hometownId, { type: isVideo ? 'video' : 'image', url, posterUrl, text: text.trim().slice(0, 200), bg }, friendIds, audience || null);
      }
      void qc.invalidateQueries({ queryKey: ['stories'] });
      toast('Your story is up for 24 hours ✨');
      navigate('/');
    } catch (e) {
      setError(isPermissionDenied(e) ? 'Wait a few seconds between stories.' : e instanceof Error && !('code' in e) && !('status' in e) ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (profile.status !== 'active') return <Alert kind="warning">Your account is suspended.</Alert>;

  return (
    <div className="space-y-4">
      <PageHeader title="New story" back />
      <div className="flex gap-2">
        <Button variant={mode === 'text' ? 'primary' : 'secondary'} small onClick={() => setMode('text')}>
          Aa Text
        </Button>
        <Button variant={mode === 'media' ? 'primary' : 'secondary'} small icon="camera" onClick={() => input.current?.click()}>
          Photo or video
        </Button>
        <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" className="sr-only" aria-label="Choose story photo or video" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <div className={`relative mx-auto aspect-[9/16] max-h-[60vh] overflow-hidden rounded-3xl shadow-lg ${mode === 'text' ? STORY_BGS[bg] : 'bg-black'}`}>
        {mode === 'media' && preview && file?.type.startsWith('video/') && <video src={preview} className="h-full w-full object-contain" muted autoPlay loop playsInline />}
        {mode === 'media' && preview && !file?.type.startsWith('video/') && <img src={preview} alt="" className="h-full w-full object-contain" />}
        <label htmlFor="story-text" className="sr-only">
          Story text
        </label>
        <textarea
          id="story-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder={mode === 'text' ? 'Type something…' : 'Add a caption (optional)'}
          className={`absolute inset-x-0 ${mode === 'text' ? 'top-1/3 h-1/3 text-3xl font-black' : 'bottom-0 h-24 bg-black/40 text-lg font-semibold'} resize-none bg-transparent px-6 text-center text-white placeholder-white/60 outline-none`}
        />
      </div>
      {mode === 'text' && (
        <div className="flex justify-center gap-2" role="radiogroup" aria-label="Background">
          {(Object.keys(STORY_BGS) as StoryBg[]).map((b) => (
            <button
              key={b}
              role="radio"
              aria-checked={bg === b}
              aria-label={b}
              onClick={() => setBg(b)}
              className={`h-9 w-9 rounded-full ${STORY_BGS[b]} ${bg === b ? 'ring-4 ring-brand-300' : ''}`}
            />
          ))}
        </div>
      )}
      {busy && mode === 'media' && progress > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-sand-200">
          <div className="h-full bg-brand-600" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <Button className="w-full" busy={busy} onClick={share} disabled={mode === 'media' && !file}>
        Share to your story
      </Button>
      {audiences.length > 1 && (
        <SelectField label="Who can see this story?" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </SelectField>
      )}
      <p className="text-center text-xs text-gray-600">
        {audience
          ? `Everyone ${audience === 'all' ? 'in all five towns' : `from ${townShortName(audience)}`} will see this story, friends or not. It disappears after 24 hours.`
          : 'Only your friends can see your story. It disappears after 24 hours.'}
      </p>
    </div>
  );
}
