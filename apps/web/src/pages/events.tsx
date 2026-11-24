import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_CATEGORIES,
  EXTRA_LIMITS,
  TOWNS,
  type TownId,
  canModerate,
  eventSchema,
  hasAdminAccess,
  isTownId,
  townShortName,
} from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { type RsvpStatus, createEvent, setEventStatus, setRsvp, updateEvent } from '../lib/ops';
import { fetchEvent, fetchMyRsvp, fetchUpcomingEvents } from '../lib/queries';
import type { CommunityEvent } from '../lib/types';
import { eventTime, friendlyError, fromLocalInput, isPermissionDenied, toLocalInput } from '../lib/util';
import { DateTile, FeedbackDialog, PhotoField } from '../components/extras';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Menu';
import { AuthorLine, RichText } from '../components/PostCard';
import { ReportDialog } from '../components/ReportDialog';
import { TownChips } from '../components/TownChips';
import { useToast } from '../components/Toast';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageSpinner,
  SelectField,
  TextArea,
  TextField,
} from '../components/ui';

const categoryLabel = (id: string) => EVENT_CATEGORIES.find((c) => c.id === id)?.label ?? 'Event';

/** Shared header for the Events & Marketplace section, like the founder's design. */
export function HubTabs() {
  const tab = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex min-h-[44px] flex-1 items-center justify-center rounded-full text-sm font-bold ${
          isActive ? 'bg-brand-600 text-white shadow-sm' : 'bg-sand-100 text-gray-800 hover:bg-sand-200'
        }`
      }
    >
      {label}
    </NavLink>
  );
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold text-gray-900">Events &amp; Marketplace</h1>
      <div className="flex gap-2">
        {tab('/events', 'Events')}
        {tab('/market', 'Marketplace')}
      </div>
    </div>
  );
}

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const town = isTownId(params.get('town')) ? params.get('town')! : 'all';
  const [category, setCategory] = useState('');
  const [asking, setAsking] = useState(false);
  const { role } = useMe();
  const staff = hasAdminAccess(role);
  const q = useQuery({
    queryKey: ['events', town],
    queryFn: () => fetchUpcomingEvents(town === 'all' ? null : town),
    staleTime: 60_000,
  });
  const events = (q.data ?? []).filter((e) => !category || e.category === category);

  return (
    <div className="space-y-3">
      <HubTabs />
      <TownChips value={town} onChange={(v) => setParams(v === 'all' ? {} : { town: v }, { replace: true })} />
      <div className="flex items-center gap-2">
        <SelectField label="Type of event" className="flex-1 [&_label]:sr-only" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All types of event</option>
          {EVENT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </SelectField>
        {staff ? (
          <Link to="/events/new" className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Add event
          </Link>
        ) : (
          <Button variant="secondary" icon="megaphone" onClick={() => setAsking(true)}>
            Request event
          </Button>
        )}
      </div>
      <FeedbackDialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Ask an admin to add your event"
        intro="Events are added by Siwu Connect admins. Tell us the event name, town, date and time, place and any details — an admin will add it."
        initialText={'Event request:\nName: \nTown: \nDate and time: \nPlace: \nDetails: '}
      />
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState title="No upcoming events" icon="calendar">
          Festivals, funerals, weddings, church programmes and meetings will appear here. Add the first one!
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.id}>
              <EventCard event={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventCard({ event }: { event: CommunityEvent }) {
  return (
    <Link to={`/events/${event.id}`} className="block overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm hover:border-brand-300">
      {event.imageUrl ? (
        <div className="relative">
          <img src={event.imageUrl} alt="" loading="lazy" className="h-44 w-full object-cover" />
          <div className="absolute right-3 top-3">
            <DateTile date={event.startsAt} compact />
          </div>
        </div>
      ) : null}
      <div className="flex gap-3 p-4">
        {!event.imageUrl && <DateTile date={event.startsAt} />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
            {categoryLabel(event.category)} · {townShortName(event.townId)}
          </p>
          <h2 className="truncate text-lg font-bold text-gray-900">{event.title}</h2>
          <p className="text-sm text-gray-600">
            {event.startsAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {event.location && ` · ${event.location}`}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-600">
              {event.goingCount} going · {event.interestedCount} interested
            </span>
            <span className="rounded-full border border-brand-600 px-3 py-1 text-xs font-bold text-brand-700">View event →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function downloadIcs(e: CommunityEvent) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const end = e.endsAt ?? new Date(e.startsAt.getTime() + 2 * 3600_000);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Siwu Connect//EN',
    'BEGIN:VEVENT',
    `UID:${e.id}@siwu-connect`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(e.startsAt)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc(e.location)}`,
    `DESCRIPTION:${esc(`${e.description}\n\n${window.location.origin}/events/${e.id}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${e.title.replace(/[^\w]+/g, '-').slice(0, 40)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { user, profile, role } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const event = await fetchEvent(eventId);
      return { event, rsvp: event ? await fetchMyRsvp(user.uid, eventId) : null };
    },
  });
  const [rsvp, setRsvpState] = useState<RsvpStatus | null>(null);
  const [counts, setCounts] = useState({ going: 0, interested: 0 });
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'delete' | 'remove'>(null);

  useEffect(() => {
    if (q.data?.event) {
      setRsvpState(q.data.rsvp);
      setCounts({ going: q.data.event.goingCount, interested: q.data.event.interestedCount });
    }
  }, [q.data]);

  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const e = q.data.event;
  if (!e || e.status === 'deleted') return <EmptyState title="This event is no longer available" icon="calendar" />;
  const mine = e.authorId === user.uid;
  const past = (e.endsAt ?? e.startsAt).getTime() < Date.now();

  const choose = async (next: RsvpStatus) => {
    const target = rsvp === next ? null : next;
    setBusy(true);
    try {
      await setRsvp(db, user.uid, e.id, rsvp, target);
      setCounts((c) => {
        const n = { ...c };
        if (rsvp) n[rsvp] -= 1;
        if (target) n[target] += 1;
        return n;
      });
      setRsvpState(target);
      void qc.invalidateQueries({ queryKey: ['events'] });
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/events/${e.id}`;
    try {
      if (navigator.share) await navigator.share({ title: e.title, text: `${e.title} — ${eventTime(e.startsAt, e.endsAt)}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied.');
      }
    } catch {
      /* closed share sheet */
    }
  };

  const run = async () => {
    try {
      if (confirm === 'remove') await api(`/admin/events/${e.id}/remove`, { json: { note: '' } });
      else await setEventStatus(db, e.id, confirm === 'cancel' ? 'cancelled' : 'deleted');
      toast(confirm === 'cancel' ? 'Event cancelled.' : 'Event removed.');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['events'] });
      if (confirm === 'cancel') void q.refetch();
      else navigate('/events');
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  };

  const items: MenuItem[] = [];
  if (mine && e.status === 'published') {
    items.push({ label: 'Edit event', icon: 'edit', onSelect: () => navigate(`/events/${e.id}/edit`) });
    items.push({ label: 'Cancel event', icon: 'ban', onSelect: () => setConfirm('cancel') });
  }
  if (mine) items.push({ label: 'Delete event', icon: 'trash', danger: true, onSelect: () => setConfirm('delete') });
  if (!mine && profile.status === 'active') items.push({ label: 'Report event', icon: 'flag', onSelect: () => setReporting(true) });
  if (!mine && e.status !== 'removed' && canModerate(role, e.townId))
    items.push({ label: 'Remove event (moderator)', icon: 'shield', danger: true, onSelect: () => setConfirm('remove') });

  return (
    <div className="space-y-4">
      <PageHeader title="Event" back actions={<Menu items={items} label="Event actions" />} />
      {e.status === 'cancelled' && <Alert kind="warning">This event has been cancelled by the organiser.</Alert>}
      {e.status === 'removed' && <Alert kind="warning">This event was removed by a moderator.</Alert>}
      <article className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
        {e.imageUrl && <img src={e.imageUrl} alt="" className="max-h-80 w-full object-cover" />}
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <DateTile date={e.startsAt} />
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{categoryLabel(e.category)}</p>
              <h1 className="text-xl font-bold text-gray-900">{e.title}</h1>
            </div>
          </div>
          <ul className="space-y-1.5 text-sm text-gray-800">
            <li className="flex gap-2">
              <Icon name="calendar" className="h-5 w-5 shrink-0 text-brand-700" /> {eventTime(e.startsAt, e.endsAt)}
            </li>
            <li className="flex gap-2">
              <Icon name="location" className="h-5 w-5 shrink-0 text-brand-700" />
              {e.location ? `${e.location}, ` : ''}Akpafu {townShortName(e.townId)}
            </li>
          </ul>
          {e.description && <RichText text={e.description} />}
          <div className="border-t border-sand-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Organised by</p>
            <AuthorLine uid={e.authorId} date={e.createdAt} />
          </div>
        </div>
        {e.status === 'published' && (
          <div className="grid grid-cols-2 gap-2 border-t border-sand-200 p-3">
            <Button
              variant={rsvp === 'going' ? 'primary' : 'secondary'}
              icon="check"
              busy={busy}
              disabled={past || profile.status !== 'active'}
              aria-pressed={rsvp === 'going'}
              onClick={() => choose('going')}
            >
              Going · {counts.going}
            </Button>
            <Button
              variant={rsvp === 'interested' ? 'primary' : 'secondary'}
              icon="star"
              busy={busy}
              disabled={past || profile.status !== 'active'}
              aria-pressed={rsvp === 'interested'}
              onClick={() => choose('interested')}
            >
              Interested · {counts.interested}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 border-t border-sand-200 p-3">
          <Button variant="ghost" icon="calendar" onClick={() => downloadIcs(e)}>
            Add to calendar
          </Button>
          <Button variant="ghost" icon="share" onClick={share}>
            Share
          </Button>
        </div>
      </article>

      <ReportDialog open={reporting} onClose={() => setReporting(false)} target={{ targetType: 'event', targetId: e.id, targetPath: `events/${e.id}`, townId: e.townId }} />
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'cancel' ? 'Cancel this event?' : confirm === 'delete' ? 'Delete this event?' : 'Remove this event?'}
      >
        <p className="text-sm text-gray-700">
          {confirm === 'cancel'
            ? 'People will see that the event is cancelled.'
            : confirm === 'delete'
              ? 'The event will disappear from Siwu Connect. This cannot be undone.'
              : 'The event will be hidden from everyone. This is recorded in the audit log.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={run}>
            {confirm === 'cancel' ? 'Cancel event' : confirm === 'delete' ? 'Delete' : 'Remove'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function EventFormPage() {
  const { eventId } = useParams();
  const editing = !!eventId;
  const { user, profile, role } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['event', eventId, 'edit'], queryFn: () => fetchEvent(eventId!), enabled: editing });

  const [townId, setTownId] = useState<TownId>(profile.hometownId as TownId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('community');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setTownId(e.townId as TownId);
    setTitle(e.title);
    setCategory(e.category);
    setStart(toLocalInput(e.startsAt));
    setEnd(toLocalInput(e.endsAt));
    setLocation(e.location);
    setDescription(e.description);
    setImageUrl(e.imageUrl);
  }, [existing.data]);

  if (profile.status !== 'active') return <EmptyState title="Unavailable while suspended" icon="ban" />;
  if (!hasAdminAccess(role))
    return (
      <EmptyState title="Events are added by admins" icon="calendar">
        Go to <Link to="/events" className="font-semibold text-brand-700 underline">Events</Link> and tap <strong>Request event</strong> to send the details to an admin.
      </EmptyState>
    );
  if (editing && existing.isPending) return <PageSpinner />;
  if (editing && (!existing.data || existing.data.authorId !== user.uid)) return <EmptyState title="You can only edit your own events" icon="ban" />;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = eventSchema.safeParse({
      townId,
      title,
      category,
      description,
      location,
      startsAt: fromLocalInput(start),
      endsAt: fromLocalInput(end),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = editing ? eventId! : await createEvent(db, user.uid, parsed.data, imageUrl);
      if (editing) await updateEvent(db, id, parsed.data, imageUrl);
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: ['event', id] });
      toast(editing ? 'Event updated.' : 'Your event is published.');
      navigate(`/events/${id}`, { replace: true });
    } catch (err) {
      setError(isPermissionDenied(err) && !editing ? 'You can add one event per minute. Please wait and try again.' : friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={editing ? 'Edit event' : 'Add an event'} back />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <TextField label="Event name" maxLength={EXTRA_LIMITS.eventTitleMax} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Akpafu Cultural Festival" />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Type" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Town" value={townId} onChange={(e) => setTownId(e.target.value as TownId)}>
            {TOWNS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortName}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Starts" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField label="Ends (optional)" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <TextField label="Place (optional)" maxLength={EXTRA_LIMITS.eventLocationMax} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Odomi Durbar Grounds" />
        <TextArea label="Details (optional)" rows={5} maxLength={EXTRA_LIMITS.eventDescriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />
        <PhotoField url={imageUrl} onChange={setImageUrl} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {editing ? 'Save changes' : 'Publish event'}
          </Button>
        </div>
      </form>
    </div>
  );
}
