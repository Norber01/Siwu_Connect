import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
}

/** "More actions" menu. Only rendered when there is at least one real action. */
export function Menu({ items, label = 'More actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!items.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="-m-1 rounded-lg p-2 text-gray-500 hover:bg-sand-100 hover:text-gray-800"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-sand-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={`flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm hover:bg-sand-100 ${
                it.danger ? 'text-red-700' : 'text-gray-800'
              }`}
            >
              <Icon name={it.icon} className="h-4 w-4" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
