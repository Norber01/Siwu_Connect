import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { EXTRA_LIMITS, MY_STICKERS_MAX, STICKERS, stickerById } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { addMySticker, removeMySticker } from '../lib/ops';
import { friendlyError, preparePhoto } from '../lib/util';
import { useCrop } from './Cropper';
import { useToast } from './Toast';

/** A sticker in a chat: small (about a big emoji), no bubble. */
export function StickerView({ id, url, size = 96 }: { id?: string | null; url?: string | null; size?: number }) {
  if (url) return <img src={url} alt="Sticker" loading="lazy" style={{ width: size, height: size }} className="rounded-2xl object-cover" />;
  const s = id ? stickerById(id) : undefined;
  if (!s) return <span className="text-4xl">😀</span>;
  return (
    <span
      role="img"
      aria-label={`Sticker: ${s.text}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]})` }}
      className="flex rotate-[-3deg] flex-col items-center justify-center gap-0.5 rounded-3xl p-1.5 text-center shadow-md ring-2 ring-white"
    >
      <span style={{ fontSize: size * 0.32 }} className="leading-none">
        {s.emoji}
      </span>
      <span style={{ fontSize: Math.max(10, size * 0.14) }} className="font-black leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">
        {s.text}
      </span>
    </span>
  );
}

export interface MySticker {
  id: string;
  url: string;
}

export function useMySticker() {
  const { user } = useMe();
  return useQuery({
    queryKey: ['myStickers', user.uid],
    queryFn: async (): Promise<MySticker[]> => {
      const snap = await getDocs(query(collection(db, 'users', user.uid, 'stickers'), orderBy('createdAt', 'desc'), limit(MY_STICKERS_MAX)));
      return snap.docs.map((d) => ({ id: d.id, url: d.data().url as string }));
    },
    staleTime: 10 * 60_000,
  });
}

/** Saves a sticker picture to My stickers (e.g. one someone sent you). */
export function useSaveSticker() {
  const { user } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const mine = useMySticker();
  return async (url: string) => {
    if ((mine.data ?? []).some((s) => s.url === url)) return toast('Already in your stickers.');
    if ((mine.data?.length ?? 0) >= MY_STICKERS_MAX) return toast(`You can keep ${MY_STICKERS_MAX} stickers. Remove one first.`, 'error');
    try {
      await addMySticker(db, user.uid, url);
      void qc.invalidateQueries({ queryKey: ['myStickers', user.uid] });
      toast('Saved to My stickers 😀');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
}

const EMOJI = '😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😇 🤗 🤔 😴 😢 😭 😡 😱 🙄 😅 🙏🏾 👏🏾 👍🏾 👌🏾 💪🏾 🙌🏾 👋🏾 ✌🏾 ❤️ 💚 💛 💙 🔥 🎉 🎂 ⚽ 🏆 🇬🇭 🌍 🏡 ☀️ 🌙 🍲 🥥 🎶 📸 ✈️ 🚗'.split(' ');

/** The panel under the 😊 button: built-in stickers, my stickers (with "add from gallery"), and emoji. */
export function StickerPicker({
  onSticker,
  onStickerUrl,
  onEmoji,
}: {
  onSticker: (id: string) => void;
  onStickerUrl: (url: string) => void;
  onEmoji: (e: string) => void;
}) {
  const { user } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const crop = useCrop();
  const mine = useMySticker();
  const [tab, setTab] = useState<'stickers' | 'mine' | 'emoji'>('stickers');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = async (picked: File | undefined) => {
    const file = picked && (await crop(picked, { shapes: ['square'], title: 'Make a sticker' }));
    if (input.current) input.current.value = '';
    if (!file) return;
    if ((mine.data?.length ?? 0) >= MY_STICKERS_MAX) {
      toast(`You can keep ${MY_STICKERS_MAX} stickers. Remove one first.`, 'error');
      return;
    }
    setAdding(true);
    try {
      // Small and light: stickers load quickly on mobile data.
      const blob = await preparePhoto(file, 320, Math.min(EXTRA_LIMITS.imageMaxBytes, 80 * 1024));
      const { url } = await api<{ url: string }>('/uploads/image', { body: blob, contentType: blob.type });
      await addMySticker(db, user.uid, url);
      await qc.invalidateQueries({ queryKey: ['myStickers', user.uid] });
      toast('Sticker added 😀 Tap it to send.');
    } catch (e) {
      toast(e instanceof Error && !('code' in e) && !('status' in e) ? e.message : friendlyError(e), 'error');
    } finally {
      setAdding(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await removeMySticker(db, user.uid, id);
      await qc.invalidateQueries({ queryKey: ['myStickers', user.uid] });
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-full px-3 py-1 text-sm font-semibold ${tab === id ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-sand-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mb-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-sand-200">
      <div role="tablist" aria-label="Stickers and emoji" className="mb-2 flex gap-1">
        {tabBtn('stickers', 'Stickers')}
        {tabBtn('mine', 'My stickers')}
        {tabBtn('emoji', 'Emoji')}
      </div>
      <div className="max-h-56 overflow-y-auto overscroll-contain">
        {tab === 'stickers' && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {STICKERS.map((s) => (
              <button key={s.id} type="button" onClick={() => onSticker(s.id)} aria-label={`Send sticker ${s.text}`} className="flex justify-center rounded-xl p-1 hover:bg-sand-100">
                <StickerView id={s.id} size={64} />
              </button>
            ))}
          </div>
        )}
        {tab === 'mine' && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={adding}
              className="flex h-[72px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-sand-300 text-xs font-semibold text-gray-600 hover:bg-sand-100 disabled:opacity-50"
            >
              <span className="text-xl">{adding ? '…' : '＋'}</span>
              {adding ? 'Adding' : 'From gallery'}
            </button>
            {(mine.data ?? []).map((s) => (
              <span key={s.id} className="relative flex justify-center">
                <button type="button" onClick={() => (editing ? undefined : onStickerUrl(s.url))} aria-label="Send my sticker" className="rounded-xl p-1 hover:bg-sand-100">
                  <StickerView url={s.url} size={64} />
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => void remove(s.id)}
                    aria-label="Remove sticker"
                    className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            <input ref={input} type="file" accept="image/*" className="sr-only" aria-label="Choose a picture for a sticker" onChange={(e) => void add(e.target.files?.[0])} />
          </div>
        )}
        {tab === 'mine' && (mine.data?.length ?? 0) > 0 && (
          <button type="button" onClick={() => setEditing((x) => !x)} className="mt-2 text-xs font-semibold text-brand-700">
            {editing ? 'Done' : 'Remove stickers'}
          </button>
        )}
        {tab === 'mine' && !mine.isPending && (mine.data?.length ?? 0) === 0 && (
          <p className="mt-2 text-xs text-gray-500">Make stickers from your photos: tap ＋, choose a picture and crop it.</p>
        )}
        {tab === 'emoji' && (
          <div className="grid grid-cols-8 gap-1">
            {EMOJI.map((e) => (
              <button key={e} type="button" onClick={() => onEmoji(e)} className="rounded-lg p-1 text-2xl hover:bg-sand-100" aria-label={`Add ${e}`}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
