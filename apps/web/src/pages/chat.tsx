import { useEffect, useMemo, useRef, useState } from 'react';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type Timestamp, collection, doc, getCountFromServer, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { EXTRA_LIMITS, canModerate, myTowns, townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { useProfileById } from '../lib/hooks';
import { MESSAGE_REACTIONS, deleteMessage, markChatRead, openDm, reactToMessage, sendMessage, setTyping } from '../lib/ops';
import { activeLabel, isOnline } from '../lib/activity';
import { useFriendships } from '../lib/friends';
import { VoicePlayer, VoiceRecorder, canRecordVoice } from '../components/voice';
import { FriendActions } from '../components/FriendButton';
import { searchPeople } from '../lib/queries';
import { friendlyError, preparePhoto } from '../lib/util';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Menu';
import { RichText } from '../components/PostCard';
import { ReportDialog } from '../components/ReportDialog';
import { useToast } from '../components/Toast';
import { Avatar, Button, EmptyState, ErrorState, Modal, PageHeader, PageSpinner, TextField } from '../components/ui';

interface Chat {
  id: string;
  type: 'dm' | 'room' | 'group';
  members: string[];
  admins?: string[];
  name?: string;
  townId?: string;
  lastMessage: { id: string; senderId: string; text: string; at: Date | null } | null;
  updatedAt: Date | null;
}
interface Message {
  id: string;
  senderId: string;
  text: string;
  imageUrl: string | null;
  audioUrl?: string | null;
  audioSeconds?: number;
  replyTo?: { id: string; senderId: string; text: string };
  story?: { id: string; text: string; url: string | null };
  post?: { id: string; authorId: string; text: string; imageUrl: string | null };
  reactions?: Record<string, string>;
  status: 'sent' | 'deleted' | 'removed';
  createdAt: Date | null;
}

interface Presence {
  uid: string;
  typingAt: Date | null;
  readAt: Date | null;
}

const toDate = (v: unknown) => (v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null);
const ROOM_ORDER = ['all', 'odomi', 'mempeasem', 'todzi', 'adokor', 'sokpo'];

function toChat(id: string, d: Record<string, unknown>): Chat {
  const lm = d.lastMessage as (Omit<NonNullable<Chat['lastMessage']>, 'at'> & { at: unknown }) | null;
  return {
    id,
    type: d.type as Chat['type'],
    members: (d.members as string[]) ?? [],
    admins: (d.admins as string[]) ?? [],
    name: d.name as string | undefined,
    townId: d.townId as string | undefined,
    lastMessage: lm ? { ...lm, at: toDate(lm.at) } : null,
    updatedAt: toDate(d.updatedAt),
  };
}

/** Live chats (rooms + my DMs) and read markers. */
export function useChats() {
  const { user, profile, role } = useMe();
  const roomIds = ['all', ...myTowns(profile.hometownId, role)].map((t) => `room_${t}`).join(',');
  const [rooms, setRooms] = useState<Chat[] | null>(null);
  const [dms, setDms] = useState<Chat[] | null>(null);
  const [reads, setReads] = useState<Record<string, Date | null>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    // Only the rooms the member belongs to: All Akpafu and their hometown (Super Admins: every town).
    const ids = roomIds.split(',');
    const found = new Map<string, Chat>();
    const roomSubs = ids.map((id) =>
      onSnapshot(
        doc(db, 'chats', id),
        (d) => {
          if (d.exists()) found.set(id, toChat(d.id, d.data()));
          else found.delete(id);
          setRooms(ids.filter((x) => found.has(x)).map((x) => found.get(x)!));
        },
        setError,
      ),
    );
    const u1 = () => roomSubs.forEach((u) => u());
    const u2 = onSnapshot(
      query(collection(db, 'chats'), where('members', 'array-contains', user.uid), orderBy('updatedAt', 'desc'), limit(50)),
      (s) => setDms(s.docs.map((d) => toChat(d.id, d.data()))),
      setError,
    );
    const u3 = onSnapshot(collection(db, 'users', user.uid, 'chatState'), (s) =>
      setReads(Object.fromEntries(s.docs.map((d) => [d.id, toDate(d.data().lastReadAt)]))),
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, [user.uid, roomIds]);
  const isUnread = (c: Chat) =>
    !!c.lastMessage && c.lastMessage.senderId !== user.uid && (!reads[c.id] || (c.updatedAt?.getTime() ?? 0) > reads[c.id]!.getTime());
  return { rooms, dms, error, isUnread, reads };
}

/** "4:32 PM" today, "Yesterday", weekday this week, else "24 Nov". */
function chatTime(d: Date | null | undefined): string {
  if (!d) return '';
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Number of new messages since you last opened the chat (shown in a blue bubble). */
function UnreadCount({ chatId, since }: { chatId: string; since: Date | null | undefined }) {
  const q = useQuery({
    queryKey: ['unreadCount', chatId, since?.getTime() ?? 0],
    queryFn: async () => {
      const base = collection(db, 'chats', chatId, 'messages');
      const snap = await getCountFromServer(since ? query(base, where('createdAt', '>', since)) : query(base, limit(99)));
      return snap.data().count;
    },
    staleTime: 30_000,
  });
  const n = q.data ?? 0;
  return (
    <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white" aria-label={n ? `${n} unread` : 'Unread'}>
      {n ? (n > 99 ? '99+' : n) : ''}
    </span>
  );
}

function RowShell({
  to,
  avatar,
  title,
  preview,
  time,
  unread,
  chatId,
  since,
}: {
  to: string;
  avatar: React.ReactNode;
  title: React.ReactNode;
  preview: string;
  time: Date | null | undefined;
  unread: boolean;
  chatId: string;
  since: Date | null | undefined;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 pt-3 hover:bg-sand-100">
      {avatar}
      <span className="min-w-0 flex-1 border-b border-sand-200 pb-3">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[16px] ${unread ? 'font-black' : 'font-bold'} text-gray-900`}>{title}</span>
          <span className={`shrink-0 text-xs ${unread ? 'font-bold text-brand-600' : 'text-gray-500'}`}>{chatTime(time)}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`truncate text-[15px] ${unread ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{preview}</span>
          {unread && <UnreadCount chatId={chatId} since={since} />}
        </span>
      </span>
    </Link>
  );
}

function DmRow({ chat, unread, since }: { chat: Chat; unread: boolean; since: Date | null | undefined }) {
  const { user } = useMe();
  const other = chat.members.find((m) => m !== user.uid) ?? user.uid;
  const { data: p } = useProfileById(other);
  return (
    <RowShell
      to={`/chat/${chat.id}`}
      chatId={chat.id}
      since={since}
      unread={unread}
      time={chat.lastMessage?.at ?? chat.updatedAt}
      avatar={
        <span className="relative shrink-0">
          <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={54} />
          {isOnline(p?.lastActiveAt) && <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-green-500 ring-2 ring-white" aria-label="Active now" />}
        </span>
      }
      title={
        <>
          {p?.displayName ?? '…'} {p?.verified && <VerifiedBadge className="h-4 w-4" />}
        </>
      }
      preview={chat.lastMessage ? `${chat.lastMessage.senderId === user.uid ? 'You: ' : ''}${chat.lastMessage.text}` : 'Say hello 👋'}
    />
  );
}

function GroupRow({ chat, unread, since }: { chat: Chat; unread: boolean; since: Date | null | undefined }) {
  const { user } = useMe();
  const last = chat.lastMessage;
  return (
    <RowShell
      to={`/chat/${chat.id}`}
      chatId={chat.id}
      since={since}
      unread={unread}
      time={last?.at ?? chat.updatedAt}
      avatar={
        <span className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-lg font-black text-white">
          {(chat.name ?? '?').slice(0, 2).toUpperCase()}
        </span>
      }
      title={chat.name ?? 'Group'}
      preview={last ? `${last.senderId === user.uid ? 'You: ' : ''}${last.text}` : `${chat.members.length} members · say hello 👋`}
    />
  );
}

function RoomRow({ chat, unread, since }: { chat: Chat; unread: boolean; since: Date | null | undefined }) {
  const all = chat.townId === 'all';
  return (
    <RowShell
      to={`/chat/${chat.id}`}
      chatId={chat.id}
      since={since}
      unread={unread}
      time={chat.lastMessage?.at ?? null}
      avatar={
        <span className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full text-2xl ${all ? 'bg-gradient-to-br from-sky-400 to-brand-700' : 'bg-brand-600'}`}>
          {all ? '🌍' : <Icon name="towns" className="h-7 w-7 text-white" />}
        </span>
      }
      title={all ? 'All Akpafu' : `${townShortName(chat.townId ?? '')} town chat`}
      preview={chat.lastMessage ? chat.lastMessage.text : 'Start the conversation'}
    />
  );
}

type ChatFilter = 'all' | 'friends' | 'groups' | 'requests';

export function ChatListPage() {
  const { user } = useMe();
  const navigate = useNavigate();
  const { rooms, dms, error, isUnread, reads } = useChats();
  const f = useFriendships();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>('all');
  if (error) return <ErrorState message={friendlyError(error)} />;
  if (!rooms || !dms) return <PageSpinner />;
  const sortedRooms = [...rooms].sort((a, b) => ROOM_ORDER.indexOf(a.townId ?? '') - ROOM_ORDER.indexOf(b.townId ?? ''));
  const visibleDms = dms.filter((c) => c.lastMessage || c.members.includes(user.uid));
  const time = (c: Chat) => (c.lastMessage?.at ?? c.updatedAt)?.getTime() ?? 0;
  const people = visibleDms.filter((c) => c.type === 'dm');
  const groups = visibleDms.filter((c) => c.type === 'group');
  const list: Chat[] =
    filter === 'friends'
      ? people
      : filter === 'groups'
        ? [...groups.sort((a, b) => time(b) - time(a)), ...sortedRooms]
        : [...visibleDms, ...sortedRooms].sort((a, b) => time(b) - time(a));
  const chips: { id: ChatFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'friends', label: 'Friends' },
    { id: 'groups', label: 'Groups' },
    { id: 'requests', label: 'Requests', count: f.incoming.length },
  ];

  return (
    <div className="-mx-4 pb-16">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <h1 className="text-[30px] font-black tracking-tight text-gray-900">Chat</h1>
        <span className="flex items-center gap-1">
          <button onClick={() => navigate('/search?tab=people')} className="rounded-full p-2 text-gray-800 hover:bg-sand-100" aria-label="Search people">
            <Icon name="search" className="h-6 w-6" />
          </button>
          <button onClick={() => setPicking(true)} className="rounded-full p-2 text-gray-800 hover:bg-sand-100" aria-label="Write a new message">
            <Icon name="edit" className="h-6 w-6" />
          </button>
        </span>
      </div>
      <div role="tablist" aria-label="Show chats" className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {chips.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={filter === c.id}
            onClick={() => setFilter(c.id)}
            className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-semibold ${
              filter === c.id ? 'bg-brand-600 text-white shadow-sm' : 'bg-sand-100 text-gray-800 hover:bg-sand-200'
            }`}
          >
            {c.label}
            {!!c.count && <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">{c.count}</span>}
          </button>
        ))}
      </div>

      {filter === 'requests' ? (
        <div className="px-4 pt-2">
          {f.incoming.length + f.outgoing.length === 0 ? (
            <EmptyState title="No friend requests" icon="user">
              Find people with the search icon and tap <strong>Add friend</strong> on their profile.
            </EmptyState>
          ) : (
            <FriendRequests />
          )}
        </div>
      ) : (
        <>
          {f.incoming.length > 0 && (
            <div className="px-4 pt-2">
              <FriendRequests />
            </div>
          )}
          {list.length === 0 ? (
            <div className="px-4">
              <EmptyState title="No chats here yet" icon="message">
                Add friends from their profile. Once they accept, tap <strong>New Message</strong> to chat.
              </EmptyState>
            </div>
          ) : (
            <ul>
              {list.map((c) => (
                <li key={c.id}>
                  {c.type === 'room' ? (
                    <RoomRow chat={c} unread={isUnread(c)} since={reads[c.id]} />
                  ) : c.type === 'group' ? (
                    <GroupRow chat={c} unread={isUnread(c)} since={reads[c.id]} />
                  ) : (
                    <DmRow chat={c} unread={isUnread(c)} since={reads[c.id]} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="px-6 pt-4 text-center text-xs text-gray-500">Private messages can only be read by the two of you. Town chats are visible to all members.</p>

      <button
        onClick={() => setPicking(true)}
        className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-white px-6 py-3 font-bold text-brand-700 shadow-lg ring-1 ring-sand-200 sm:bottom-6"
      >
        <Icon name="message" className="h-5 w-5" /> New Message <Icon name="edit" className="h-5 w-5" />
      </button>
      <NewMessageDialog open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

/** Friend requests waiting for me (accept to start chatting) and ones I sent. */
export function FriendRequests() {
  const f = useFriendships();
  if (!f.incoming.length && !f.outgoing.length) return null;
  return (
    <section aria-label="Friend requests">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-600">
        Requests {f.incoming.length > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[11px] text-white">{f.incoming.length}</span>}
      </h2>
      <ul className="divide-y divide-sand-200 rounded-2xl bg-white shadow-sm ring-1 ring-sand-200">
        {[...f.incoming, ...f.outgoing].map((r) => (
          <RequestRow key={r.otherUid} uid={r.otherUid} incoming={r.incoming} />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({ uid, incoming }: { uid: string; incoming: boolean }) {
  const { data: p } = useProfileById(uid);
  return (
    <li className="p-3">
      <Link to={p ? `/u/${p.username}` : '#'} className="flex min-w-0 items-center gap-3">
        <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={44} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-gray-900">
            {p?.displayName ?? '…'} {p?.verified && <VerifiedBadge className="h-3.5 w-3.5" />}
          </span>
          <span className="block text-xs text-gray-600">{incoming ? 'Wants to be friends and chat' : 'Request sent'}</span>
        </span>
      </Link>
      {p && (
        <span className="mt-2 flex gap-2 pl-[56px]">
          <FriendActions uid={uid} name={p.displayName} />
        </span>
      )}
    </li>
  );
}

function GroupMenu({ chat }: { chat: Chat }) {
  const { user } = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [name, setName] = useState(chat.name ?? '');
  const admin = chat.admins?.includes(user.uid);
  const items: MenuItem[] = [
    { label: `Members (${chat.members.length})`, icon: 'towns', onSelect: () => setShowMembers(true) },
    { label: 'Add friends', icon: 'plus', onSelect: () => setAdding(true) },
    ...(admin ? [{ label: 'Rename group', icon: 'edit' as const, onSelect: () => setRenaming(true) }] : []),
    {
      label: 'Leave group',
      icon: 'back',
      danger: true,
      onSelect: () =>
        void api(`/chats/${chat.id}/leave`, { json: {} })
          .then(() => {
            toast('You left the group.');
            navigate('/chat');
          })
          .catch((e) => toast(friendlyError(e), 'error')),
    },
  ];
  return (
    <>
      <Menu items={items} label="Group options" />
      <GroupDialog open={adding} onClose={() => setAdding(false)} onDone={() => setAdding(false)} groupId={chat.id} existing={chat.members} />
      <Modal open={showMembers} onClose={() => setShowMembers(false)} title={`${chat.name ?? 'Group'} · members`}>
        <ul className="max-h-80 overflow-y-auto">
          {chat.members.map((u) => (
            <li key={u}>
              <MemberRow uid={u} admin={!!chat.admins?.includes(u)} />
            </li>
          ))}
        </ul>
      </Modal>
      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename group">
        <TextField label="Group name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              void api(`/chats/${chat.id}/rename`, { json: { name } })
                .then(() => {
                  toast('Group renamed.');
                  setRenaming(false);
                })
                .catch((e) => toast(friendlyError(e), 'error'))
            }
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}

function MemberRow({ uid, admin }: { uid: string; admin: boolean }) {
  const { data: p } = useProfileById(uid);
  return (
    <Link to={p ? `/u/${p.username}` : '#'} className="flex items-center gap-3 rounded-xl p-2 hover:bg-sand-100">
      <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={40} />
      <span className="min-w-0 flex-1 truncate font-semibold">
        {p?.displayName ?? '…'} {p?.verified && <VerifiedBadge className="h-3.5 w-3.5" />}
      </span>
      {admin && <span className="rounded-full bg-gold-100 px-2 text-xs font-bold text-gold-800">Admin</span>}
    </Link>
  );
}

function FriendPickRow({ uid, onPick, checked }: { uid: string; onPick: () => void; checked?: boolean }) {
  const { data: p } = useProfileById(uid);
  return (
    <li>
      <button onClick={onPick} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-sand-100" aria-pressed={checked}>
        <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {p?.displayName ?? '…'} {p?.verified && <VerifiedBadge className="h-3.5 w-3.5" />}
          </span>
          <span className="block text-xs text-gray-600">{p ? `@${p.username}` : ''}</span>
        </span>
        {checked !== undefined && (
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-sand-200'}`}>
            {checked && <Icon name="check" className="h-4 w-4" />}
          </span>
        )}
      </button>
    </li>
  );
}

/** Make a group with friends, or (with groupId) add more friends to a group. */
function GroupDialog({
  open,
  onClose,
  onDone,
  groupId,
  existing = [],
}: {
  open: boolean;
  onClose: () => void;
  onDone: (id: string) => void;
  groupId?: string;
  existing?: string[];
}) {
  const f = useFriendships();
  const toast = useToast();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const choices = f.friends.filter((u) => !existing.includes(u));
  const toggle = (u: string) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]));
  const save = async () => {
    setBusy(true);
    try {
      if (groupId) {
        await api(`/chats/${groupId}/members`, { json: { add: picked } });
        toast(`Added ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'}.`);
        onDone(groupId);
      } else {
        const { id } = await api<{ id: string }>('/chats/groups', { json: { name, members: picked } });
        toast('Group created 🎉');
        onDone(id);
      }
      setPicked([]);
      setName('');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={groupId ? 'Add friends' : 'New group'}>
      {!groupId && (
        <TextField label="Group name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Odomi family, Class of 2015" />
      )}
      <p className="mt-3 text-sm font-semibold text-gray-800">Choose friends ({picked.length})</p>
      {choices.length === 0 ? (
        <p className="py-4 text-sm text-gray-600">
          {f.friends.length === 0 ? 'Add friends first — you can only put friends in a group.' : 'All your friends are already in this group.'}
        </p>
      ) : (
        <ul className="mt-1 max-h-72 overflow-y-auto">
          {choices.map((u) => (
            <FriendPickRow key={u} uid={u} checked={picked.includes(u)} onPick={() => toggle(u)} />
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button busy={busy} disabled={!picked.length || (!groupId && name.trim().length < 2)} onClick={save}>
          {groupId ? 'Add' : 'Create group'}
        </Button>
      </div>
    </Modal>
  );
}

function NewMessageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, blocked } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const people = useQuery({ queryKey: ['search', 'people', term], queryFn: () => searchPeople(term), enabled: term.trim().length >= 2 });
  const f = useFriendships();
  const start = async (uid: string) => {
    try {
      const id = await openDm(db, user.uid, uid);
      onClose();
      navigate(`/chat/${id}`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  const [grouping, setGrouping] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="New message">
      <button
        onClick={() => setGrouping(true)}
        className="mb-3 flex w-full items-center gap-3 rounded-xl bg-brand-50 p-3 text-left font-semibold text-brand-800 hover:bg-brand-100"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white">
          <Icon name="towns" className="h-5 w-5" />
        </span>
        New group
      </button>
      <GroupDialog
        open={grouping}
        onClose={() => setGrouping(false)}
        onDone={(id) => {
          setGrouping(false);
          onClose();
          navigate(`/chat/${id}`);
        }}
      />
      <TextField label="Search people" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or @username" autoCapitalize="none" />
      {term.trim().length < 2 && f.friends.length > 0 && (
        <ul className="mt-3 max-h-72 overflow-y-auto" aria-label="Your friends">
          {f.friends.map((uid) => (
            <FriendPickRow key={uid} uid={uid} onPick={() => start(uid)} />
          ))}
        </ul>
      )}
      <ul className="mt-3 max-h-72 overflow-y-auto">
        {(people.data ?? [])
          .filter((p) => p.uid !== user.uid && !blocked.has(p.uid))
          .map((p) =>
            f.get(p.uid)?.status === 'accepted' ? (
              <li key={p.uid}>
                <button onClick={() => start(p.uid)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-sand-100">
                  <Avatar url={p.photoUrl} name={p.displayName} size={40} />
                  <span>
                    <span className="block font-semibold">{p.displayName}</span>
                    <span className="block text-xs text-gray-600">@{p.username} · Friend</span>
                  </span>
                </button>
              </li>
            ) : (
              <li key={p.uid} className="flex items-center gap-3 rounded-xl p-2">
                <Avatar url={p.photoUrl} name={p.displayName} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.displayName}</span>
                  <span className="block text-xs text-gray-600">@{p.username}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <FriendActions uid={p.uid} name={p.displayName} />
                </span>
              </li>
            ),
          )}
      </ul>
      <p className="mt-3 text-xs text-gray-600">
        You can message your friends. To chat with someone new, send them a friend request — once they accept, you can chat.
      </p>
    </Modal>
  );
}

export function ChatRoomPage() {
  const { chatId = '' } = useParams();
  const { user, profile, role, blocked } = useMe();
  const toast = useToast();
  const [chat, setChat] = useState<Chat | null | undefined>(undefined);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [max, setMax] = useState(60);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reporting, setReporting] = useState<Message | null>(null);
  const friends = useFriendships();
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [tick, setTick] = useState(() => Date.now());
  const lastTyping = useRef(0);
  const isRoom = chatId.startsWith('room_');

  // Typing and "seen" of the other members (private and group chats).
  useEffect(() => {
    if (isRoom) return;
    return onSnapshot(
      collection(db, 'chats', chatId, 'presence'),
      (snap) =>
        setPresence(snap.docs.map((d) => ({ uid: d.id, typingAt: toDate(d.data().typingAt), readAt: toDate(d.data().readAt) }))),
      () => setPresence([]),
    );
  }, [chatId, isRoom]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);
  // Stop "typing…" when leaving the chat.
  useEffect(
    () => () => {
      if (lastTyping.current) void setTyping(db, user.uid, chatId, false).catch(() => {});
    },
    [chatId, user.uid],
  );
  const onType = (value: string) => {
    setText(value);
    if (isRoom) return;
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      void setTyping(db, user.uid, chatId, true).catch(() => {});
    } else if (!value.trim() && lastTyping.current) {
      lastTyping.current = 0;
      void setTyping(db, user.uid, chatId, false).catch(() => {});
    }
  };
  const others = presence.filter((p) => p.uid !== user.uid);
  const typingUids = others.filter((p) => p.typingAt && tick - p.typingAt.getTime() < 6000).map((p) => p.uid);

  useEffect(() => {
    const u1 = onSnapshot(doc(db, 'chats', chatId), (s) => setChat(s.exists() ? toChat(s.id, s.data()) : null), () => setChat(null));
    const u2 = onSnapshot(
      query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(max)),
      (s) => {
        setMessages(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Message, 'id' | 'createdAt'>), createdAt: toDate(d.data().createdAt) }))
            .reverse(),
        );
      },
      () => setMessages([]),
    );
    return () => {
      u1();
      u2();
    };
  }, [chatId, max]);

  // Mark as read whenever new messages arrive while the chat is open.
  const lastId = messages?.[messages.length - 1]?.id;
  useEffect(() => {
    if (lastId) void markChatRead(db, user.uid, chatId).catch(() => {});
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lastId, chatId, user.uid]);

  const otherUid = chat?.type === 'dm' ? chat.members.find((m) => m !== user.uid) : undefined;
  const { data: other } = useProfileById(otherUid);
  const title = useMemo(() => {
    if (!chat) return 'Chat';
    if (chat.type === 'room') return chat.townId === 'all' ? '🌍 All Akpafu' : `🏡 ${chat.name ?? townShortName(chat.townId ?? '')}`;
    if (chat.type === 'group') return chat.name ?? 'Group';
    return other?.displayName ?? '…';
  }, [chat, other]);

  const lastMineId = [...(messages ?? [])].reverse().find((m) => m.senderId === user.uid && m.status === 'sent')?.id;
  if (chat === undefined || messages === null) return <PageSpinner />;
  if (chat === null) return <EmptyState title="Chat not found" icon="message" />;
  const blockedOther = !!otherUid && blocked.has(otherUid);
  const notFriends = !!otherUid && !friends.loading && friends.get(otherUid)?.status !== 'accepted';
  const canSend = profile.status === 'active' && !blockedOther && !notFriends;

  const send = async (imageUrl: string | null = null) => {
    const body = text.trim();
    if (!body && !imageUrl) return;
    setSending(true);
    if (!imageUrl) setText(''); // clear at once, like other chat apps; restored if sending fails
    try {
      const quote = replyTo ? { id: replyTo.id, senderId: replyTo.senderId, text: replyTo.text || (replyTo.audioUrl ? '🎤 Voice note' : '📷 Photo') } : null;
      setReplyTo(null);
      if (lastTyping.current) {
        lastTyping.current = 0;
        void setTyping(db, user.uid, chatId, false).catch(() => {});
      }
      await sendMessage(db, user.uid, chatId, body.slice(0, EXTRA_LIMITS.feedbackMax), imageUrl, null, { replyTo: quote });
      if (imageUrl) setText('');
    } catch (e) {
      if (!imageUrl) setText((t) => t || body);
      toast(/permission/i.test(String(e)) ? 'Slow down a little, or this person may not accept messages from you.' : friendlyError(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await preparePhoto(file, EXTRA_LIMITS.imageMaxPixels, EXTRA_LIMITS.imageMaxBytes);
      const { url } = await api<{ url: string }>('/uploads/image', { body: blob, contentType: blob.type });
      await send(url);
    } catch (e) {
      toast(e instanceof Error && !('code' in e) && !('status' in e) ? e.message : friendlyError(e), 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-11rem)] flex-col">
      <PageHeader
        title={
          chat.type === 'dm' && other ? (
            <Link to={`/u/${other.username}`} className="flex items-center gap-2">
              <span className="relative">
                <Avatar url={other.photoUrl} name={other.displayName} size={36} />
                {isOnline(other.lastActiveAt) && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 ring-2 ring-white" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1">
                  <span className="truncate">{other.displayName}</span> {other.verified && <VerifiedBadge className="h-4 w-4" />}
                </span>
                <span className="block text-xs font-normal text-gray-600">
                  {typingUids.length ? <span className="font-semibold text-brand-600">typing…</span> : (activeLabel(other.lastActiveAt) ?? '')}
                </span>
              </span>
            </Link>
          ) : chat.type === 'group' ? (
            <span className="min-w-0">
              <span className="block truncate">{title}</span>
              <span className="block text-xs font-normal text-gray-600">
                {typingUids.length ? (
                  <span className="font-semibold text-brand-600">
                    <Name uid={typingUids[0]!} me={user.uid} /> is typing…
                  </span>
                ) : (
                  `${chat.members.length} members`
                )}
              </span>
            </span>
          ) : (
            title
          )
        }
        back
        actions={chat.type === 'group' ? <GroupMenu chat={chat} /> : undefined}
      />
      {chat.type === 'room' && <p className="-mt-2 mb-2 text-xs text-gray-600">Visible to all Siwu Connect members. Be kind — the community rules apply.</p>}

      <div className="flex-1 space-y-2 pb-3">
        {messages.length >= max && (
          <div className="flex justify-center">
            <Button small variant="secondary" onClick={() => setMax((m) => m + 60)}>
              Load earlier messages
            </Button>
          </div>
        )}
        {messages.length === 0 && <p className="py-10 text-center text-sm text-gray-600">No messages yet. Say hello 👋</p>}
        {messages
          .filter((m) => !blocked.has(m.senderId))
          .map((m, i, arr) => (
            <Bubble
              key={m.id}
              m={m}
              mine={m.senderId === user.uid}
              me={user.uid}
              chatId={chatId}
              canReact={canSend}
              onReply={() => setReplyTo(m)}
              seen={
                m.senderId === user.uid && m.id === lastMineId && !isRoom && m.createdAt
                  ? others.some((p) => p.readAt && p.readAt.getTime() >= m.createdAt!.getTime())
                    ? 'Seen'
                    : 'Sent'
                  : null
              }
              showSender={chat.type !== 'dm' && arr[i - 1]?.senderId !== m.senderId}
              items={[
                ...(m.senderId === user.uid && m.status === 'sent'
                  ? [{ label: 'Delete message', icon: 'trash' as const, danger: true, onSelect: () => void deleteMessage(db, chatId, m.id, !!m.audioUrl).catch((e) => toast(friendlyError(e), 'error')) }]
                  : []),
                ...(chat.type === 'room' && m.senderId !== user.uid && m.status === 'sent'
                  ? [{ label: 'Report message', icon: 'flag' as const, onSelect: () => setReporting(m) }]
                  : []),
                ...(chat.type === 'room' && m.senderId !== user.uid && m.status === 'sent' && canModerate(role, chat.townId ?? '')
                  ? [
                      {
                        label: 'Remove (moderator)',
                        icon: 'shield' as const,
                        danger: true,
                        onSelect: () =>
                          void api(`/admin/chats/${chatId}/messages/${m.id}/remove`, { json: { note: '' } })
                            .then(() => toast('Message removed.'))
                            .catch((e) => toast(friendlyError(e), 'error')),
                      },
                    ]
                  : []),
              ]}
            />
          ))}
        {typingUids.length > 0 && <TypingBubble uids={typingUids} group={chat.type === 'group'} />}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-sand-200 bg-white/95 px-3 py-2 backdrop-blur">
        {replyTo && canSend && <ReplyPreview m={replyTo} me={user.uid} onCancel={() => setReplyTo(null)} />}
        {canSend ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="rounded-full p-2.5 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              aria-label="Send a photo"
            >
              <Icon name="camera" />
            </button>
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" aria-label="Choose photo to send" onChange={(e) => sendPhoto(e.target.files?.[0])} />
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              rows={1}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={uploading ? 'Sending photo…' : 'Message'}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl bg-sand-100 px-4 py-2.5 text-base outline-none focus:ring-2 focus:ring-brand-200"
            />
            {!text.trim() && canRecordVoice() ? (
              <VoiceRecorder
                disabled={sending || uploading}
                onError={(msg) => toast(msg, 'error')}
                onSend={(audio) => sendMessage(db, user.uid, chatId, '', null, audio)}
              />
            ) : (
              <button
                type="submit"
                disabled={sending || !text.trim()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40"
                aria-label="Send"
              >
                <Icon name="share" className="h-5 w-5" />
              </button>
            )}
          </form>
        ) : (
          <p className="py-2 text-center text-sm text-gray-600">
            {blockedOther
              ? 'You blocked this person. Unblock them in Settings to send messages.'
              : notFriends
                ? 'You are not friends any more. Send a friend request from their profile to chat again.'
                : 'You cannot send messages while suspended.'}
          </p>
        )}
      </div>

      {reporting && (
        <ReportDialog
          open
          onClose={() => setReporting(null)}
          target={{
            targetType: 'message',
            targetId: reporting.id,
            targetPath: `chats/${chatId}/messages/${reporting.id}`,
            townId: chat.townId ?? 'all',
          }}
        />
      )}
    </div>
  );
}

function SharedPost({ post, mine }: { post: NonNullable<Message['post']>; mine: boolean }) {
  const { data: author } = useProfileById(post.authorId);
  return (
    <Link to={`/p/${post.id}`} className={`mb-1.5 block w-60 max-w-full overflow-hidden rounded-xl ${mine ? 'bg-white/15' : 'bg-sand-100'}`}>
      {post.imageUrl && <img src={post.imageUrl} alt="" loading="lazy" className="h-32 w-full object-cover" />}
      <span className="block px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-xs font-bold">
          <Avatar url={author?.photoUrl} name={author?.displayName ?? '…'} size={18} /> {author?.displayName ?? '…'}
        </span>
        {post.text && <span className="mt-0.5 line-clamp-3 block text-sm opacity-90">{post.text}</span>}
        <span className="mt-1 block text-[11px] font-semibold opacity-75">📝 Tap to open the post</span>
      </span>
    </Link>
  );
}

/** Send a post into one or more chats (friends, groups or town chats), with an optional note. */
export function SendToChatDialog({
  open,
  onClose,
  post,
}: {
  open: boolean;
  onClose: () => void;
  post: { id: string; authorId: string; text: string; imageUrl: string | null };
}) {
  const { user } = useMe();
  const toast = useToast();
  const { rooms, dms } = useChats();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chats = [...(dms ?? []), ...[...(rooms ?? [])].sort((a, b) => ROOM_ORDER.indexOf(a.townId ?? '') - ROOM_ORDER.indexOf(b.townId ?? ''))];
  const send = async () => {
    setBusy(true);
    let sent = 0;
    try {
      for (const id of picked) {
        await sendMessage(db, user.uid, id, note.trim().slice(0, 500), null, null, { post });
        sent++;
        if (sent < picked.length) await new Promise((r) => setTimeout(r, 1100)); // one message per second
      }
      toast(sent === 1 ? 'Sent 💬' : `Sent to ${sent} chats 💬`);
      setPicked([]);
      setNote('');
      onClose();
    } catch (e) {
      toast(sent ? `Sent to ${sent}, then: ${friendlyError(e)}` : friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Send in chat">
      {chats.length === 0 ? (
        <p className="text-sm text-gray-600">No chats yet. Add friends from their profile to chat with them.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto" aria-label="Choose chats">
          {chats.map((c) => (
            <ChatPickRow
              key={c.id}
              chat={c}
              me={user.uid}
              checked={picked.includes(c.id)}
              onPick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
            />
          ))}
        </ul>
      )}
      <TextField label="Add a message (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-3" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button busy={busy} disabled={!picked.length} onClick={send}>
          Send{picked.length > 1 ? ` (${picked.length})` : ''}
        </Button>
      </div>
    </Modal>
  );
}

function ChatPickRow({ chat, me, checked, onPick }: { chat: Chat; me: string; checked: boolean; onPick: () => void }) {
  const other = chat.type === 'dm' ? chat.members.find((m) => m !== me) : null;
  const { data: p } = useProfileById(other);
  const name =
    chat.type === 'dm' ? (p?.displayName ?? '…') : chat.type === 'group' ? (chat.name ?? 'Group') : chat.townId === 'all' ? 'All Akpafu' : `${townShortName(chat.townId ?? '')} town chat`;
  return (
    <li>
      <button onClick={onPick} aria-pressed={checked} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-sand-100">
        {chat.type === 'dm' ? (
          <Avatar url={p?.photoUrl} name={name} size={40} />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-black text-white">
            {chat.type === 'group' ? name.slice(0, 2).toUpperCase() : chat.townId === 'all' ? '🌍' : '🏡'}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-sand-200'}`}>
          {checked && <Icon name="check" className="h-4 w-4" />}
        </span>
      </button>
    </li>
  );
}

function Name({ uid, me }: { uid: string; me: string }) {
  const { data } = useProfileById(uid === me ? null : uid);
  return <>{uid === me ? 'You' : (data?.displayName.split(' ')[0] ?? '…')}</>;
}

function TypingBubble({ uids, group }: { uids: string[]; group: boolean }) {
  const { user } = useMe();
  return (
    <div className="flex items-center gap-2 pl-10" aria-live="polite">
      <span className="flex gap-1 rounded-2xl rounded-bl-md bg-white px-3 py-2.5 shadow-sm ring-1 ring-sand-200" aria-hidden="true">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span className="text-xs text-gray-600">
        {group ? (
          <>
            <Name uid={uids[0]!} me={user.uid} />
            {uids.length > 1 ? ` and ${uids.length - 1} more are` : ' is'} typing…
          </>
        ) : (
          'typing…'
        )}
      </span>
    </div>
  );
}

function ReplyPreview({ m, me, onCancel }: { m: Message; me: string; onCancel: () => void }) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-brand-600 bg-sand-100 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-brand-700">
          Replying to <Name uid={m.senderId} me={me} />
        </span>
        <span className="block truncate text-sm text-gray-700">{m.text || (m.audioUrl ? '🎤 Voice note' : '📷 Photo')}</span>
      </span>
      <button type="button" onClick={onCancel} className="rounded-full px-2 text-lg leading-none text-gray-600" aria-label="Cancel reply">
        ×
      </button>
    </div>
  );
}

/** Long-press (or tap ⋯) actions: quick emoji reactions, reply, and the message's other actions. */
function MessageActions({
  mine,
  myReaction,
  onReact,
  onReply,
  items,
  canReact,
}: {
  mine: boolean;
  myReaction: string | null;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  items: MenuItem[];
  canReact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          // Open below when the message is near the top of the screen (the header would cover the menu).
          setBelow(e.currentTarget.getBoundingClientRect().top < 320);
          setOpen((o) => !o);
        }}
        className="rounded-full p-1.5 text-gray-400 hover:bg-sand-100 hover:text-gray-700"
        aria-label="Message actions"
        aria-expanded={open}
      >
        <Icon name="more" className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-20 w-60 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-sand-200 ${below ? 'top-full mt-1' : 'bottom-full mb-1'} ${mine ? 'left-0' : 'right-0'}`}
        >
          {canReact && (
            <div className="flex justify-between border-b border-sand-200 px-2 py-1.5">
              {MESSAGE_REACTIONS.map((r) => (
                <button
                  key={r}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onReact(myReaction === r ? null : r);
                  }}
                  className={`rounded-full p-1 text-xl transition-transform hover:scale-125 ${myReaction === r ? 'bg-brand-50' : ''}`}
                  aria-label={`React ${r}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          {canReact && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onReply();
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-900 hover:bg-sand-100"
            >
              <Icon name="back" className="h-4 w-4" /> Reply
            </button>
          )}
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold hover:bg-sand-100 ${it.danger ? 'text-red-700' : 'text-gray-900'}`}
            >
              <Icon name={it.icon} className="h-4 w-4" /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bubble({
  m,
  mine,
  me,
  chatId,
  showSender,
  items,
  onReply,
  seen,
  canReact,
}: {
  m: Message;
  mine: boolean;
  me: string;
  chatId: string;
  showSender: boolean;
  items: MenuItem[];
  onReply: () => void;
  seen: string | null;
  canReact: boolean;
}) {
  const toast = useToast();
  const { data: sender } = useProfileById(showSender ? m.senderId : null);
  const gone = m.status !== 'sent';
  const reactions = Object.entries(m.reactions ?? {});
  const counts = reactions.reduce<Record<string, number>>((acc, [, e]) => ({ ...acc, [e]: (acc[e] ?? 0) + 1 }), {});
  const myReaction = m.reactions?.[me] ?? null;
  const react = (emoji: string | null) => void reactToMessage(db, me, chatId, m.id, emoji).catch((e) => toast(friendlyError(e), 'error'));
  const actions = !gone && (
    <MessageActions mine={mine} myReaction={myReaction} onReact={react} onReply={onReply} items={items} canReact={canReact} />
  );
  return (
    <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <span className="w-8 shrink-0">{showSender && <Avatar url={sender?.photoUrl} name={sender?.displayName ?? '?'} size={32} />}</span>}
      <div className={`group max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {showSender && !mine && sender && (
          <Link to={`/u/${sender.username}`} className="mb-0.5 ml-1 text-xs font-bold text-brand-700">
            {sender.displayName} {sender.verified && <VerifiedBadge className="h-3 w-3" />}
          </Link>
        )}
        <div className="flex items-center gap-1">
          {mine && actions}
          <div
            className={`rounded-2xl px-3 py-2 text-[15px] shadow-sm ${
              gone ? 'bg-sand-100 italic text-gray-500' : mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-gray-900 ring-1 ring-sand-200'
            }`}
          >
            {gone ? (
              m.status === 'removed' ? 'Message removed by a moderator' : 'Message deleted'
            ) : (
              <>
                {m.replyTo && (
                  <div className={`mb-1.5 rounded-lg border-l-4 px-2 py-1 text-xs ${mine ? 'border-white/70 bg-white/15' : 'border-brand-600 bg-sand-100'}`}>
                    <span className="block font-bold">
                      <Name uid={m.replyTo.senderId} me={me} />
                    </span>
                    <span className="line-clamp-2 opacity-90">{m.replyTo.text}</span>
                  </div>
                )}
                {m.story && (
                  <div className={`mb-1.5 flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${mine ? 'bg-white/15' : 'bg-sand-100'}`}>
                    {m.story.url && <img src={m.story.url} alt="" className="h-10 w-8 rounded object-cover" />}
                    <span className="min-w-0">
                      <span className="block font-bold">Replied to a story</span>
                      {m.story.text && <span className="line-clamp-1 opacity-90">{m.story.text}</span>}
                    </span>
                  </div>
                )}
                {m.post && <SharedPost post={m.post} mine={mine} />}
                {m.imageUrl && (
                  <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
                    <img src={m.imageUrl} alt="" className="mb-1 max-h-64 rounded-xl" loading="lazy" />
                  </a>
                )}
                {m.audioUrl && <VoicePlayer url={m.audioUrl} seconds={m.audioSeconds} light={mine} />}
                {m.text && (mine ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : <RichText text={m.text} />)}
              </>
            )}
          </div>
          {!mine && actions}
        </div>
        {reactions.length > 0 && !gone && (
          <div className={`-mt-1.5 flex gap-1 ${mine ? 'mr-2' : 'ml-2'}`}>
            {Object.entries(counts).map(([e, n]) => (
              <button
                key={e}
                onClick={() => canReact && react(myReaction === e ? null : e)}
                className={`rounded-full bg-white px-1.5 text-sm shadow ring-1 ${myReaction === e ? 'ring-brand-400' : 'ring-sand-200'}`}
                aria-label={`${e} ${n}${myReaction === e ? ', your reaction' : ''}`}
              >
                {e}
                {n > 1 && <span className="ml-0.5 text-xs text-gray-600">{n}</span>}
              </button>
            ))}
          </div>
        )}
        <span className="mx-1 mt-0.5 text-[11px] text-gray-500">
          {m.createdAt ? m.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'sending…'}
          {seen && <span className={seen === 'Seen' ? ' font-semibold text-brand-600' : ''}> · {seen === 'Seen' ? '✓✓ Seen' : '✓ Sent'}</span>}
        </span>
      </div>
    </div>
  );
}
