import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LIMITS,
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
import { api } from '../../lib/api';
import { useProfileById } from '../../lib/hooks';
import {
  fetchAllAnnouncements,
  fetchAuditLog,
  fetchOpenReports,
  fetchProfileByUsername,
  fetchRoles,
  fetchSuspendedUsers,
  fetchTargetDoc,
} from '../../lib/queries';
import type { Report } from '../../lib/types';
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
  const superAdmin = isSuperAdmin(role);
  const showAnnouncements = role.role !== 'moderator';
  const showUsers = role.role !== 'moderator';

  const tabs = [
    { to: 'reports', label: 'Reports' },
    ...(showUsers ? [{ to: 'users', label: 'Users' }] : []),
    ...(showAnnouncements ? [{ to: 'announcements', label: 'Announcements' }] : []),
    ...(superAdmin ? [{ to: 'roles', label: 'Roles' }, { to: 'audit', label: 'Audit log' }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Admin" />
      <p className="text-sm text-gray-600">
        Signed in as <strong>{ROLE_LABELS[role.role]}</strong>
        {role.role !== 'super_admin' && <> for {role.townIds.map(townName).join(', ')}</>}. Every action here is recorded in
        the audit log.
      </p>
      <nav className="-mx-4 overflow-x-auto px-4" aria-label="Admin sections">
        <ul className="flex gap-2">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
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
        <Route index element={<Navigate to="reports" replace />} />
        <Route path="reports" element={<ReportsTab />} />
        {showUsers && <Route path="users" element={<UsersTab />} />}
        {showAnnouncements && <Route path="announcements" element={<AnnouncementsTab />} />}
        {superAdmin && <Route path="roles" element={<RolesTab />} />}
        {superAdmin && <Route path="audit" element={<AuditTab />} />}
        <Route path="*" element={<Navigate to="reports" replace />} />
      </Routes>
    </div>
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

  const authorId =
    target.data?.kind === 'post' ? target.data.post.authorId : target.data?.kind === 'comment' ? target.data.comment.authorId : target.data?.kind === 'user' ? target.data.profile.uid : null;
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
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const suspended = useQuery({ queryKey: ['admin', 'suspended'], queryFn: fetchSuspendedUsers });
  const [lookup, setLookup] = useState<string>('');
  const found = useQuery({
    queryKey: ['admin', 'lookup', lookup],
    queryFn: () => fetchProfileByUsername(lookup),
    enabled: !!lookup,
  });

  const act = async (uid: string, action: 'suspend' | 'restore') => {
    setBusy(uid);
    try {
      await api(`/admin/users/${uid}/${action}`, { json: { note: '' } });
      toast(action === 'suspend' ? 'User suspended.' : 'User restored.');
      void suspended.refetch();
      void found.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const row = (p: NonNullable<typeof found.data>) => (
    <li key={p.uid} className="flex items-center gap-3 py-2">
      <Avatar url={p.photoUrl} name={p.displayName} size={36} />
      <Link to={`/u/${p.username}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{p.displayName}</span>
        <span className="block text-xs text-gray-600">
          @{p.username} · {townName(p.hometownId)} · {p.status}
        </span>
      </Link>
      {canSuspend(role, p.hometownId) && (
        <Button
          small
          variant={p.status === 'active' ? 'danger' : 'secondary'}
          busy={busy === p.uid}
          onClick={() => act(p.uid, p.status === 'active' ? 'suspend' : 'restore')}
        >
          {p.status === 'active' ? 'Suspend' : 'Restore'}
        </Button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setLookup(name.trim().replace(/^@/, '').toLowerCase());
          }}
        >
          <TextField label="Find a user by username" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="none" />
          <Button type="submit">Find</Button>
        </form>
        {lookup && (
          <div className="mt-3">
            {found.isPending ? <PageSpinner /> : found.data ? <ul>{row(found.data)}</ul> : <p className="text-sm text-gray-600">No user @{lookup}.</p>}
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-bold text-gray-900">Suspended users</h2>
        {suspended.isPending ? (
          <PageSpinner />
        ) : suspended.isError ? (
          <ErrorState message={friendlyError(suspended.error)} onRetry={() => suspended.refetch()} />
        ) : suspended.data.length ? (
          <ul className="divide-y divide-sand-100">{suspended.data.map(row)}</ul>
        ) : (
          <p className="text-sm text-gray-600">No suspended users.</p>
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
    ...(canAnnounce(role, 'all') ? [{ id: 'all', name: 'All Akpafu (all four towns)' }] : []),
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
    const parsed = grantRoleSchema.safeParse({ username: username.replace(/^@/, ''), role, townIds: role === 'super_admin' ? [] : towns });
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
          {role !== 'super_admin' && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-800">Towns</legend>
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
            Moderators review reports and remove content in their towns.
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
                    {r.role !== 'super_admin' && ` · ${r.townIds.map(townName).join(', ')}`}
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
