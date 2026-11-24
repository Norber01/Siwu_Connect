import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Timestamp, collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { EXTRA_LIMITS, TOWNS, canModerate, isTownId, townName, townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { type EntryInput, type EntryKind, saveEntry, setEntryStatus } from '../lib/ops';
import { fetchTownActivity, fetchTrendingTags } from '../lib/queries';
import { friendlyError, fromLocalInput, isPermissionDenied, toLocalInput, whatsappLink } from '../lib/util';
import { PhotoField } from '../components/extras';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Menu';
import { AuthorLine, RichText } from '../components/PostCard';
import { ReportDialog } from '../components/ReportDialog';
import { TownChips } from '../components/TownChips';
import { useToast } from '../components/Toast';
import { Alert, Button, Card, EmptyState, ErrorState, Modal, PageHeader, PageSpinner, SelectField, TextArea, TextField } from '../components/ui';

// ---------------- Explore ----------------

const MEDALS = ['🥇', '🥈', '🥉', '4', '5'];

export function ExplorePage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const trending = useQuery({ queryKey: ['trending'], queryFn: fetchTrendingTags, staleTime: 10 * 60_000 });
  const towns = useQuery({ queryKey: ['townActivity'], queryFn: fetchTownActivity, staleTime: 10 * 60_000 });
  const board = [...(towns.data ?? [])].sort((a, b) => b.posts - a.posts || b.members - a.members);
  const top = board[0]?.posts ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Explore" />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (term.trim()) navigate(`/search?q=${encodeURIComponent(term.trim())}`);
        }}
        className="flex gap-2"
      >
        <TextField label="Search" className="flex-1 [&_label]:sr-only" type="search" placeholder="Search posts and people" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Button type="submit" icon="search" aria-label="Search" />
      </form>

      <Card className="p-4">
        <h2 className="mb-2 font-bold text-gray-900">🔥 Trending in Akpafu</h2>
        {trending.isPending ? (
          <PageSpinner />
        ) : (trending.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">No trending topics yet. Use #hashtags in your posts to start one!</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {trending.data!.map((t) => (
              <li key={t.tag}>
                <Link to={`/tag/${t.tag}`} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-800 hover:bg-brand-100">
                  #{t.tag} <span className="text-xs font-semibold text-brand-600">{t.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-bold text-gray-900">🏆 Town spirit this week</h2>
        <p className="mb-3 text-xs text-gray-600">Which town posts the most? Get your town to the top!</p>
        {towns.isPending ? (
          <PageSpinner />
        ) : towns.isError ? (
          <ErrorState message={friendlyError(towns.error)} />
        ) : (
          <ol className="space-y-2">
            {board.map((t, i) => (
              <li key={t.townId}>
                <Link to={`/towns/${t.townId}`} className="flex items-center gap-3">
                  <span className="w-7 text-center text-xl">{MEDALS[i]}</span>
                  <span className="flex-1">
                    <span className="flex justify-between text-sm font-semibold">
                      <span>{townName(t.townId)}</span>
                      <span className="tabular-nums text-gray-600">
                        {t.posts} posts · {t.members} members
                      </span>
                    </span>
                    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-sand-200">
                      <span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-gold-400" style={{ width: `${top ? (t.posts / top) * 100 : 0}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ['business', '🏪', 'Businesses', 'Shops, food, services'],
            ['job', '💼', 'Jobs', 'Work near home and away'],
            ['scholarship', '🎓', 'Scholarships', 'Study opportunities'],
            ['training', '🛠️', 'Training', 'Apprenticeships & courses'],
          ] as const
        ).map(([kind, emoji, title, text]) => (
          <Link key={kind} to={`/directory?kind=${kind}`} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200 hover:ring-brand-300">
            <span className="text-3xl">{emoji}</span>
            <span className="mt-1 block font-bold text-gray-900">{title}</span>
            <span className="block text-xs text-gray-600">{text}</span>
          </Link>
        ))}
      </div>
      <Link to="/towns" className="block text-center text-sm font-semibold text-brand-700 underline">
        Browse the five towns
      </Link>
    </div>
  );
}

// ---------------- Directory: businesses & opportunities ----------------

interface Entry extends EntryInput {
  id: string;
  ownerId: string;
  imageUrl: string | null;
  status: 'active' | 'closed' | 'deleted' | 'removed';
  createdAt: Date | null;
}
const toDate = (v: unknown) => (v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null);
const toEntry = (id: string, d: Record<string, unknown>): Entry => ({
  ...(d as unknown as Entry),
  id,
  deadline: toDate(d.deadline),
  createdAt: toDate(d.createdAt),
});

const KINDS: Record<EntryKind, { title: string; emoji: string; one: string; categoryHint: string }> = {
  business: { title: 'Businesses', emoji: '🏪', one: 'business', categoryHint: 'e.g. Food, Tailoring, Phone repairs' },
  job: { title: 'Jobs', emoji: '💼', one: 'job', categoryHint: 'e.g. Teaching, Farming, Driving' },
  scholarship: { title: 'Scholarships', emoji: '🎓', one: 'scholarship', categoryHint: 'e.g. SHS, University, Abroad' },
  training: { title: 'Training', emoji: '🛠️', one: 'training', categoryHint: 'e.g. Apprenticeship, IT course' },
};

export function DirectoryPage() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as EntryKind) in KINDS ? (params.get('kind') as EntryKind) : 'business';
  const town = isTownId(params.get('town')) ? params.get('town')! : 'all';
  const q = useQuery({
    queryKey: ['directory', kind, town],
    queryFn: async () => {
      const c = [where('kind', '==', kind), ...(town !== 'all' ? [where('townId', '==', town)] : []), where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(60)];
      return (await getDocs(query(collection(db, 'directory'), ...c))).docs.map((d) => toEntry(d.id, d.data()));
    },
  });
  const k = KINDS[kind];
  return (
    <div className="space-y-3">
      <PageHeader
        title={`${k.emoji} ${k.title}`}
        back
        actions={
          <Link to={`/directory/new?kind=${kind}`} className="inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white">
            <Icon name="plus" className="h-4 w-4" /> Add
          </Link>
        }
      />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {(Object.keys(KINDS) as EntryKind[]).map((x) => (
          <button
            key={x}
            onClick={() => setParams({ kind: x, ...(town !== 'all' ? { town } : {}) }, { replace: true })}
            className={`min-h-[36px] shrink-0 rounded-full px-3 text-sm font-semibold ${x === kind ? 'bg-gold-400 text-[#0d4a1e]' : 'bg-white text-gray-700 ring-1 ring-sand-200'}`}
          >
            {KINDS[x].emoji} {KINDS[x].title}
          </button>
        ))}
      </div>
      <TownChips value={town} onChange={(v) => setParams({ kind, ...(v !== 'all' ? { town: v } : {}) }, { replace: true })} />
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title={`No ${k.title.toLowerCase()} listed yet`} icon="search">
          Be the first: tap <strong>Add</strong>.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {q.data.map((e) => (
            <li key={e.id}>
              <Link to={`/directory/${e.id}`} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-sand-200 hover:ring-brand-300">
                {e.imageUrl ? (
                  <img src={e.imageUrl} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-3xl">{k.emoji}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-gray-900">{e.title}</span>
                  <span className="block text-xs font-semibold text-brand-700">
                    {e.category || k.one} · {townShortName(e.townId)}
                  </span>
                  {e.deadline && <span className="block text-xs text-red-700">Deadline {e.deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  <span className="line-clamp-1 text-sm text-gray-600">{e.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EntryDetailPage() {
  const { entryId = '' } = useParams();
  const { user, role, profile } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['entry', entryId], queryFn: async () => {
    const s = await getDoc(doc(db, 'directory', entryId));
    return s.exists() ? toEntry(s.id, s.data()) : null;
  } });
  const [reporting, setReporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'remove'>(null);
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} />;
  const e = q.data;
  if (!e || e.status === 'deleted') return <EmptyState title="This listing is no longer available" icon="search" />;
  const mine = e.ownerId === user.uid;
  const k = KINDS[e.kind];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['directory'] });
    void q.refetch();
  };
  const items: MenuItem[] = [];
  if (mine && e.status !== 'removed') {
    items.push({ label: 'Edit', icon: 'edit', onSelect: () => navigate(`/directory/${e.id}/edit`) });
    items.push({
      label: e.status === 'closed' ? 'Reopen' : e.kind === 'business' ? 'Mark as closed' : 'Mark as filled / closed',
      icon: 'check',
      onSelect: () => void setEntryStatus(db, e.id, e.status === 'closed' ? 'active' : 'closed').then(refresh).catch((x) => toast(friendlyError(x), 'error')),
    });
  }
  if (mine) items.push({ label: 'Delete', icon: 'trash', danger: true, onSelect: () => setConfirm('delete') });
  if (!mine && profile.status === 'active') items.push({ label: 'Report', icon: 'flag', onSelect: () => setReporting(true) });
  if (!mine && e.status !== 'removed' && canModerate(role, e.townId)) items.push({ label: 'Remove (moderator)', icon: 'shield', danger: true, onSelect: () => setConfirm('remove') });

  const run = async () => {
    try {
      if (confirm === 'remove') await api(`/admin/directory/${e.id}/remove`, { json: { note: '' } });
      else await setEntryStatus(db, e.id, 'deleted');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['directory'] });
      navigate(`/directory?kind=${e.kind}`);
    } catch (x) {
      toast(friendlyError(x), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={`${k.emoji} ${k.title}`} back actions={<Menu items={items} label="Actions" />} />
      {e.status === 'closed' && <Alert kind="warning">{e.kind === 'business' ? 'This business is marked as closed.' : 'This opportunity is closed.'}</Alert>}
      <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-sand-200">
        {e.imageUrl && <img src={e.imageUrl} alt="" className="max-h-72 w-full object-cover" />}
        <div className="space-y-3 p-4">
          <div>
            <p className="text-xs font-bold uppercase text-brand-700">
              {e.category || k.one} · Akpafu {townShortName(e.townId)}
            </p>
            <h1 className="text-xl font-bold text-gray-900">{e.title}</h1>
            {e.deadline && <p className="text-sm font-semibold text-red-700">Deadline: {e.deadline.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          </div>
          {e.description && <RichText text={e.description} />}
          <div className="border-t border-sand-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-600">Listed by</p>
            <AuthorLine uid={e.ownerId} date={e.createdAt} />
          </div>
        </div>
        {(e.contactPhone || e.link) && (
          <div className="grid gap-2 border-t border-sand-200 p-3 sm:grid-cols-2">
            {e.contactPhone && (
              <>
                <a href={whatsappLink(e.contactPhone, `Hello, I saw "${e.title}" on Siwu Connect.`)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-600 font-bold text-white">
                  <Icon name="message" /> WhatsApp
                </a>
                <a href={`tel:${e.contactPhone}`} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-brand-600 font-bold text-brand-700">
                  <Icon name="phone" /> Call
                </a>
              </>
            )}
            {e.link && (
              <a href={e.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-sand-200 font-bold text-gray-800 sm:col-span-2">
                <Icon name="globe" /> {e.kind === 'business' ? 'Website' : 'How to apply'}
              </a>
            )}
          </div>
        )}
      </article>
      {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ targetType: 'directory', targetId: e.id, targetPath: `directory/${e.id}`, townId: e.townId }} />}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'delete' ? 'Delete this listing?' : 'Remove this listing?'}>
        <p className="text-sm text-gray-700">{confirm === 'delete' ? 'It will disappear from Siwu Connect.' : 'It will be hidden from everyone. This is recorded in the audit log.'}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={run}>
            {confirm === 'delete' ? 'Delete' : 'Remove'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function EntryFormPage() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const { user, profile } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const editing = !!entryId;
  const existing = useQuery({
    queryKey: ['entry', entryId, 'edit'],
    queryFn: async () => {
      const s = await getDoc(doc(db, 'directory', entryId!));
      return s.exists() ? toEntry(s.id, s.data()) : null;
    },
    enabled: editing,
  });
  const [kind, setKind] = useState<EntryKind>((params.get('kind') as EntryKind) in KINDS ? (params.get('kind') as EntryKind) : 'business');
  const [townId, setTownId] = useState(profile.hometownId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [link, setLink] = useState('');
  const [deadline, setDeadline] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setKind(e.kind);
    setTownId(e.townId);
    setTitle(e.title);
    setCategory(e.category);
    setDescription(e.description);
    setPhone(e.contactPhone ?? '');
    setLink(e.link ?? '');
    setDeadline(toLocalInput(e.deadline).slice(0, 10));
    setImageUrl(e.imageUrl);
  }, [existing.data]);

  if (editing && existing.isPending) return <PageSpinner />;
  const k = KINDS[kind];

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const cleanPhone = phone.replace(/[\s()-]/g, '');
    if (title.trim().length < 3) return setError('Add a title (at least 3 characters).');
    if (cleanPhone && !/^\+?[0-9]{9,15}$/.test(cleanPhone)) return setError('Enter a phone number with country code, e.g. +233241234567');
    if (link.trim() && !/^https:\/\/.+/.test(link.trim())) return setError('Links must start with https://');
    setBusy(true);
    setError(null);
    try {
      const id = await saveEntry(
        db,
        user.uid,
        {
          kind,
          townId,
          title: title.trim().slice(0, 100),
          description: description.trim().slice(0, 1500),
          category: category.trim().slice(0, 40),
          contactPhone: cleanPhone || null,
          link: link.trim() || null,
          deadline: deadline ? fromLocalInput(`${deadline}T23:59`) : null,
        },
        imageUrl,
        entryId,
      );
      void qc.invalidateQueries({ queryKey: ['directory'] });
      void qc.invalidateQueries({ queryKey: ['entry', id] });
      toast(editing ? 'Saved.' : 'Listed! 🎉');
      navigate(`/directory/${id}`, { replace: true });
    } catch (x) {
      setError(isPermissionDenied(x) && !editing ? 'You can add one listing per minute. Please wait and try again.' : friendlyError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={editing ? 'Edit listing' : `Add ${k.one}`} back />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!editing && (
          <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>
            {(Object.keys(KINDS) as EntryKind[]).map((x) => (
              <option key={x} value={x}>
                {KINDS[x].emoji} {KINDS[x].one[0]!.toUpperCase() + KINDS[x].one.slice(1)}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label={kind === 'business' ? 'Business name' : 'Title'} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Category" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} placeholder={k.categoryHint} />
          <SelectField label="Town" value={townId} onChange={(e) => setTownId(e.target.value)}>
            {TOWNS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortName}
              </option>
            ))}
          </SelectField>
        </div>
        <TextArea label={kind === 'business' ? 'What you offer, opening hours, location' : 'Details and requirements'} rows={5} maxLength={EXTRA_LIMITS.listingDescriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />
        {kind !== 'business' && <TextField label="Deadline (optional)" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
        <TextField label="Phone / WhatsApp (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 24 123 4567" hint="Visible to signed-in members." />
        <TextField label={kind === 'business' ? 'Website (optional)' : 'Link to apply (optional)'} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        <PhotoField url={imageUrl} onChange={setImageUrl} label="Photo or logo (optional)" />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {editing ? 'Save' : 'Publish'}
          </Button>
        </div>
      </form>
    </div>
  );
}
