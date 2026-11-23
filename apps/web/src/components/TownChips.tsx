import { TOWNS } from '@siwu/shared';

/** Horizontal town selector: "All" plus the four towns. `value` is 'all' or a town id. */
export function TownChips({
  value,
  onChange,
  includeAll = true,
  label = 'Choose feed',
}: {
  value: string;
  onChange: (v: string) => void;
  includeAll?: boolean;
  label?: string;
}) {
  const options = [
    ...(includeAll ? [{ id: 'all', short: 'All', full: 'All Akpafu' }] : []),
    ...TOWNS.map((t) => ({ id: t.id as string, short: t.shortName as string, full: t.name as string })),
  ];
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
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
