import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { COUNTRIES, RESIDENCE_OPTIONS, TOWNS, canSuspend, profileSchema, townName } from '@siwu/shared';
import { useAuth, useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { blockUser, openDm, unblockUser, updateBio, updateProfile } from '../lib/ops';
import { ThemePicker } from '../components/theme';
import { fetchMyLikes, fetchProfile, fetchProfileByUsername, fetchSellerListings, searchPeople, searchPosts } from '../lib/queries';
import { FeedbackDialog, InviteButton } from '../components/extras';
import { formatPrice } from '../lib/util';
import type { Profile } from '../lib/types';
import { friendlyError } from '../lib/util';
import { Feed } from '../components/Feed';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Menu';
import { PostCard } from '../components/PostCard';
import { type ProfileDraft, ProfileFields } from '../components/ProfileFields';
import { ReportDialog } from '../components/ReportDialog';
import { useToast } from '../components/Toast';
import {
  Alert,
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageSpinner,
  SelectField,
  TextField,
  TownBadge,
} from '../components/ui';

export function MyProfileRedirect() {
  const { profile } = useMe();
  return <Navigate to={`/u/${profile.username}`} replace />;
}

function residenceText(p: Profile): string | null {
  if (!p.residence) return null;
  if (p.residence === 'abroad') {
    const c = COUNTRIES.find((x) => x.code === p.countryCode);
    return c && c.code !== 'OTHER' ? `Lives in ${c.name}` : 'Lives outside Ghana';
  }
  return RESIDENCE_OPTIONS.find((r) => r.id === p.residence)?.label ?? null;
}

export function ProfilePage() {
  const { username = '' } = useParams();
  const { user, role, blocked } = useMe();
  const { setBlocked } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['profileByUsername', username], queryFn: () => fetchProfileByUsername(username) });
  const [reporting, setReporting] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [busy, setBusy] = useState(false);

  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const p = q.data;
  if (!p) return <EmptyState title="User not found" icon="user">No one has the username @{username}.</EmptyState>;

  const isMe = p.uid === user.uid;
  const isBlocked = blocked.has(p.uid);

  const toggleBlock = async () => {
    try {
      if (isBlocked) await unblockUser(db, user.uid, p.uid);
      else await blockUser(db, user.uid, p.uid);
      setBlocked(p.uid, !isBlocked);
      toast(isBlocked ? `You unblocked @${p.username}.` : `You blocked @${p.username}. You won't see their posts or comments.`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const startChat = async () => {
    try {
      navigate(`/chat/${await openDm(db, user.uid, p.uid)}`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const suspend = async () => {
    setBusy(true);
    try {
      await api(`/admin/users/${p.uid}/${p.status === 'active' ? 'suspend' : 'restore'}`, { json: { note: '' } });
      toast(p.status === 'active' ? 'User suspended.' : 'User restored.');
      setConfirmSuspend(false);
      await q.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const items: MenuItem[] = [];
  if (!isMe) {
    items.push({ label: isBlocked ? 'Unblock user' : 'Block user', icon: 'ban', onSelect: toggleBlock });
    items.push({ label: 'Report user', icon: 'flag', onSelect: () => setReporting(true) });
    if (canSuspend(role, p.hometownId))
      items.push({
        label: p.status === 'active' ? 'Suspend user (admin)' : 'Restore user (admin)',
        icon: 'shield',
        danger: p.status === 'active',
        onSelect: () => setConfirmSuspend(true),
      });
  }

  const residence = residenceText(p);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden shadow-sm">
        <div className="h-20 bg-gradient-to-r from-brand-800 via-brand-600 to-brand-500">
          <div className="h-1.5 bg-gold-400" />
        </div>
        <div className="px-5 pb-5">
          <div className="-mt-10 flex items-end justify-between">
            <span className="rounded-full ring-4 ring-white">
              <Avatar url={p.photoUrl} name={p.displayName} size={84} />
            </span>
            <Menu items={items} label="Profile actions" />
          </div>
          <h1 className="mt-2 text-xl font-bold text-gray-900">
            {p.displayName} {p.vibe && <span aria-label="vibe">{p.vibe}</span>}
          </h1>
          <p className="text-sm text-gray-600">@{p.username}</p>
          {p.bio && <p className="mt-2 whitespace-pre-wrap text-[15px] text-gray-800">{p.bio}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
            <span className="inline-flex items-center gap-1">
              <Icon name="home" className="h-4 w-4" /> From
            </span>
            <TownBadge townId={p.hometownId} />
            {residence && <span className="text-gray-600">· {residence}</span>}
          </div>
          {p.status === 'suspended' && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">This account is suspended.</p>
          )}
          {!isMe && !isBlocked && (
            <div className="mt-4 flex gap-2">
              <Button small icon="message" onClick={startChat}>
                Message
              </Button>
            </div>
          )}
          {isMe && (
            <div className="mt-4 flex gap-2">
              <Button small icon="edit" onClick={() => navigate('/settings')}>
                Edit profile
              </Button>
              <Button variant="secondary" small icon="settings" onClick={() => navigate('/settings')}>
                Settings
              </Button>
            </div>
          )}
        </div>
      </Card>

      {!isBlocked && <SellerListings uid={p.uid} />}

      <h2 className="text-base font-bold text-gray-900">{isMe ? 'Your posts' : 'Posts'}</h2>
      {isBlocked ? (
        <EmptyState title="You blocked this user" icon="ban">
          Unblock them to see their posts.
        </EmptyState>
      ) : (
        <Feed key={p.uid} feed={{ kind: 'author', uid: p.uid }} emptyTitle="No posts yet" />
      )}

      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        target={{ targetType: 'user', targetId: p.uid, targetPath: `users/${p.uid}`, townId: p.hometownId }}
      />
      <Modal
        open={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        title={p.status === 'active' ? `Suspend @${p.username}?` : `Restore @${p.username}?`}
      >
        <p className="text-sm text-gray-700">
          {p.status === 'active'
            ? 'They will still be able to read, but not post, comment, like or report. This is recorded in the audit log.'
            : 'They will be able to post and comment again. This is recorded in the audit log.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSuspend(false)}>
            Cancel
          </Button>
          <Button variant={p.status === 'active' ? 'danger' : 'primary'} busy={busy} onClick={suspend}>
            {p.status === 'active' ? 'Suspend' : 'Restore'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function SearchPage() {
  const { user, blocked } = useMe();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const term = params.get('q') ?? '';
  const tab = params.get('tab') === 'people' ? 'people' : 'posts';
  const town = params.get('town') ?? '';

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const posts = useQuery({
    queryKey: ['search', 'posts', term, town],
    queryFn: async () => {
      const items = await searchPosts(term, town || null);
      return { items, liked: await fetchMyLikes(user.uid, items.map((p) => p.id)) };
    },
    enabled: tab === 'posts' && term.trim().length >= 2,
  });
  const people = useQuery({
    queryKey: ['search', 'people', term],
    queryFn: () => searchPeople(term),
    enabled: tab === 'people' && term.trim().length >= 2,
  });
  const active = tab === 'posts' ? posts : people;

  return (
    <div className="space-y-4">
      <PageHeader title="Search" />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: text.trim() });
        }}
        className="flex gap-2"
      >
        <TextField
          label="Search"
          className="flex-1 [&_label]:sr-only"
          type="search"
          placeholder={tab === 'posts' ? 'Search posts' : 'Search people by name or username'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" icon="search" aria-label="Search" />
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1 rounded-xl bg-sand-200 p-1">
          {(['posts', 'people'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => update({ tab: t === 'posts' ? '' : 'people' })}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold capitalize ${tab === t ? 'bg-white text-brand-900 shadow-sm' : 'text-gray-600'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'posts' && (
          <SelectField label="Town" className="[&_label]:sr-only" value={town} onChange={(e) => update({ town: e.target.value })}>
            <option value="">All towns</option>
            {TOWNS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {term.trim().length < 2 ? (
        <EmptyState title="Find posts and people" icon="search">
          Type at least two characters. Search matches whole words in posts, and the start of names or usernames.
        </EmptyState>
      ) : active.isPending ? (
        <PageSpinner />
      ) : active.isError ? (
        <ErrorState message={friendlyError(active.error)} onRetry={() => active.refetch()} />
      ) : tab === 'posts' ? (
        posts.data!.items.filter((p) => !blocked.has(p.authorId)).length ? (
          <div className="space-y-3">
            {posts.data!.items
              .filter((p) => !blocked.has(p.authorId))
              .map((p) => (
                <PostCard key={p.id} post={p} liked={posts.data!.liked.get(p.id) ?? null} />
              ))}
          </div>
        ) : (
          <EmptyState title={`No posts match "${term}"`} icon="search" />
        )
      ) : people.data!.length ? (
        <ul className="space-y-2">
          {people.data!.map((p) => (
            <li key={p.uid}>
              <Link to={`/u/${p.username}`} className="flex items-center gap-3 rounded-2xl border border-sand-200 bg-white p-3 hover:border-brand-300">
                <Avatar url={p.photoUrl} name={p.displayName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-gray-900">{p.displayName}</span>
                  <span className="block text-sm text-gray-600">
                    @{p.username} · {townName(p.hometownId)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={`No people match "${term}"`} icon="user" />
      )}
    </div>
  );
}

export function SettingsPage() {
  const { user, profile, blocked } = useMe();
  const { signOut, setBlocked } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: profile.displayName,
    hometownId: profile.hometownId as ProfileDraft['hometownId'],
    residence: profile.residence ?? '',
    countryCode: profile.countryCode ?? '',
    photoUrl: profile.photoUrl,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const blockedList = useQuery({
    queryKey: ['blockedProfiles', [...blocked].join(',')],
    queryFn: () => Promise.all([...blocked].map((uid) => fetchProfile(uid))),
    enabled: blocked.size > 0,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = profileSchema.safeParse({
      displayName: draft.displayName,
      hometownId: draft.hometownId,
      residence: draft.residence || null,
      countryCode: draft.countryCode || null,
    });
    if (!p.success) {
      setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await updateProfile(db, user.uid, { ...p.data, photoUrl: draft.photoUrl });
      toast('Profile saved.');
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" back />
      <Card className="p-5">
        <h2 className="mb-4 text-base font-bold text-gray-900">Profile</h2>
        {profile.status === 'active' ? (
          <form onSubmit={save} className="space-y-5" noValidate>
            <p className="text-sm text-gray-600">
              Username: <strong>@{profile.username}</strong> (cannot be changed)
            </p>
            <ProfileFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} errors={errors} />
            <Button type="submit" busy={busy}>
              Save profile
            </Button>
          </form>
        ) : (
          <Alert kind="warning">Your account is suspended, so your profile cannot be edited.</Alert>
        )}
      </Card>

      <BioCard />

      <Card className="p-5">
        <h2 className="mb-2 text-base font-bold text-gray-900">Appearance</h2>
        <ThemePicker />
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-base font-bold text-gray-900">Blocked users</h2>
        {blocked.size === 0 ? (
          <p className="text-sm text-gray-600">You haven't blocked anyone.</p>
        ) : blockedList.isPending ? (
          <PageSpinner />
        ) : (
          <ul className="divide-y divide-sand-100">
            {(blockedList.data ?? []).map((p, i) => {
              const uid = [...blocked][i]!;
              return (
                <li key={uid} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm">{p ? `${p.displayName} (@${p.username})` : 'Deleted account'}</span>
                  <Button
                    variant="secondary"
                    small
                    onClick={async () => {
                      try {
                        await unblockUser(db, user.uid, uid);
                        setBlocked(uid, false);
                      } catch (e) {
                        toast(friendlyError(e), 'error');
                      }
                    }}
                  >
                    Unblock
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-bold text-gray-900">Help Siwu Connect grow</h2>
        <p className="text-sm text-gray-600">You're one of the first members. Invite family and friends, and tell us what to improve.</p>
        <div className="flex flex-wrap gap-2">
          <InviteButton />
          <Button variant="secondary" icon="message" onClick={() => setFeedbackOpen(true)}>
            Send feedback
          </Button>
          <Button variant="ghost" icon="towns" onClick={() => navigate('/towns')}>
            Browse towns
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-bold text-gray-900">Account</h2>
        <p className="text-sm text-gray-600">Signed in as {user.email ?? 'Google account'}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => { await signOut(); navigate('/welcome'); }}>
            Sign out
          </Button>
          <Button variant="ghost" className="text-red-700" onClick={() => setDeleteOpen(true)}>
            Delete my account
          </Button>
        </div>
        <p className="text-sm">
          <Link to="/rules" className="text-brand-800 underline">Community rules</Link> ·{' '}
          <Link to="/privacy" className="text-brand-800 underline">Privacy notice</Link>
        </p>
      </Card>

      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} username={profile.username} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}

function DeleteAccountDialog({ open, onClose, username }: { open: boolean; onClose: () => void; username: string }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setError(null);
    }
  }, [open]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/delete-account');
      await signOut().catch(() => {});
      navigate('/welcome', { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Delete your account?">
      <div className="space-y-4 text-sm text-gray-700">
        <p>
          Your profile will be removed and the text of all your posts and comments will be erased. Your username will be
          freed. This cannot be undone.
        </p>
        <TextField label={`Type ${username} to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="none" />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} disabled={confirmText.trim().toLowerCase() !== username} onClick={run}>
            Delete account
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SellerListings({ uid }: { uid: string }) {
  const q = useQuery({ queryKey: ['sellerListings', uid], queryFn: () => fetchSellerListings(uid) });
  if (!q.data?.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-base font-bold text-gray-900">For sale</h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {q.data.map((l) => (
          <li key={l.id} className="w-36 shrink-0">
            <Link to={`/market/${l.id}`} className="block overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
              {l.imageUrl ? (
                <img src={l.imageUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square items-center justify-center bg-brand-50 text-brand-300">
                  <Icon name="cart" className="h-10 w-10" />
                </div>
              )}
              <div className="p-2">
                <p className="truncate text-sm font-bold">{l.title}</p>
                <p className="text-xs font-black text-brand-700">{l.status === 'sold' ? 'SOLD' : formatPrice(l.price, l.priceUnit)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const VIBES = ['🔥', '⚽', '🎶', '📚', '🙏🏾', '💚', '😎', '🌍', '💼', '🎨', '🍲', '✨'];

function BioCard() {
  const { user, profile } = useMe();
  const toast = useToast();
  const [bio, setBio] = useState(profile.bio);
  const [vibe, setVibe] = useState(profile.vibe);
  const [busy, setBusy] = useState(false);
  if (profile.status !== 'active') return null;
  const save = async () => {
    setBusy(true);
    try {
      await updateBio(db, user.uid, bio, vibe);
      toast('Profile updated ✨');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-bold text-gray-900">Bio & vibe</h2>
      <TextField label="Bio" maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="e.g. Footballer from Todzi ⚽ · living in Accra" hint={`${bio.length}/160`} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-800">Your vibe</legend>
        <div className="flex flex-wrap gap-1.5">
          {VIBES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVibe(vibe === v ? '' : v)}
              aria-pressed={vibe === v}
              className={`h-11 w-11 rounded-full text-xl ${vibe === v ? 'bg-brand-100 ring-2 ring-brand-600' : 'bg-sand-100'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <Button onClick={save} busy={busy}>
        Save bio
      </Button>
    </Card>
  );
}
