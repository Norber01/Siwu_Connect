import { TOWNS } from '@siwu/shared';

/** Horizontal town selector: "All" plus the five towns. `value` is 'all' or a town id. */
export function TownChips({
  value,
  onChange,
  includeAll = true,
  label = 'Choose feed',
  wrap = false,
  variant = 'chips',
}: {
  wrap?: boolean;
  /** "tabs": X-style underlined tabs across the top of the feed. */
  variant?: 'chips' | 'tabs';
  value: string;
  onChange: (v: string) => void;
  includeAll?: boolean;
  label?: string;
}) {
  const options = [
    ...(includeAll ? [{ id: 'all', short: 'All', full: 'All Akpafu' }] : []),
    ...TOWNS.map((t) => ({ id: t.id as string, short: t.shortName as string, full: t.name as string })),
  ];
  if (variant === 'tabs')
    return (
      <div role="tablist" aria-label={label} className="-mx-4 flex overflow-x-auto border-b border-sand-200 [scrollbar-width:none]">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={o.full}
              onClick={() => onChange(o.id)}
              className={`flex min-h-[50px] min-w-[64px] flex-1 shrink-0 items-center justify-center px-3 text-[15px] hover:bg-sand-100 ${
                active ? 'font-bold text-gray-900' : 'font-medium text-gray-600'
              }`}
            >
              <span className="relative flex h-full items-center">
                {o.short}
                {active && <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-brand-600" />}
              </span>
            </button>
          );
        })}
      </div>
    );
  return (
    <div
      role="tablist"
      aria-label={label}
      className={wrap ? 'flex flex-wrap justify-center gap-2' : '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]'}
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={o.full}
            onClick={() => onChange(o.id)}
            className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold transition-colors ${
              active ? 'bg-brand-600 text-white shadow-sm' : 'bg-sand-100 text-gray-800 hover:bg-sand-200'
            }`}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
