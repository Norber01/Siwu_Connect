import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import EasyCrop, { type Area } from 'react-easy-crop';
import { Button } from './ui';

/**
 * "Crop your photo" before it is uploaded: drag to move, pinch or use the slider to zoom, pick a shape.
 * Usage: `const crop = useCrop(); const file2 = await crop(file, { shapes: ['original', 'square'] })` → the cropped
 * file, or null when cancelled. Videos and GIFs pass through untouched.
 */
export type CropShape = 'original' | 'square' | 'portrait' | 'wide' | 'story' | 'landscape';
const SHAPES: Record<CropShape, { label: string; aspect: number | null }> = {
  original: { label: 'Original', aspect: null },
  square: { label: 'Square', aspect: 1 },
  portrait: { label: '4:5', aspect: 4 / 5 },
  landscape: { label: '4:3', aspect: 4 / 3 },
  wide: { label: '16:9', aspect: 16 / 9 },
  story: { label: 'Story 9:16', aspect: 9 / 16 },
};

export interface CropOptions {
  /** Shapes to offer (the first is chosen at the start). Default: original and square. */
  shapes?: CropShape[];
  /** Round preview, for profile photos. */
  round?: boolean;
  title?: string;
}

type Crop = (file: File, opts?: CropOptions) => Promise<File | null>;
const CropContext = createContext<Crop>(async (f) => f);
export const useCrop = () => useContext(CropContext);

interface Job {
  file: File;
  url: string;
  opts: CropOptions;
  resolve: (f: File | null) => void;
}

export function CropProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null);
  const crop = useCallback<Crop>(
    (file, opts = {}) =>
      new Promise((resolve) => {
        if (!file.type.startsWith('image/') || file.type === 'image/gif') {
          resolve(file);
          return;
        }
        setJob({ file, url: URL.createObjectURL(file), opts, resolve });
      }),
    [],
  );
  const finish = (f: File | null) => {
    if (!job) return;
    URL.revokeObjectURL(job.url);
    job.resolve(f);
    setJob(null);
  };
  return (
    <CropContext.Provider value={crop}>
      {children}
      {job && <CropDialog job={job} onDone={finish} />}
    </CropContext.Provider>
  );
}

function CropDialog({ job, onDone }: { job: Job; onDone: (f: File | null) => void }) {
  const shapes = job.opts.shapes ?? ['original', 'square'];
  const [shape, setShape] = useState<CropShape>(shapes[0]!);
  const [natural, setNatural] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const aspect = SHAPES[shape].aspect ?? natural;

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onDone(null);
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [onDone]);

  const done = async () => {
    if (!area) return;
    setBusy(true);
    try {
      onDone(await cropToFile(job.url, area, job.file.name));
    } catch {
      onDone(job.file); // could not crop on this phone: use the photo as it is
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={job.opts.title ?? 'Crop photo'} className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button type="button" onClick={() => onDone(null)} className="rounded-full px-3 py-1.5 font-semibold hover:bg-white/10">
          Cancel
        </button>
        <p className="font-bold">{job.opts.title ?? 'Crop photo'}</p>
        <Button small busy={busy} onClick={() => void done()}>
          Done
        </Button>
      </div>
      <div className="relative flex-1">
        <EasyCrop
          image={job.url}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={job.opts.round ? 'round' : 'rect'}
          showGrid={!job.opts.round}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, px) => setArea(px)}
          onMediaLoaded={(m) => setNatural(m.naturalWidth / m.naturalHeight || 1)}
        />
      </div>
      <div className="space-y-3 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
        <label className="flex items-center gap-3 text-sm text-white">
          <span className="shrink-0">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-gold-400"
            aria-label="Zoom"
          />
        </label>
        {shapes.length > 1 && (
          <div role="radiogroup" aria-label="Shape" className="flex flex-wrap justify-center gap-2">
            {shapes.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={shape === s}
                onClick={() => setShape(s)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${shape === s ? 'bg-white text-gray-900' : 'bg-white/15 text-white'}`}
              >
                {SHAPES[s].label}
              </button>
            ))}
          </div>
        )}
        <p className="text-center text-xs text-white/70">Drag to move · pinch or slide to zoom</p>
      </div>
    </div>
  );
}

/** Draws the chosen part of the photo into a new file (it is resized and compressed afterwards as usual). */
async function cropToFile(url: string, a: Area, name: string): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(a.width));
  canvas.height = Math.max(1, Math.round(a.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.drawImage(img, a.x, a.y, a.width, a.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Could not crop');
  return new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}
