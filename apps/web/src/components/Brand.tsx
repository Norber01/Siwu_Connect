/** Siwu Connect logo: three community figures in green, yellow and dark green. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 9 64 48" width={size} height={(size * 48) / 64} aria-hidden="true">
      <g transform="translate(2 9)">
        <circle cx="17" cy="8" r="6.5" fill="#1f8a3a" />
        <path fill="#1f8a3a" d="M3 46C3 27 9 17 20 17c7 0 11 4 13 9l-6 4c-1.5-4-4-6-7-6-7 0-10 8-10 22z" />
        <circle cx="34" cy="6" r="6" fill="#f7c600" />
        <path fill="#f7c600" d="M22 46c0-17 5-28 14-28s13 11 13 28h-7c0-13-2-21-6-21s-7 8-7 21z" />
        <circle cx="51" cy="10" r="5.5" fill="#1f2a22" />
        <path fill="#1f2a22" d="M43 46c0-14 3-24 9-24s9 10 9 24h-6c0-10-1-17-3-17s-3 7-3 17z" />
      </g>
    </svg>
  );
}

/** Horizontal logo for headers. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={lg ? 56 : 30} />
      <span className={`whitespace-nowrap font-black leading-none tracking-tight ${lg ? 'text-3xl' : 'text-lg'}`}>
        <span className="text-brand-900">Siwu</span> <span className="text-brand-600">Connect</span>
      </span>
    </span>
  );
}

/** Stacked logo with tagline, for the welcome screen. */
export function StackedLogo() {
  return (
    <div className="flex flex-col items-center text-center">
      <LogoMark size={112} />
      <p className="mt-2 text-5xl font-black leading-[0.9] tracking-tight text-brand-900">Siwu</p>
      <p className="text-5xl font-black leading-[0.95] tracking-tight text-brand-600">Connect</p>
      <p className="mt-2 text-base font-semibold italic text-gray-800">Five Towns. One Community.</p>
    </div>
  );
}

/** Simple landscape illustration (hills, trees, sun) — no photo download needed. */
export function Landscape() {
  return (
    <svg viewBox="0 0 400 120" className="block h-auto w-full" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <rect width="400" height="120" fill="#eaf6ff" />
      <circle cx="330" cy="34" r="16" fill="#f7c600" />
      <path d="M0 70 Q60 40 120 62 T250 55 T400 60 V120 H0Z" fill="#7dcb8e" />
      <path d="M0 88 Q80 62 170 82 T330 76 T400 80 V120 H0Z" fill="#2a9645" />
      <path d="M0 104 Q100 88 200 100 T400 96 V120 H0Z" fill="#135f27" />
      {[40, 70, 150, 260, 300, 360].map((x, i) => (
        <g key={x} transform={`translate(${x} ${78 - (i % 2) * 6})`}>
          <rect x="-1.5" y="6" width="3" height="10" fill="#5c4033" />
          <circle cx="0" cy="4" r="8" fill="#187530" />
        </g>
      ))}
      {[95, 115, 200, 222, 240].map((x, i) => (
        <g key={x} transform={`translate(${x} ${84 - (i % 2) * 3})`}>
          <rect width="14" height="9" fill="#ffffff" />
          <path d="M-2 0 L7 -6 L16 0Z" fill={i % 2 ? '#b45309' : '#64748b'} />
        </g>
      ))}
    </svg>
  );
}
