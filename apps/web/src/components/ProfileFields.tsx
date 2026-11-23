import { useRef, useState } from 'react';
import { COUNTRIES, LIMITS, RESIDENCE_OPTIONS, type Residence, TOWNS, type TownId } from '@siwu/shared';
import { api } from '../lib/api';
import { friendlyError, prepareAvatar } from '../lib/util';
import { Icon } from './Icon';
import { Avatar, Button, SelectField, TextField } from './ui';

export interface ProfileDraft {
  displayName: string;
  hometownId: TownId | '';
  residence: Residence | '';
  countryCode: string;
  photoUrl: string | null;
}

export function HometownPicker({ value, onChange, error }: { value: string; onChange: (t: TownId) => void; error?: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-gray-800">Your hometown</legend>
      <div className="grid grid-cols-2 gap-2">
        {TOWNS.map((t) => (
          <label
            key={t.id}
            className={`flex min-h-[56px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${
              value === t.id ? 'border-brand-700 bg-brand-50 text-brand-900 ring-2 ring-brand-200' : 'border-sand-200 bg-white text-gray-800'
            }`}
          >
            <input
              type="radio"
              name="hometown"
              value={t.id}
              checked={value === t.id}
              onChange={() => onChange(t.id)}
              className="h-4 w-4 accent-brand-800"
            />
            {t.name}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </fieldset>
  );
}

export function PhotoPicker({ url, name, onChange }: { url: string | null; name: string; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await prepareAvatar(file, LIMITS.avatarPixels, LIMITS.avatarMaxBytes);
      const res = await api<{ url: string }>('/uploads/avatar', { body: blob, contentType: blob.type });
      onChange(res.url);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) && !('status' in e) ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-gray-800">Profile photo (optional)</span>
      <div className="flex items-center gap-4">
        <Avatar url={url} name={name || '?'} size={64} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" small icon="camera" busy={busy} onClick={() => input.current?.click()}>
            {url ? 'Change photo' : 'Add photo'}
          </Button>
          {url && (
            <Button type="button" variant="ghost" small onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose profile photo"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      <p className="mt-1 text-xs text-gray-600">Photos are resized on your phone to save data.</p>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function ProfileFields({
  draft,
  set,
  errors,
}: {
  draft: ProfileDraft;
  set: (patch: Partial<ProfileDraft>) => void;
  errors: Partial<Record<keyof ProfileDraft, string>>;
}) {
  return (
    <div className="space-y-5">
      <TextField
        label="Display name"
        autoComplete="name"
        maxLength={LIMITS.displayNameMax}
        value={draft.displayName}
        onChange={(e) => set({ displayName: e.target.value })}
        error={errors.displayName}
        hint="The name people will see on your posts."
      />
      <HometownPicker value={draft.hometownId} onChange={(t) => set({ hometownId: t })} error={errors.hometownId} />
      <SelectField
        label="Where do you live now? (optional)"
        value={draft.residence}
        onChange={(e) => {
          const residence = e.target.value as Residence | '';
          set({ residence, countryCode: residence === 'hometown' || residence === 'ghana' ? 'GH' : residence === 'abroad' && draft.countryCode === 'GH' ? '' : draft.countryCode });
        }}
        hint="Self-declared and editable at any time. We never track your location."
      >
        <option value="">Prefer not to say</option>
        {RESIDENCE_OPTIONS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </SelectField>
      {draft.residence === 'abroad' && (
        <SelectField label="Country (optional)" value={draft.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>
          <option value="">Prefer not to say</option>
          {COUNTRIES.filter((c) => c.code !== 'GH').map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </SelectField>
      )}
      <PhotoPicker url={draft.photoUrl} name={draft.displayName} onChange={(photoUrl) => set({ photoUrl })} />
    </div>
  );
}

export function SuccessTick() {
  return <Icon name="check" className="h-4 w-4 text-brand-700" />;
}
