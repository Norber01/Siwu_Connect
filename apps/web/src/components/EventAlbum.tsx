import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EXTRA_LIMITS, canModerate } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { addEventPhoto, takeDownEventPhoto } from '../lib/ops';
import { fetchEventPhotos } from '../lib/queries';
import { friendlyError, preparePhoto } from '../lib/util';
import { Icon } from './Icon';
import { Lightbox } from './media';
import { useToast } from './Toast';
import { Button } from './ui';

/** Shared photo album for an event: everyone who was there can add their photos. */
export function EventAlbum({ eventId, townId, canAdd }: { eventId: string; townId: string; canAdd: boolean }) {
  const { user, role, profile } = useMe();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['eventPhotos', eventId], queryFn: () => fetchEventPhotos(eventId) });
  const [open, setOpen] = useState<number | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const photos = q.data ?? [];

  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])].slice(0, 10);
    if (!list.length) return;
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(`Adding photo ${i + 1} of ${list.length}…`);
        const big = await preparePhoto(list[i]!, EXTRA_LIMITS.imageMaxPixels, EXTRA_LIMITS.imageMaxBytes);
        const { url } = await api<{ url: string }>('/uploads/image', { body: big, contentType: big.type });
        const small = await preparePhoto(list[i]!, 480, 60 * 1024).catch(() => null);
        const thumb = small ? await api<{ url: string }>('/uploads/image', { body: small, contentType: small.type }).catch(() => null) : null;
        await addEventPhoto(db, user.uid, eventId, url, thumb?.url ?? null);
        if (i < list.length - 1) await new Promise((r) => setTimeout(r, 2100)); // the rules allow one photo every 2 seconds
      }
      toast(list.length === 1 ? 'Photo added 📸' : `${list.length} photos added 📸`);
    } catch (e) {
      toast(e instanceof Error && !('code' in e) && !('status' in e) ? e.message : friendlyError(e), 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
      void q.refetch();
    }
  };

  const takeDown = async (id: string, authorId: string) => {
    try {
      await takeDownEventPhoto(db, eventId, id, authorId === user.uid ? 'deleted' : 'removed');
      setOpen(null);
      toast('Photo taken down.');
      void q.refetch();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <section aria-label="Photo album" className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-gray-900">📸 Photos {photos.length > 0 && <span className="text-sm font-normal text-gray-600">· {photos.length}</span>}</h2>
        {canAdd && profile.status === 'active' && (
          <Button small variant="secondary" icon="camera" busy={!!progress} onClick={() => input.current?.click()}>
            Add photos
          </Button>
        )}
        <input ref={input} type="file" accept="image/*" multiple className="sr-only" aria-label="Choose event photos" onChange={(e) => add(e.target.files)} />
      </div>
      {progress && <p className="mb-2 text-sm text-brand-700">{progress}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-gray-600">No photos yet. Were you there? Add yours so everyone can enjoy them.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button onClick={() => setOpen(i)} className="block aspect-square w-full overflow-hidden rounded-lg bg-sand-100" aria-label={`Open photo ${i + 1}`}>
                <img src={p.thumbUrl ?? p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null && photos[open] && (
        <>
          <Lightbox images={photos.map((p) => p.url)} start={open} onClose={() => setOpen(null)} />
          {(photos[open]!.authorId === user.uid || canModerate(role, townId)) && (
            <button
              onClick={() => takeDown(photos[open]!.id, photos[open]!.authorId)}
              className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-red-700 shadow"
            >
              <Icon name="trash" className="mr-1 inline h-4 w-4" /> {photos[open]!.authorId === user.uid ? 'Delete my photo' : 'Remove photo (moderator)'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
