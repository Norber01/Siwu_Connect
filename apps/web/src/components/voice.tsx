import { useEffect, useRef, useState } from 'react';
import { EXTRA_LIMITS } from '@siwu/shared';
import { uploadWithProgress } from './media';
import { Icon } from './Icon';

function pickType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return null;
}

export function canRecordVoice(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && !!pickType();
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Voice-note recorder for chat: tap the mic to start, then Send or Cancel.
 * Stops on its own at 2 minutes. The note is uploaded, then handed to onSend.
 */
export function VoiceRecorder({
  onSend,
  onError,
  disabled,
}: {
  onSend: (audio: { url: string; seconds: number }) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    if (state !== 'recording') return;
    const t = setInterval(() => {
      const s = (Date.now() - started.current) / 1000;
      setSeconds(s);
      if (s >= EXTRA_LIMITS.audioMaxSeconds) rec.current?.stop();
    }, 250);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const starting = useRef(false);
  const start = async () => {
    if (starting.current) return; // ignore a second tap while the phone asks for permission
    starting.current = true;
    try {
      await begin();
    } finally {
      starting.current = false;
    }
  };
  const begin = async () => {
    const type = pickType();
    if (!type) return onError('Voice notes are not supported on this browser.');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      return onError(
        name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : 'The microphone is blocked for Siwu Connect. Tap the lock or ⓘ icon next to the web address (or open your phone Settings → Apps → your browser → Permissions), allow the microphone, then try again.',
      );
    }
    const r = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32_000 });
    chunks.current = [];
    cancelled.current = false;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const secs = (Date.now() - started.current) / 1000;
      if (cancelled.current || secs < 0.7) {
        setState('idle');
        return;
      }
      setState('sending');
      try {
        const base = type.split(';')[0]!;
        const blob = new Blob(chunks.current, { type: base });
        if (blob.size > EXTRA_LIMITS.audioMaxBytes) throw new Error('This voice note is too long.');
        const url = await uploadWithProgress('/uploads/audio', blob, () => {});
        await onSend({ url, seconds: Math.min(EXTRA_LIMITS.audioMaxSeconds, secs) });
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not send the voice note.');
      } finally {
        setState('idle');
      }
    };
    rec.current = r;
    started.current = Date.now();
    setSeconds(0);
    r.start(1000);
    setState('recording');
  };

  if (state === 'recording')
    return (
      <div className="flex flex-1 items-center gap-2 rounded-2xl bg-red-50 px-3 py-1.5" role="status" aria-live="polite">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
        <span className="flex-1 text-sm font-semibold tabular-nums text-red-800">Recording {mmss(seconds)}</span>
        <button
          type="button"
          onClick={() => {
            cancelled.current = true;
            rec.current?.stop();
          }}
          className="rounded-full px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => rec.current?.stop()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white"
          aria-label="Send voice note"
        >
          <Icon name="share" className="h-5 w-5" />
        </button>
      </div>
    );
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled || state === 'sending'}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40"
      aria-label={state === 'sending' ? 'Sending voice note' : 'Record a voice note'}
    >
      {state === 'sending' ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Icon name="mic" className="h-5 w-5" />}
    </button>
  );
}

/** Compact voice-note player for chat bubbles and word-of-the-day cards. */
export function VoicePlayer({ url, seconds, light }: { url: string; seconds?: number; light?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(seconds ?? 0);
  return (
    <div className="flex min-w-[190px] items-center gap-2 py-0.5">
      <button
        type="button"
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) {
            document.querySelectorAll('audio').forEach((x) => x !== a && x.pause());
            void a.play();
          } else a.pause();
        }}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${light ? 'bg-white text-brand-700' : 'bg-brand-600 text-white'}`}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
      >
        <Icon name={playing ? 'pause' : 'play'} filled className="h-4 w-4" />
      </button>
      <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${light ? 'bg-white/40' : 'bg-sand-200'}`}>
        <div className={`h-full ${light ? 'bg-white' : 'bg-brand-600'}`} style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums opacity-80">{mmss(playing || pos ? pos : dur)}</span>
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
      />
    </div>
  );
}
