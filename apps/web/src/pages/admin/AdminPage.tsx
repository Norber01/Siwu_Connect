import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LIMITS,
  PILOT_TESTERS_PER_TOWN,
  REPORT_REASONS,
  ROLES,
  ROLE_LABELS,
  type Role,
  TOWNS,
  canAnnounce,
  canSuspend,
  grantRoleSchema,
  announcementSchema,
  isSuperAdmin,
  townName,
} from '@siwu/shared';
import { useMe } from '../../auth/AuthProvider';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { api } from '../../lib/api';
import { useProfileById } from '../../lib/hooks';
import {
  fetchAllAnnouncements,
  fetchAuditLog,
  fetchFeedback,
  fetchOpenReports,
  fetchRoles,
  countUsers,
  fetchUsersPage,
  searchPeople,
  fetchTargetDoc,
  fetchWords,
  fetchTesters,
  wordOfTheDay,
} from '../../lib/queries';
import { API_URL, auth, db } from '../../lib/firebase';
import { addWord, deleteWord } from '../../lib/ops';
import { VoicePlayer, VoiceRecorder, canRecordVoice } from '../../components/voice';
import type { Profile, Report } from '../../lib/types';
import { friendlyError, fullDate, timeAgo } from '../../lib/util';
import { RichText } from '../../components/PostCard';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  SelectField,
  TextArea,
  TextField,
} from '../../components/ui';

