import { useQuery } from '@tanstack/react-query';
import { fetchWords, wordOfTheDay } from '../lib/queries';
import { VoicePlayer } from './voice';

/** "Siwu word of the day" card on the home feed — hidden until admins have added words. */
export function WordOfTheDay() {
  const q = useQuery({ queryKey: ['words'], queryFn: fetchWords, staleTime: 60 * 60_000 });
  const w = wordOfTheDay(q.data ?? []);
  if (!w) return null;
  return (
    <section aria-label="Siwu word of the day" className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-widest text-gold-400">🗣️ Siwu word of the day</p>
      <p className="mt-1 text-2xl font-black">{w.word}</p>
      <p className="text-[15px] text-white/90">{w.meaning}</p>
      {w.example && <p className="mt-1 text-sm italic text-white/75">“{w.example}”</p>}
      {w.audioUrl && (
        <div className="mt-2 max-w-xs">
          <VoicePlayer url={w.audioUrl} light />
        </div>
      )}
    </section>
  );
}
