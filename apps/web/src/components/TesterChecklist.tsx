import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../auth/AuthProvider';
import { FeedbackDialog } from './extras';

const ITEMS: { id: string; text: string; to: string }[] = [
  { id: 'post', text: 'Write a post (try a photo or a poll)', to: '/new' },
  { id: 'story', text: 'Share a story', to: '/stories/new' },
  { id: 'friend', text: 'Add a friend and send a message', to: '/chat' },
  { id: 'voice', text: 'Send a voice note in a chat', to: '/chat' },
  { id: 'group', text: 'Start a group chat', to: '/chat' },
  { id: 'predict', text: 'Predict a match score', to: '/sports?tab=fixtures' },
  { id: 'event', text: 'Say "Going" to an event', to: '/events' },
  { id: 'share', text: 'Send a post to a friend in chat', to: '/' },
];
const KEY = 'siwu.testerChecklist';

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** For pilot testers: a short list of things to try, and a quick way to tell us what they think. */
export function TesterChecklist() {
  const { profile } = useMe();
  const [done, setDone] = useState(load);
  const [feedback, setFeedback] = useState(false);
  if (!profile.tester || done.__hidden) return null;
  const save = (next: Record<string, boolean>) => {
    setDone(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const count = ITEMS.filter((i) => done[i.id]).length;
  return (
    <section aria-label="Pilot tester checklist" className="rounded-2xl border border-gold-400 bg-gold-100/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-900">🧪 Thank you for testing! ({count}/{ITEMS.length})</h2>
        <button onClick={() => save({ ...done, __hidden: true })} className="text-xs font-semibold text-gray-600 underline">
          Hide
        </button>
      </div>
      <p className="mb-2 text-sm text-gray-700">Try these and tell us what was easy, confusing or broken.</p>
      <ul className="space-y-1.5">
        {ITEMS.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-600"
              checked={!!done[i.id]}
              onChange={(e) => save({ ...done, [i.id]: e.target.checked })}
              aria-label={i.text}
            />
            <Link to={i.to} className={`flex-1 ${done[i.id] ? 'text-gray-500 line-through' : 'font-semibold text-gray-900'}`}>
              {i.text}
            </Link>
          </li>
        ))}
      </ul>
      <button onClick={() => setFeedback(true)} className="mt-3 w-full rounded-full bg-gradient-to-b from-gold-400 to-gold-600 py-2.5 text-sm font-bold text-white">
        💬 Tell us what you think
      </button>
      <FeedbackDialog
        open={feedback}
        onClose={() => setFeedback(false)}
        title="Pilot tester feedback"
        intro="What worked well? What was confusing or didn't work? Which phone are you using? Every message is read."
        initialText="Pilot feedback:\n"
      />
    </section>
  );
}