export function AdminPage() {
  const { role } = useMe();
  if (!role) return <EmptyState title="Admin access required" icon="shield">You don't have an admin role.</EmptyState>;
  if (role.role === 'reporter')
    return (
      <EmptyState title="You are a Sports reporter" icon="trophy">
        Add matches and post live scores in the <Link to="/sports" className="font-semibold text-brand-700 underline">Sports Centre</Link>.
      </EmptyState>
    );
  const superAdmin = isSuperAdmin(role);
  const moderatorRole = role.role === 'moderator' || role.role === 'assistant_moderator';
  const showAnnouncements = !moderatorRole;
  const showUsers = !moderatorRole;

  const tabs = [
    { to: 'reports', label: 'Reports' },
    { to: 'approvals', label: 'Approvals' },
    { to: 'words', label: 'Siwu words' },
    ...(showUsers ? [{ to: 'users', label: 'Users' }, { to: 'testers', label: 'Pilot testers' }] : []),
    ...(showAnnouncements ? [{ to: 'announcements', label: 'Announcements' }] : []),
    ...(superAdmin
      ? [
          { to: 'feedback', label: 'Feedback' },
          { to: 'roles', label: 'Roles' },
          { to: 'audit', label: 'Audit log' },
          { to: 'backups', label: 'Backups' },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Admin" />
      <p className="text-sm text-gray-600">
        Signed in as <strong>{ROLE_LABELS[role.role]}</strong>
        {role.role === 'town_admin' ? <> for {role.townIds.map(townName).join(', ')}</> : <> for all towns</>}. Every action here is recorded in
        the audit log.
      </p>
      <nav className="-mx-4 overflow-x-auto px-4" aria-label="Admin sections">
        <ul className="flex gap-2">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={`/admin/${t.to}`}
                className={({ isActive }) =>
                  `block whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${isActive ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-gray-700 ring-1 ring-sand-200'}`
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Routes>
        <Route index element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports" element={<ReportsTab />} />
        <Route path="approvals" element={<ApprovalsTab />} />
        <Route path="words" element={<WordsTab />} />
        {showUsers && <Route path="users" element={<UsersTab />} />}
        {showUsers && <Route path="testers" element={<TestersTab />} />}
        {showAnnouncements && <Route path="announcements" element={<AnnouncementsTab />} />}
        {superAdmin && <Route path="feedback" element={<FeedbackTab />} />}
        {superAdmin && <Route path="roles" element={<RolesTab />} />}
        {superAdmin && <Route path="audit" element={<AuditTab />} />}
        {superAdmin && <Route path="backups" element={<BackupsTab />} />}
        <Route path="*" element={<Navigate to="/admin/reports" replace />} />
      </Routes>
    </div>
  );
}

// ---------------- Pilot testers ----------------

function TestersTab() {
  const { role } = useMe();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'testers'], queryFn: fetchTesters });
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['admin', 'testerSearch', search.trim()], queryFn: () => searchPeople(search), enabled: search.trim().length >= 2 });
  const testers = q.data ?? [];
  const set = async (p: Profile, on: boolean) => {
    try {
      await api(`/admin/users/${p.uid}/${on ? 'tester' : 'untester'}`, { json: {} });
      toast(on ? `@${p.username} is now a pilot tester 🧪` : `@${p.username} removed from the pilot.`);
      void q.refetch();
      void found.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        Choose about {PILOT_TESTERS_PER_TOWN} people from each town to try Siwu Connect first. They get a 🧪 badge, a short
        "things to try" list on their home page, and a quick feedback button. Their feedback arrives under Feedback.
      </p>
      <Card className="p-4">
        <h2 className="mb-3 font-bold text-gray-900">Testers per town (goal: {PILOT_TESTERS_PER_TOWN})</h2>
        <ul className="space-y-2">
          {TOWNS.map((t) => {
            const n = testers.filter((p) => p.hometownId === t.id).length;
            return (
              <li key={t.id}>
                <span className="flex justify-between text-sm font-semibold">
                  <span>{t.name}</span>
                  <span className={n >= PILOT_TESTERS_PER_TOWN ? 'text-brand-700' : 'text-gray-600'}>
                    {n} / {PILOT_TESTERS_PER_TOWN} {n >= PILOT_TESTERS_PER_TOWN && '✓'}
                  </span>
                </span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-sand-200">
                  <span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-gold-400" style={{ width: `${Math.min(100, (n / PILOT_TESTERS_PER_TOWN) * 100)}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-bold text-gray-900">Add a tester</h2>
        <TextField label="Search members" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or @username" autoCapitalize="none" />
        <ul className="mt-2 divide-y divide-sand-200">
          {(found.data ?? []).map((p) => (
            <li key={p.uid} className="flex items-center gap-3 py-2">
              <Avatar url={p.photoUrl} name={p.displayName} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.displayName}</span>
                <span className="block text-xs text-gray-600">
                  @{p.username} · {townName(p.hometownId)}
                </span>
              </span>
              {p.tester ? (
                <span className="text-xs font-bold text-brand-700">🧪 Tester</span>
              ) : canSuspend(role, p.hometownId) ? (
                <Button small onClick={() => set(p, true)}>
                  Add
                </Button>
              ) : (
                <span className="text-xs text-gray-500">Not your town</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-bold text-gray-900">Pilot testers ({testers.length})</h2>
        {q.isPending ? (
          <PageSpinner />
        ) : testers.length === 0 ? (
          <p className="text-sm text-gray-600">No testers yet. Search for members above and tap Add.</p>
        ) : (
          <ul className="divide-y divide-sand-200">
            {testers.map((p) => (
              <li key={p.uid} className="flex items-center gap-3 py-2">
                <Avatar url={p.photoUrl} name={p.displayName} size={36} />
                <Link to={`/u/${p.username}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.displayName}</span>
                  <span className="block text-xs text-gray-600">{townName(p.hometownId)}</span>
                </Link>
                {canSuspend(role, p.hometownId) && (
                  <Button small variant="ghost" onClick={() => set(p, false)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------- Backups ----------------

function BackupsTab() {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api<{ items: { file: string; size: number | null; uploaded: string | null }[] }>('/admin/backups', { method: 'GET' }),
  });
  const [busy, setBusy] = useState(false);
  const backupNow = async () => {
    setBusy(true);
    try {
      const r = await api<{ documents: number; complete: boolean; note?: string }>('/admin/backups', { json: {} });
      toast(r.complete ? `Backup saved: ${r.documents} documents.` : `Saved, but incomplete: ${r.note ?? ''}`, r.complete ? 'success' : 'error');
      void q.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const download = async (file: string) => {
    try {
      const token = await auth.currentUser!.getIdToken();
      const res = await fetch(`${API_URL}/admin/backups/${file}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `siwu-connect-${file}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'error');
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        A copy of the whole database is saved automatically every night (02:23 Ghana time). The latest 14 copies are kept in your private
        Cloudflare storage. Download one to keep it safe somewhere else too.
      </p>
      <Button icon="check" busy={busy} onClick={backupNow}>
        Back up now
      </Button>
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No backups yet" icon="check">
          The first one is made tonight, or tap Back up now.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-sand-200 rounded-2xl bg-white ring-1 ring-sand-200">
          {q.data.items.map((b) => (
            <li key={b.file} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900">{b.uploaded ? fullDate(new Date(b.uploaded)) : b.file}</p>
                <p className="text-xs text-gray-600">{b.size != null ? `${Math.max(1, Math.round(b.size / 1024))} KB` : ''}</p>
              </div>
              <Button small variant="secondary" onClick={() => download(b.file)}>
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Siwu words ----------------

function WordsTab() {
  const { user } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['words'], queryFn: fetchWords });
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [example, setExample] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = wordOfTheDay(q.data ?? []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || !meaning.trim()) {
      toast('Add the word and its meaning.', 'error');
      return;
    }
    setBusy(true);
    try {
      await addWord(db, user.uid, { word, meaning, example, audioUrl });
      setWord('');
      setMeaning('');
      setExample('');
      setAudioUrl(null);
      toast('Word added ✔');
      void qc.invalidateQueries({ queryKey: ['words'] });
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Add Siwu words and proverbs. One is shown on everyone's home feed each day, in turn. Record how it is said so younger members
        and the diaspora can learn it.
      </p>
      <Card className="p-4">
        <form onSubmit={add} className="space-y-3">
          <TextField label="Siwu word or proverb" value={word} maxLength={60} onChange={(e) => setWord(e.target.value)} />
          <TextField label="Meaning in English" value={meaning} maxLength={300} onChange={(e) => setMeaning(e.target.value)} />
          <TextField label="Example sentence (optional)" value={example} maxLength={300} onChange={(e) => setExample(e.target.value)} />
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-800">Pronunciation (optional)</span>
            {audioUrl ? (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <VoicePlayer url={audioUrl} />
                </div>
                <Button type="button" small variant="ghost" onClick={() => setAudioUrl(null)}>
                  Remove
                </Button>
              </div>
            ) : canRecordVoice() ? (
              <div className="flex items-center gap-2">
                <VoiceRecorder onError={(m) => toast(m, 'error')} onSend={async (a) => setAudioUrl(a.url)} />
                <span className="text-sm text-gray-600">Tap the mic, say the word, then tap send.</span>
              </div>
            ) : (
              <p className="text-sm text-gray-600">Recording is not supported on this browser.</p>
            )}
          </div>
          <Button type="submit" busy={busy} icon="plus">
            Add word
          </Button>
        </form>
      </Card>
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No words yet" icon="comment">
          The word of the day appears on the home feed once you add the first word.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-sand-200 rounded-2xl bg-white ring-1 ring-sand-200">
          {q.data.map((w) => (
            <li key={w.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900">
                  {w.word} {today?.id === w.id && <span className="ml-1 rounded-full bg-gold-100 px-2 text-[11px] font-bold text-gold-800">Today</span>}
                </p>
                <p className="text-sm text-gray-700">{w.meaning}</p>
                {w.example && <p className="text-sm italic text-gray-600">“{w.example}”</p>}
                {w.audioUrl && <VoicePlayer url={w.audioUrl} />}
              </div>
              <Button
                small
                variant="ghost"
                onClick={async () => {
                  try {
                    await deleteWord(db, w.id);
                    void qc.invalidateQueries({ queryKey: ['words'] });
                  } catch (err) {
                    toast(friendlyError(err), 'error');
                  }
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Approvals ----------------

interface PendingItem {
  collection: 'listings' | 'directory';
  id: string;
  ownerId: string;
  townId: string;
  title: string;
  description: string;
  price: number | null;
  kind: string | null;
  category: string | null;
  imageUrl: string | null;
  createdAt: string | null;
}

function ApprovalsTab() {
  const q = useQuery({ queryKey: ['admin', 'approvals'], queryFn: () => api<{ items: PendingItem[] }>('/admin/approvals', { method: 'GET' }) });
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const items = q.data.items;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Members' marketplace listings and businesses, jobs and opportunities wait here until a moderator approves them.
      </p>
      {items.length === 0 ? (
        <EmptyState title="Nothing waiting for approval" icon="check">
          New listings from members will show up here.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <ApprovalCard key={`${it.collection}/${it.id}`} item={it} onDone={() => q.refetch()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalCard({ item, onDone }: { item: PendingItem; onDone: () => void }) {
  const { data: owner } = useProfileById(item.ownerId);
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    try {
      await api(`/admin/${item.collection}/${item.id}/${decision}`, { json: { note: note.trim() } });
      toast(decision === 'approve' ? 'Approved — it is live now.' : 'Not approved. The member has been told.');
      void qc.invalidateQueries({ queryKey: [item.collection === 'listings' ? 'listings' : 'directory'] });
      onDone();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const link = item.collection === 'listings' ? `/market/${item.id}` : `/directory/${item.id}`;
  return (
    <li>
      <Card className="space-y-3 p-4">
        <div className="flex gap-3">
          {item.imageUrl && <img src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-gold-700">
              {item.collection === 'listings' ? 'Marketplace' : (item.kind ?? 'Directory')} · {townName(item.townId)}
            </p>
            <Link to={link} className="block font-bold text-gray-900 hover:underline">
              {item.title}
            </Link>
            {item.price != null && item.collection === 'listings' && <p className="text-sm font-black text-brand-700">GH₵ {item.price}</p>}
            <p className="line-clamp-3 text-sm text-gray-700">{item.description}</p>
            <p className="mt-1 text-xs text-gray-600">
              By {owner ? <Link to={`/u/${owner.username}`} className="font-semibold underline">{owner.displayName}</Link> : '…'}
              {item.createdAt && <> · {timeAgo(new Date(item.createdAt))}</>}
            </p>
          </div>
        </div>
        <TextField label="Note to the member (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please add a clear photo" />
        <div className="flex gap-2">
          <Button className="flex-1" icon="check" busy={busy === 'approve'} disabled={!!busy} onClick={() => decide('approve')}>
            Approve
          </Button>
          <Button className="flex-1" variant="danger" icon="close" busy={busy === 'reject'} disabled={!!busy} onClick={() => decide('reject')}>
            Reject
          </Button>
        </div>
      </Card>
    </li>
  );
}

// ---------------- Reports ----------------

function ReportsTab() {
  const { role } = useMe();
  const scope = isSuperAdmin(role) ? 'all' : role!.townIds;
  const q = useQuery({ queryKey: ['admin', 'reports', scope], queryFn: () => fetchOpenReports(scope) });
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title="No open reports" icon="check">All caught up. New reports will appear here.</EmptyState>;
  return (
    <ul className="space-y-3">
      {q.data.map((r) => (
        <ReportItem key={r.id} report={r} onDone={() => q.refetch()} />
      ))}
    </ul>
  );
}

function ReportItem({ report, onDone }: { report: Report; onDone: () => void }) {
  const { role } = useMe();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const target = useQuery({ queryKey: ['admin', 'target', report.targetPath], queryFn: () => fetchTargetDoc(report.targetPath) });
  const { data: reporter } = useProfileById(report.reporterId);
  const reason = REPORT_REASONS.find((r) => r.id === report.reason)?.label ?? report.reason;

  const t = target.data;
  const authorId = !t
    ? null
    : t.kind === 'post'
      ? t.post.authorId
      : t.kind === 'comment'
        ? t.comment.authorId
        : t.kind === 'user'
          ? t.profile.uid
          : t.kind === 'event'
            ? t.event.authorId
            : t.kind === 'message'
              ? t.message.senderId
              : t.listing.sellerId;
  const { data: author } = useProfileById(authorId);
  const canSuspendAuthor = author ? canSuspend(role, author.hometownId) : false;

  const resolve = async (action: 'dismiss' | 'remove_content' | 'remove_content_and_suspend') => {
    setBusy(action);
    try {
      await api(`/admin/reports/${report.id}/resolve`, { json: { action, note } });
      toast(action === 'dismiss' ? 'Report dismissed.' : 'Action taken. Report resolved.');
      onDone();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-800">{reason}</span>
          <span className="rounded-full bg-sand-200 px-2 py-0.5 font-semibold capitalize text-gray-700">{report.targetType}</span>
          <span className="text-gray-600">{townName(report.townId)}</span>
          <span className="text-gray-600">· {timeAgo(report.createdAt)}</span>
        </div>
        <div className="rounded-xl bg-sand-50 p-3 text-sm">
          {target.isPending ? (
            <PageSpinner />
          ) : !target.data ? (
            <p className="text-gray-600">The reported item no longer exists.</p>
          ) : target.data.kind === 'user' ? (
            <p>
              Profile:{' '}
              <Link className="font-semibold underline" to={`/u/${target.data.profile.username}`}>
                {target.data.profile.displayName} (@{target.data.profile.username})
              </Link>
            </p>
          ) : target.data.kind === 'message' ? (
            <>
              <p className="mb-1 text-xs text-gray-600">
                Chat message by {author ? <Link className="underline" to={`/u/${author.username}`}>@{author.username}</Link> : 'unknown'} · status:{' '}
                {target.data.message.status}
              </p>
              <RichText text={target.data.message.text || '(no text)'} />
              <Link to={`/chat/${target.data.message.chatId}`} className="mt-1 inline-block text-xs text-brand-800 underline">
                Open chat room
              </Link>
            </>
          ) : target.data.kind === 'event' || target.data.kind === 'listing' ? (
            <>
              <p className="mb-1 text-xs text-gray-600">
                By {author ? <Link className="underline" to={`/u/${author.username}`}>@{author.username}</Link> : 'unknown'} · status:{' '}
                {target.data.kind === 'event' ? target.data.event.status : target.data.listing.status}
              </p>
              <p className="font-semibold">{target.data.kind === 'event' ? target.data.event.title : target.data.listing.title}</p>
              <RichText text={(target.data.kind === 'event' ? target.data.event.description : target.data.listing.description) || ''} />
              <Link
                to={target.data.kind === 'event' ? `/events/${target.data.event.id}` : `/market/${target.data.listing.id}`}
                className="mt-1 inline-block text-xs text-brand-800 underline"
              >
                Open {target.data.kind}
              </Link>
            </>
          ) : (
            <>
              <p className="mb-1 text-xs text-gray-600">
                By {author ? <Link className="underline" to={`/u/${author.username}`}>@{author.username}</Link> : 'unknown'} ·
                status: {target.data.kind === 'post' ? target.data.post.status : target.data.comment.status}
              </p>
              <RichText text={(target.data.kind === 'post' ? target.data.post.text : target.data.comment.text) || '(text deleted by author)'} />
              {target.data.kind === 'post' && (
                <Link to={`/p/${target.data.post.id}`} className="mt-1 inline-block text-xs text-brand-800 underline">
                  Open post
                </Link>
              )}
              {target.data.kind === 'comment' && (
                <Link to={`/p/${target.data.comment.postId}`} className="mt-1 inline-block text-xs text-brand-800 underline">
                  Open post
                </Link>
              )}
            </>
          )}
        </div>
        {report.details && (
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Reporter's note:</span> {report.details}
          </p>
        )}
        <p className="text-xs text-gray-600">Reported by {reporter ? `@${reporter.username}` : 'a member'}</p>
        <TextField label="Moderator note (optional, saved in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="flex flex-wrap gap-2">
          {report.targetType !== 'user' && (
            <Button small variant="danger" busy={busy === 'remove_content'} disabled={!!busy} onClick={() => resolve('remove_content')}>
              Remove content
            </Button>
          )}
          {canSuspendAuthor && (
            <Button small variant="danger" busy={busy === 'remove_content_and_suspend'} disabled={!!busy} onClick={() => resolve('remove_content_and_suspend')}>
              {report.targetType === 'user' ? 'Suspend user' : 'Remove & suspend author'}
            </Button>
          )}
          <Button small variant="secondary" busy={busy === 'dismiss'} disabled={!!busy} onClick={() => resolve('dismiss')}>
            Dismiss
          </Button>
        </div>
      </Card>
    </li>
  );
}

// ---------------- Users ----------------

function UsersTab() {
  const { role } = useMe();
  const toast = useToast();
  const [town, setTown] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const total = useQuery({ queryKey: ['admin', 'userCount'], queryFn: countUsers, staleTime: 60_000 });
  const list = useInfiniteQuery({
    queryKey: ['admin', 'users', town, status],
    initialPageParam: null as Awaited<ReturnType<typeof fetchUsersPage>>['cursor'],
    queryFn: ({ pageParam }) => fetchUsersPage({ townId: town || null, status: status || null }, pageParam),
    getNextPageParam: (last) => last.cursor ?? undefined,
    enabled: !search.trim(),
  });
  const found = useQuery({ queryKey: ['admin', 'userSearch', search.trim()], queryFn: () => searchPeople(search, { includeSuspended: true }), enabled: search.trim().length >= 2 });

  const act = async (uid: string, action: 'suspend' | 'restore' | 'verify' | 'unverify') => {
    setBusy(uid);
    try {
      await api(`/admin/users/${uid}/${action}`, { json: { note: '' } });
      toast(
        { suspend: 'User suspended.', restore: 'User restored.', verify: 'Account verified ✔', unverify: 'Verified badge removed.' }[action],
      );
      void list.refetch();
      void found.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const row = (p: Profile) => (
    <li key={p.uid} className="flex items-center gap-3 py-2">
      <Avatar url={p.photoUrl} name={p.displayName} size={40} />
      <Link to={`/u/${p.username}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {p.displayName} {p.verified && <VerifiedBadge className="h-4 w-4" />}
        </span>
        <span className="block truncate text-xs text-gray-600">
          @{p.username} · {townName(p.hometownId)} · joined {p.createdAt ? p.createdAt.toLocaleDateString('en-GB') : '—'}
        </span>
        {p.status === 'suspended' && <span className="mt-0.5 inline-block rounded-full bg-red-50 px-2 text-[11px] font-bold text-red-700">Suspended</span>}
      </Link>
      {canSuspend(role, p.hometownId) && (
        <Button small variant="secondary" disabled={busy === p.uid} onClick={() => act(p.uid, p.verified ? 'unverify' : 'verify')}>
          {p.verified ? 'Unverify' : 'Verify'}
        </Button>
      )}
      {canSuspend(role, p.hometownId) && (
        <Button small variant={p.status === 'active' ? 'danger' : 'secondary'} busy={busy === p.uid} onClick={() => act(p.uid, p.status === 'active' ? 'suspend' : 'restore')}>
          {p.status === 'active' ? 'Suspend' : 'Restore'}
        </Button>
      )}
    </li>
  );

  const searching = search.trim().length >= 2;
  const users = searching ? (found.data ?? []) : (list.data?.pages.flatMap((pg) => pg.items) ?? []);

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-gray-900">Members</h2>
          {total.data !== undefined && <span className="text-sm font-semibold text-brand-700">{total.data.toLocaleString('en-GB')} total</span>}
        </div>
        <TextField label="Search by name or username" type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoCapitalize="none" />
        {!searching && (
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Town" value={town} onChange={(e) => setTown(e.target.value)}>
              <option value="">All towns</option>
              {TOWNS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.shortName}
                </option>
              ))}
            </SelectField>
            <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | 'active' | 'suspended')}>
              <option value="">Everyone</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </SelectField>
          </div>
        )}
      </Card>
      <Card className="p-4">
        {(searching ? found.isPending : list.isPending) ? (
          <PageSpinner />
        ) : (searching ? found.isError : list.isError) ? (
          <ErrorState message={friendlyError(searching ? found.error : list.error)} onRetry={() => (searching ? found.refetch() : list.refetch())} />
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-600">No members match.</p>
        ) : (
          <ul className="divide-y divide-sand-100">{users.map(row)}</ul>
        )}
        {!searching && list.hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" small busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              Load more members
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- Announcements ----------------

function AnnouncementsTab() {
  const { role } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const allowedTowns = [
    ...(canAnnounce(role, 'all') ? [{ id: 'all', name: 'All Akpafu (all five towns)' }] : []),
    ...TOWNS.filter((t) => canAnnounce(role, t.id)),
  ];
  const [townId, setTownId] = useState(allowedTowns[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['admin', 'announcements'], queryFn: fetchAllAnnouncements });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = announcementSchema.safeParse({
      townId,
      title,
      body,
      pinned,
      expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message === 'String must contain at least 3 character(s)' ? 'Title must be at least 3 characters.' : parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/admin/announcements', { json: parsed.data });
      toast('Announcement published.');
      setTitle('');
      setBody('');
      setPinned(false);
      setExpires('');
      void list.refetch();
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (id: string, status: 'archived' | 'published') => {
    try {
      await api(`/admin/announcements/${id}`, { method: 'PATCH', json: { status } });
      toast(status === 'archived' ? 'Announcement archived.' : 'Announcement republished.');
      void list.refetch();
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 font-bold text-gray-900">New announcement</h2>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <SelectField label="Town" value={townId} onChange={(e) => setTownId(e.target.value)}>
            {allowedTowns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <TextField label="Title" maxLength={LIMITS.announcementTitleMax} value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextArea label="Message" rows={5} maxLength={LIMITS.announcementBodyMax} value={body} onChange={(e) => setBody(e.target.value)} />
          <TextField label="Show until (optional)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} hint="After this date it disappears from feeds." />
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-5 w-5 accent-brand-800" />
            Pin above other announcements
          </label>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy}>
            Publish announcement
          </Button>
        </form>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-bold text-gray-900">Recent announcements</h2>
        {list.isPending ? (
          <PageSpinner />
        ) : list.isError ? (
          <ErrorState message={friendlyError(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.length ? (
          <ul className="divide-y divide-sand-100">
            {list.data.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-600">
                    {a.townId === 'all' ? 'All Akpafu' : townName(a.townId)} · {timeAgo(a.createdAt)} · {a.status}
                    {a.pinned && ' · pinned'}
                    {a.expiresAt && ` · until ${a.expiresAt.toLocaleDateString('en-GB')}`}
                  </p>
                </div>
                {canAnnounce(role, a.townId) && (
                  <Button small variant="secondary" onClick={() => archive(a.id, a.status === 'published' ? 'archived' : 'published')}>
                    {a.status === 'published' ? 'Archive' : 'Republish'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">No announcements yet.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------- Roles (Super Admin) ----------------

function RolesTab() {
  const { user } = useMe();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'roles'], queryFn: fetchRoles });
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('moderator');
  const [towns, setTowns] = useState<string[]>(TOWNS.map((t) => t.id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = grantRoleSchema.safeParse({ username: username.replace(/^@/, ''), role, townIds: role === 'super_admin' || role === 'moderator' || role === 'assistant_moderator' ? [] : towns });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/admin/roles', { json: parsed.data });
      toast(`@${parsed.data.username} is now ${ROLE_LABELS[parsed.data.role]}.`);
      setUsername('');
      void list.refetch();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (uid: string) => {
    try {
      await api(`/admin/roles/${uid}`, { method: 'DELETE' });
      toast('Role removed.');
      void list.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 font-bold text-gray-900">Give someone a role</h2>
        <form onSubmit={grant} className="space-y-4" noValidate>
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" placeholder="e.g. ama_odomi" />
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </SelectField>
          {role !== 'super_admin' && role !== 'moderator' && role !== 'assistant_moderator' && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-800">
                Towns{role === 'reporter' && ' (the reporter covers matches involving these towns; leave empty for all towns)'}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {TOWNS.map((t) => (
                  <label key={t.id} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-sand-200 bg-white px-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-800"
                      checked={towns.includes(t.id)}
                      onChange={(e) => setTowns((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <p className="text-xs text-gray-600">
            Super Admins can do everything in all towns. Town Admins moderate, announce, pin and suspend in their towns.
            There is one Moderator and one Assistant moderator: both review reports, remove content and approve listings in all towns. Sports reporters add matches and live scores — for their towns, or for all towns if none are chosen.
          </p>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy}>
            Save role
          </Button>
        </form>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-bold text-gray-900">Current admins</h2>
        {list.isPending ? (
          <PageSpinner />
        ) : list.isError ? (
          <ErrorState message={friendlyError(list.error)} onRetry={() => list.refetch()} />
        ) : (
          <ul className="divide-y divide-sand-100">
            {list.data.map((r) => (
              <li key={r.uid} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <span className="font-semibold">{r.username ? `@${r.username}` : r.uid}</span>
                  {r.uid === user.uid && <span className="text-gray-600"> (you)</span>}
                  <span className="block text-xs text-gray-600">
                    {ROLE_LABELS[r.role]}
                    {r.townIds.length > 0 && (r.role === 'town_admin' || r.role === 'reporter') ? ` · ${r.townIds.map(townName).join(', ')}` : ' · all towns'}
                  </span>
                </div>
                <Button small variant="ghost" className="text-red-700" onClick={() => revoke(r.uid)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------- Audit log (Super Admin) ----------------

function AuditActor({ uid }: { uid: string }) {
  const { data } = useProfileById(uid);
  return <>{data ? `@${data.username}` : uid.slice(0, 8)}</>;
}

function AuditTab() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: fetchAuditLog });
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title="No admin actions yet" icon="shield" />;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-sand-100">
        {q.data.map((e) => (
          <li key={e.id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand-900">{e.action}</span>
              <time className="text-xs text-gray-600" dateTime={e.at?.toISOString()}>
                {fullDate(e.at)}
              </time>
            </div>
            <p className="mt-1 text-gray-700">
              By <AuditActor uid={e.actorId} /> · {e.targetPath}
              {typeof e.details.note === 'string' && e.details.note && <> · “{e.details.note}”</>}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------- Tester feedback (Super Admin) ----------------

function FeedbackTab() {
  const q = useQuery({ queryKey: ['admin', 'feedback'], queryFn: fetchFeedback });
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title="No feedback yet" icon="message">Testers can send feedback from the “Beta” badge or Settings.</EmptyState>;
  return (
    <ul className="space-y-2">
      {q.data.map((f) => (
        <li key={f.id}>
          <Card className="p-4">
            <p className="text-xs text-gray-600">
              <AuditActor uid={f.userId} /> · {fullDate(f.createdAt)} · on <span className="font-mono">{f.page || '/'}</span>
            </p>
            <div className="mt-1">
              <RichText text={f.text} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
