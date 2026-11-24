import { useCallback, useEffect, useRef, useState } from 'react';
import { EXTRA_LIMITS } from '@siwu/shared';
import { ApiError } from '../lib/errors';
import { API_URL, auth } from '../lib/firebase';
import type { MediaItem } from '../lib/ops';
import { friendlyError, preparePhoto } from '../lib/util';
import { Icon } from './Icon';

// ---------------- uploading ----------------

/** Uploads with a progress callback (fetch cannot report upload progress). */
export function uploadWithProgress(path: string, blob: Blob, onProgress: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const user = auth.currentUser;
      if (!user) return reject(new ApiError(401, 'Please sign in again.'));
      const token = await user.getIdToken();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}${path}`);
      xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.setRequestHeader('content-type', blob.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'));
      xhr.onload = () => {
        let body: { url?: string; error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
        else reject(new ApiError(xhr.status, body.error ?? 'Upload failed. Please try again.'));
      };
      xhr.send(blob);
    })();
  });
}

const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'video/mp4', 'video/quicktime': 'video/quicktime', 'video/webm': 'video/webm' };

/** Reads a video's length and grabs a preview frame (shown before the video is played, saving data). */
export function inspectVideo(file: File): Promise<{ duration: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    let duration = 0;
    const done = (poster: Blob | null) => {
      URL.revokeObjectURL(url);
      resolve({ duration, poster });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This video could not be read. Try an MP4 video.'));
    };
    v.onloadedmetadata = () => {
      duration = v.duration;
      v.currentTime = Math.min(1, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(v.videoWidth * scale));
        c.height = Math.max(1, Math.round(v.videoHeight * scale));
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => done(b), 'image/webp', 0.75);
      } catch {
        done(null);
      }
    };
    setTimeout(() => done(null), 8000); // some phones never fire "seeked" for metadata-only loads
  });
}

interface Pending {
  id: string;
  type: 'image' | 'video';
  preview: string;
  progress: number;
  error: string | null;
}

/** Photo/video picker for posts: up to 4 items, uploaded as soon as they are chosen. */
export function MediaPicker({ value, onChange, onBusyChange }: { value: MediaItem[]; onChange: (m: MediaItem[]) => void; onBusyChange?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const room = EXTRA_LIMITS.mediaPerPost - value.length - pending.filter((p) => !p.error).length;

  useEffect(() => onBusyChange?.(pending.some((p) => !p.error)), [pending, onBusyChange]);

  const update = (id: string, patch: Partial<Pending>) => setPending((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addFile = async (file: File) => {
    const id = Math.random().toString(36).slice(2);
    const isVideo = file.type.startsWith('video/');
    const preview = URL.createObjectURL(file);
    setPending((ps) => [...ps, { id, type: isVideo ? 'video' : 'image', preview, progress: 0, error: null }]);
    try {
      let item: MediaItem;
      if (isVideo) {
        const type = VIDEO_TYPES[file.type];
        if (!type) throw new Error('Use an MP4, MOV or WebM video.');
        if (file.size > EXTRA_LIMITS.videoMaxBytes) throw new Error('Videos can be at most 50 MB. Try a shorter clip.');
        const info = await inspectVideo(file);
        if (Number.isFinite(info.duration) && info.duration > EXTRA_LIMITS.videoMaxSeconds + 1) throw new Error('Videos can be at most 3 minutes long.');
        let posterUrl: string | null = null;
        if (info.poster) {
          const poster = await preparePhoto(new File([info.poster], 'poster.webp', { type: info.poster.type }), 720, EXTRA_LIMITS.imageMaxBytes).catch(() => null);
          if (poster) posterUrl = await uploadWithProgress('/uploads/image', poster, () => {}).catch(() => null);
        }
        const url = await uploadWithProgress('/uploads/video', new Blob([file], { type }), (f) => update(id, { progress: f }));
        item = { type: 'video', url, posterUrl };
      } else {
        const blob = await preparePhoto(file, EXTRA_LIMITS.imageMaxPixels, EXTRA_LIMITS.imageMaxBytes);
        const url = await uploadWithProgress('/uploads/image', blob, (f) => update(id, { progress: f }));
        item = { type: 'image', url, posterUrl: null };
      }
      onChange([...latest.current, item]);
      setPending((ps) => ps.filter((p) => p.id !== id));
      URL.revokeObjectURL(preview);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error && !('code' in e) ? e.message : friendlyError(e);
      update(id, { error: message });
    }
  };

  const pick = (files: FileList | null) => {
    setError(null);
    if (!files?.length) return;
    const list = [...files];
    if (list.length > room) setError(`You can add ${EXTRA_LIMITS.mediaPerPost} photos or videos per post.`);
    list.slice(0, Math.max(0, room)).forEach((f) => void addFile(f));
    if (input.current) input.current.value = '';
  };

  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-gray-800">Photos and videos (optional)</span>
      <ul className="grid grid-cols-4 gap-2">
        {value.map((m, i) => (
          <li key={m.url} className="relative aspect-square overflow-hidden rounded-xl bg-sand-200">
            {m.type === 'image' ? (
              <img src={m.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <>
                {m.posterUrl ? <img src={m.posterUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gray-800" />}
                <span className="absolute inset-0 flex items-center justify-center text-2xl text-white">▶</span>
              </>
            )}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
              aria-label="Remove"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-sand-200">
            {p.type === 'image' ? (
              <img src={p.preview} alt="" className="h-full w-full object-cover opacity-60" />
            ) : (
              <video src={p.preview} muted playsInline className="h-full w-full object-cover opacity-60" />
            )}
            {p.error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-700/85 p-1 text-center text-[10px] font-semibold leading-tight text-white">
                {p.error}
                <button type="button" className="underline" onClick={() => setPending((ps) => ps.filter((x) => x.id !== p.id))}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="absolute inset-x-1 bottom-1 h-1.5 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-valuenow={Math.round(p.progress * 100)}>
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.max(5, p.progress * 100)}%` }} />
              </div>
            )}
          </li>
        ))}
        {room > 0 && (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 text-xs font-semibold text-brand-800 hover:border-brand-400"
            >
              <Icon name="camera" className="h-6 w-6" />
              Add
            </button>
          </li>
        )}
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/*,video/mp4,video/quicktime,video/webm"
        multiple
        className="sr-only"
        aria-label="Choose photos or videos"
        onChange={(e) => pick(e.target.files)}
      />
      <p className="mt-1 text-xs text-gray-600">Up to 4. Photos are made smaller on your phone; videos up to 3 minutes / 50 MB.</p>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// ---------------- viewing ----------------

/** Photos and videos on a post, with a full-screen photo viewer (swipe or arrows to move between photos). */
export function MediaGallery({ media }: { media: MediaItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  const images = media.filter((m) => m.type === 'image');
  const grid = media.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <>
      <div className={`mt-3 grid gap-1 overflow-hidden rounded-xl ${grid}`}>
        {media.map((m, i) => (
          <div key={m.url} className={`relative bg-sand-100 ${media.length === 3 && i === 0 ? 'col-span-2' : ''}`}>
            {m.type === 'image' ? (
              <button type="button" className="block w-full" onClick={() => setOpen(images.indexOf(m))} aria-label="View photo">
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`w-full object-cover ${media.length === 1 ? 'max-h-[28rem]' : 'aspect-square'}`}
                />
              </button>
            ) : (
              <video
                src={m.url}
                poster={m.posterUrl ?? undefined}
                controls
                playsInline
                preload="none"
                className={`w-full bg-black ${media.length === 1 ? 'max-h-[28rem]' : 'aspect-square object-cover'}`}
              />
            )}
          </div>
        ))}
      </div>
      {open !== null && <Lightbox images={images.map((m) => m.url)} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Lightbox({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const go = useCallback((d: number) => setI((x) => (x + d + images.length) % images.length), [images.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = '';
    };
  }, [go, onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      onClick={onClose}
      onTouchStart={(e) => (touch.current = e.touches[0]!.clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0]!.clientX - touch.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
    >
      <img src={images[i]} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white" aria-label="Close">
        <Icon name="close" />
      </button>
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-3 text-white"
            aria-label="Previous photo"
          >
            <Icon name="back" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-3 text-white"
            aria-label="Next photo"
          >
            <Icon name="back" className="h-5 w-5 rotate-180" />
          </button>
          <p className="absolute bottom-4 text-sm text-white/80">
            {i + 1} / {images.length}
          </p>
        </>
      )}
    </div>
  );
}
