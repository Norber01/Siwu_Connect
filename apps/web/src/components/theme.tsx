import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'siwu.theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Applies the theme to <html> (class "dark"), following the phone's setting when "system". */
export function applyTheme(pref: ThemePref = read()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', !!dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1410' : '#1f8a3a');
}

export function initTheme() {
  applyTheme();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
}

export function ThemePicker() {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
    applyTheme(pref);
  }, [pref]);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {(
        [
          ['light', '☀️ Light'],
          ['dark', '🌙 Dark'],
          ['system', '📱 Auto'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="radio"
          aria-checked={pref === id}
          onClick={() => setPref(id)}
          className={`min-h-[44px] rounded-xl text-sm font-semibold ${pref === id ? 'bg-brand-600 text-white' : 'bg-sand-100 text-gray-800'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
