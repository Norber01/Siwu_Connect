import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
} from 'react';
import { Link } from 'react-router-dom';
import { townShortName } from '@siwu/shared';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-800 text-white hover:bg-brand-900 disabled:bg-brand-800/50',
  secondary: 'bg-white text-brand-900 border border-sand-200 hover:bg-sand-50 disabled:text-gray-400',
  ghost: 'text-gray-700 hover:bg-sand-200/60 disabled:text-gray-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; icon?: IconName; small?: boolean }
>(function Button({ variant = 'primary', busy, icon, small, className = '', children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed ${
        small ? 'min-h-[36px] px-3 text-sm' : 'min-h-[44px] px-4'
      } ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner small /> : icon ? <Icon name={icon} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ small, label = 'Loading' }: { small?: boolean; label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <span
        className={`${small ? 'h-4 w-4 border-2' : 'h-8 w-8 border-[3px]'} animate-spin rounded-full border-current border-t-transparent opacity-70`}
      />
    </span>
  );
}

export function PageSpinner() {
  return (
    <div className="flex justify-center py-16 text-brand-800">
      <Spinner />
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string | null;
  hint?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(
  function TextField({ label, error, hint, className = '', ...rest }, ref) {
    const id = useId();
    return (
      <div className={className}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className={`block min-h-[44px] w-full rounded-xl border bg-white px-3 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-200 ${
            error ? 'border-red-500' : 'border-sand-200'
          }`}
          aria-invalid={!!error || undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          {...rest}
        />
        {(error || hint) && (
          <p id={`${id}-msg`} className={`mt-1 text-sm ${error ? 'text-red-700' : 'text-gray-600'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(
  function TextArea({ label, error, hint, className = '', ...rest }, ref) {
    const id = useId();
    return (
      <div className={className}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
          {label}
        </label>
        <textarea
          ref={ref}
          id={id}
          className={`block w-full rounded-xl border bg-white p-3 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-200 ${
            error ? 'border-red-500' : 'border-sand-200'
          }`}
          aria-invalid={!!error || undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          {...rest}
        />
        {(error || hint) && (
          <p id={`${id}-msg`} className={`mt-1 text-sm ${error ? 'text-red-700' : 'text-gray-600'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);

export function SelectField({
  label,
  error,
  hint,
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
        {label}
      </label>
      <select
        id={id}
        className="block min-h-[44px] w-full rounded-xl border border-sand-200 bg-white px-3 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-200"
        {...rest}
      >
        {children}
      </select>
      {(error || hint) && <p className={`mt-1 text-sm ${error ? 'text-red-700' : 'text-gray-600'}`}>{error || hint}</p>}
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success' | 'warning'; children: ReactNode }) {
  const styles = {
    error: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-brand-50 text-brand-900 border-brand-200',
    success: 'bg-brand-50 text-brand-900 border-brand-200',
    warning: 'bg-gold-100 text-gold-800 border-gold-400/40',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children, icon = 'comment' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 rounded-full bg-sand-200 p-3 text-gray-600">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="font-semibold text-gray-900">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-gray-600">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 rounded-full bg-red-50 p-3 text-red-700">
        <Icon name="alert" className="h-6 w-6" />
      </span>
      <p className="font-semibold text-gray-900">Couldn't load this</p>
      <p className="mt-1 max-w-sm text-sm text-gray-600">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-sand-200 bg-white ${className}`}>{children}</div>;
}

export function TownBadge({ townId }: { townId: string }) {
  return (
    <Link
      to={`/towns/${townId}`}
      className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
    >
      {townShortName(townId)}
    </Link>
  );
}

export function Avatar({ url, name, size = 40 }: { url: string | null | undefined; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return url ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="shrink-0 rounded-full bg-sand-200 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  );
}

/** Accessible modal dialog using the native <dialog> element. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 backdrop:bg-black/40"
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-lg font-bold text-gray-900">
              {title}
            </h2>
            <button onClick={onClose} className="-m-2 rounded-lg p-2 text-gray-500 hover:bg-sand-100" aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, back, actions }: { title: ReactNode; back?: boolean; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {back && (
        <button
          onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = '/')}
          className="-ml-2 rounded-lg p-2 text-gray-700 hover:bg-sand-200/60"
          aria-label="Go back"
        >
          <Icon name="back" />
        </button>
      )}
      <h1 className="flex-1 text-xl font-bold text-gray-900">{title}</h1>
      {actions}
    </div>
  );
}
