import { useEffect, useMemo, useRef, useState } from 'react';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type Timestamp, collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { EXTRA_LIMITS, canModerate, townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { useProfileById } from '../lib/hooks';
import { deleteMessage, markChatRead, openDm, sendMessage } from '../lib/ops';
import { useFriendships } from '../lib/friends';
import { FriendActions } from '../components/FriendButton';
import { searchPeople } from '../lib/queries';
import { friendlyError, preparePhoto, timeAgo } from '../lib/util';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Menu';
import { RichText } from '../components/PostCard';
import { ReportDialog } from '../components/ReportDialog';
import { useToast } from '../components/Toast';
import { Avatar, Button, EmptyState, ErrorState, Modal, PageHeader, PageSpinner, TextField } from '../components/ui';

interface Chat {
  id: string;
  type: 'dm' | 'room';
  members: string[];
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
  status: 'sent' | 'deleted' | 'removed';
  createdAt: Date | null;
}

const toDate = (v: unknown) => (v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null);
const ROOM_ORDER = ['all', 'odomi', 'mempeasem', 'todzi', 'adokor', 'sokpo'];

function toChat(id: string, d: Record<string, unknown>): Chat {
  const lm = d.lastMessage as (Omit<NonNullable<Chat['lastMessage']>, 'at'> & { at: unknown }) | null;
  return {
    id,
    type: d.type as Chat['type'],
    members: (d.members as string[]) ?? [],
    name: d.name as string | undefined,
    townId: d.townId as string | undefined,
    lastMessage: lm ? { ...lm, at: toDate(lm.at) } : null,
    updatedAt: toDate(d.updatedAt),
  };
}

/** Live chats (rooms + my DMs) and read markers. */
export function useChats() {
  const { user } = useMe();
  const [rooms, setRooms] = useState<Chat[] | null>(null);
  const [dms, setDms] = useState<Chat[] | null>(null);
  const [reads, setReads] = useState<Record<string, Date | null>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'chats'), where('type', '==', 'room')), (s) => setRooms(s.docs.map((d) => toChat(d.id, d.data()))), setError);
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
  }, [user.uid]);
  const isUnread = (c: Chat) =>
    !!c.lastMessage && c.lastMessage.senderId !== user.uid && (!reads[c.id] || (c.updatedAt?.getTime() ?? 0) > reads[c.id]!.getTime());
  return { rooms, dms, error, isUnread };
}

