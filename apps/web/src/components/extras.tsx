import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EXTRA_LIMITS, canReportSports, feedbackSchema } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { sendFeedback } from '../lib/ops';
import { fetchNewMembers } from '../lib/queries';
import { dateTile, friendlyError, preparePhoto } from '../lib/util';
import { Icon, type IconName } from './Icon';
import { useToast } from './Toast';
import { Alert, Avatar, Button, Modal, TextArea } from './ui';

/** Photo for an event or listing: resized on the phone, uploaded to the API. */
export function PhotoField({ url, onChange, label = 'Photo (optional)' }: { url: string | null; onChange: (u: string | null) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await preparePhoto(file, EXTRA_LIMITS.imageMaxPixels, EXTRA_LIMITS.imageMaxBytes);
      const res = await api<{ url: string }>('/uploads/image', { body: blob, contentType: blob.type });
      onChange(res.url);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) && !('status' in e) ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-gray-800">{label}</span>
      {url ? (
        <div className="relative overflow-hidden rounded-2xl border border-sand-200">
          <img src={url} alt="" className="max-h-72 w-full object-cover" />
          <div className="absolute bottom-2 right-2 flex gap-2">
            <Button type="button" small variant="secondary" icon="camera" busy={busy} onClick={() => input.current?.click()}>
              Change
            </Button>
            <Button type="button" small variant="secondary" onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50 text-sm font-semibold text-brand-800 hover:border-brand-400"
        >
          {busy ? <span>Uploading…</span> : <><Icon name="camera" className="h-7 w-7" /> Add a photo</>}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" className="sr-only" aria-label="Choose photo" onChange={(e) => pick(e.target.files?.[0])} />
      <p className="mt-1 text-xs text-gray-600">Photos are made smaller on your phone to save data.</p>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function DateTile({ date, compact }: { date: Date; compact?: boolean }) {
  const t = dateTile(date);
  return (
    <div className={`flex shrink-0 flex-col items-center justify-center rounded-xl bg-white text-center shadow ring-1 ring-sand-200 ${compact ? 'h-14 w-14' : 'h-16 w-16'}`}>
      <span className="text-[10px] font-bold text-brand-700">{t.day}</span>
      <span className="text-xl font-black leading-none text-gray-900">{t.date}</span>
      <span className="text-[10px] font-bold text-gray-600">{t.month}</span>
    </div>
  );
}

const crestColors: Record<string, string> = {
  odomi: 'from-brand-600 to-brand-800',
  mempeasem: 'from-blue-600 to-blue-800',
  todzi: 'from-gold-400 to-gold-600',
  adokor: 'from-red-600 to-red-800',
};

export function TeamCrest({ name, townId, size = 56 }: { name: string; townId: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-[40%] bg-gradient-to-br font-black text-white shadow ring-2 ring-white ${
        crestColors[townId ?? ''] ?? 'from-gray-500 to-gray-700'
      }`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  );
}

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useMe();
  const toast = useToast();
  const location = useLocation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = feedbackSchema.safeParse({ text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(db, user.uid, parsed.data.text, location.pathname + location.search);
      toast('Thank you! Your feedback goes straight to the Siwu Connect team.');
      setText('');
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send feedback">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-700">
          Found a problem, or have an idea? Tell us — every message is read by the team building Siwu Connect.
        </p>
        <TextArea label="Your feedback" rows={5} maxLength={EXTRA_LIMITS.feedbackMax} value={text} onChange={(e) => setText(e.target.value)} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Send feedback
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Opens the phone's share sheet with an invitation to join. */
export function InviteButton({ className = '', small }: { className?: string; small?: boolean }) {
  const toast = useToast();
  const invite = async () => {
    const url = window.location.origin;
    const text = 'Join me on Siwu Connect — news, events, sports and the marketplace for Akpafu Odomi, Mempeasem, Todzi and Adokor.';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Siwu Connect', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Invitation copied. Paste it into WhatsApp or a text message.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      toast('Could not open sharing on this device.', 'error');
    }
  };
  return (
    <Button type="button" variant="secondary" small={small} icon="share" className={className} onClick={invite}>
      Invite friends
    </Button>
  );
}

export function NewMembers() {
  const { user } = useMe();
  const q = useQuery({ queryKey: ['newMembers'], queryFn: fetchNewMembers, staleTime: 5 * 60_000 });
  const members = (q.data ?? []).filter((m) => m.uid !== user.uid);
  if (members.length < 2) return null;
  return (
    <section aria-label="New members" className="rounded-2xl border border-sand-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">👋 Welcome our newest members</h2>
        <InviteButton small />
      </div>
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        {members.map((m) => (
          <li key={m.uid} className="w-16 shrink-0 text-center">
            <Link to={`/u/${m.username}`} className="block">
              <span className="inline-block rounded-full ring-2 ring-gold-400">
                <Avatar url={m.photoUrl} name={m.displayName} size={52} />
              </span>
              <span className="mt-1 block truncate text-xs font-semibold text-gray-800">{m.displayName.split(' ')[0]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The "+" menu: choose what to create. */
export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, profile } = useMe();
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const options: { to: string; icon: IconName; title: string; text: string }[] = [
    { to: '/new', icon: 'edit', title: 'Post', text: 'News, a question or an update' },
    { to: '/events/new', icon: 'calendar', title: 'Event', text: 'Festival, funeral, wedding, meeting…' },
    { to: '/market/new', icon: 'cart', title: 'Marketplace listing', text: 'Sell an item, produce or a service' },
  ];
  if (canReportSports(role)) options.push({ to: '/sports/new', icon: 'ball', title: 'Match', text: 'Add a fixture to the Sports Centre' });
  return (
    <Modal open={open} onClose={onClose} title="Create">
      {profile.status !== 'active' ? (
        <Alert kind="warning">Your account is suspended, so you cannot create anything right now.</Alert>
      ) : (
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.to}>
              <button
                onClick={() => go(o.to)}
                className="flex w-full items-center gap-3 rounded-2xl border border-sand-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="rounded-xl bg-brand-600 p-2.5 text-white">
                  <Icon name={o.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-bold text-gray-900">{o.title}</span>
                  <span className="block text-sm text-gray-600">{o.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