function DmRow({ chat, unread }: { chat: Chat; unread: boolean }) {
  const { user } = useMe();
  const other = chat.members.find((m) => m !== user.uid) ?? user.uid;
  const { data: p } = useProfileById(other);
  return (
    <Link to={`/chat/${chat.id}`} className="flex items-center gap-3 rounded-2xl p-3 hover:bg-sand-100">
      <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={48} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${unread ? 'font-black' : 'font-semibold'} text-gray-900`}>
          {p?.displayName ?? '…'} {p?.verified && <VerifiedBadge className="h-4 w-4" />}
        </span>
        <span className={`block truncate text-sm ${unread ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
          {chat.lastMessage ? `${chat.lastMessage.senderId === user.uid ? 'You: ' : ''}${chat.lastMessage.text}` : 'Say hello 👋'}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className="text-xs text-gray-500">{chat.lastMessage ? timeAgo(chat.lastMessage.at) : ''}</span>
        {unread && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" aria-label="Unread" />}
      </span>
    </Link>
  );
}

export function ChatListPage() {
  const { user } = useMe();
  const { rooms, dms, error, isUnread } = useChats();
  const [picking, setPicking] = useState(false);
  if (error) return <ErrorState message={friendlyError(error)} />;
  if (!rooms || !dms) return <PageSpinner />;
  const sortedRooms = [...rooms].sort((a, b) => ROOM_ORDER.indexOf(a.townId ?? '') - ROOM_ORDER.indexOf(b.townId ?? ''));
  const visibleDms = dms.filter((c) => c.lastMessage || c.members.includes(user.uid));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chat"
        actions={
          <Button small icon="edit" onClick={() => setPicking(true)}>
            New message
          </Button>
        }
      />
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Town chats</h2>
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {sortedRooms.map((r) => (
            <li key={r.id} className="shrink-0">
              <NavLink
                to={`/chat/${r.id}`}
                className={`flex min-h-[64px] w-36 flex-col justify-center rounded-2xl px-3 py-2 shadow-sm ${
                  r.townId === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-gray-900 ring-1 ring-sand-200'
                }`}
              >
                <span className="flex items-center gap-1 text-sm font-bold">
                  {r.townId === 'all' ? '🌍 All Akpafu' : `🏡 ${townShortName(r.townId ?? '')}`}
                  {isUnread(r) && <span className="h-2 w-2 rounded-full bg-gold-400" />}
                </span>
                <span className={`truncate text-xs ${r.townId === 'all' ? 'text-white/80' : 'text-gray-600'}`}>
                  {r.lastMessage ? r.lastMessage.text : 'Start the conversation'}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </section>
      <FriendRequests />
      <section>
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-600">Messages</h2>
        {visibleDms.length === 0 ? (
          <EmptyState title="No private messages yet" icon="message">
            Add friends from their profile. Once they accept your request, tap <strong>New message</strong> to chat.
          </EmptyState>
        ) : (
          <ul className="rounded-2xl bg-white shadow-sm ring-1 ring-sand-200">
            {visibleDms.map((c) => (
              <li key={c.id}>
                <DmRow chat={c} unread={isUnread(c)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-center text-xs text-gray-500">
        Private messages can only be read by the two of you. Town chats are visible to all members.
      </p>
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
    <li className="flex flex-wrap items-center gap-3 p-3">
      <Link to={p ? `/u/${p.username}` : '#'} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={44} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-gray-900">{p?.displayName ?? '…'}</span>
          <span className="block text-xs text-gray-600">{incoming ? 'Wants to be friends and chat' : 'Request sent'}</span>
        </span>
      </Link>
      <span className="flex gap-1">{p && <FriendActions uid={uid} name={p.displayName} />}</span>
    </li>
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
  return (
    <Modal open={open} onClose={onClose} title="New message">
      <TextField label="Search people" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or @username" autoCapitalize="none" />
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
    return other?.displayName ?? '…';
  }, [chat, other]);

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
      await sendMessage(db, user.uid, chatId, body.slice(0, EXTRA_LIMITS.feedbackMax), imageUrl);
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
              <Avatar url={other.photoUrl} name={other.displayName} size={32} /> <span className="truncate">{other.displayName}</span> {other.verified && <VerifiedBadge className="h-4 w-4" />}
            </Link>
          ) : (
            title
          )
        }
        back
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
              showSender={chat.type === 'room' && arr[i - 1]?.senderId !== m.senderId}
              items={[
                ...(m.senderId === user.uid && m.status === 'sent'
                  ? [{ label: 'Delete message', icon: 'trash' as const, danger: true, onSelect: () => void deleteMessage(db, chatId, m.id).catch((e) => toast(friendlyError(e), 'error')) }]
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
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-sand-200 bg-white/95 px-3 py-2 backdrop-blur">
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
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={uploading ? 'Sending photo…' : 'Message'}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl bg-sand-100 px-4 py-2.5 text-base outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40"
              aria-label="Send"
            >
              <Icon name="share" className="h-5 w-5" />
            </button>
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

function Bubble({ m, mine, showSender, items }: { m: Message; mine: boolean; showSender: boolean; items: MenuItem[] }) {
  const { data: sender } = useProfileById(showSender ? m.senderId : null);
  const gone = m.status !== 'sent';
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
          {mine && !gone && items.length > 0 && <Menu items={items} label="Message actions" />}
          <div
            className={`rounded-2xl px-3 py-2 text-[15px] shadow-sm ${
              gone ? 'bg-sand-100 italic text-gray-500' : mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-gray-900 ring-1 ring-sand-200'
            }`}
          >
            {gone ? (
              m.status === 'removed' ? 'Message removed by a moderator' : 'Message deleted'
            ) : (
              <>
                {m.imageUrl && (
                  <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
                    <img src={m.imageUrl} alt="" className="mb-1 max-h-64 rounded-xl" loading="lazy" />
                  </a>
                )}
                {m.text && (mine ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : <RichText text={m.text} />)}
              </>
            )}
          </div>
          {!mine && !gone && items.length > 0 && <Menu items={items} label="Message actions" />}
        </div>
        <span className="mx-1 mt-0.5 text-[11px] text-gray-500">{m.createdAt ? m.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'sending…'}</span>
      </div>
    </div>
  );
}
