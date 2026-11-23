import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, MIN_AGE, isTownId, profileSchema, usernameSchema } from '@siwu/shared';
import { getPreferredTown } from './auth';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { createProfile } from '../lib/ops';
import { isUsernameTaken } from '../lib/queries';
import { friendlyError, isPermissionDenied } from '../lib/util';
import { type ProfileDraft, ProfileFields, SuccessTick } from '../components/ProfileFields';
import { Alert, Button, TextField } from '../components/ui';

function suggestUsername(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, LIMITS.usernameMax);
}

export function OnboardingPage() {
  const { user, signOut } = useAuth();
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: user?.displayName ?? '',
    hometownId: isTownId(getPreferredTown()) ? (getPreferredTown() as ProfileDraft['hometownId']) : '',
    residence: '',
    countryCode: '',
    photoUrl: null,
  });
  const [username, setUsername] = useState(suggestUsername(user?.displayName ?? ''));
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    const t = setTimeout(() => {
      isUsernameTaken(parsed.data)
        .then((taken) => setAvailability(taken ? 'taken' : 'available'))
        .catch(() => setAvailability('idle'));
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const errs: Record<string, string> = {};
    const p = profileSchema.safeParse({
      displayName: draft.displayName,
      hometownId: draft.hometownId,
      residence: draft.residence || null,
      countryCode: draft.countryCode || null,
    });
    if (!p.success) {
      for (const issue of p.error.issues) {
        const key = String(issue.path[0]);
        errs[key] = key === 'hometownId' ? 'Choose your hometown' : issue.message;
      }
    }
    const u = usernameSchema.safeParse(username);
    if (!u.success) errs.username = u.error.issues[0]!.message;
    else if (availability === 'taken') errs.username = 'This username is taken';
    if (!agree) errs.agree = 'Please confirm to continue';
    setErrors(errs);
    if (Object.keys(errs).length || !p.success || !u.success) return;

    setBusy(true);
    setFormError(null);
    try {
      await createProfile(db, user.uid, { ...p.data, username: u.data, photoUrl: draft.photoUrl });
      // No navigate() here: the onboarding guard sends the user home as soon as the new
      // profile arrives, which avoids bouncing back to an empty form while it loads.
      setSaved(true);
      return;
    } catch (err) {
      if (isPermissionDenied(err)) {
        // Most likely the username was taken a moment ago or is reserved.
        setErrors({ username: 'This username is not available. Try another.' });
        setAvailability('taken');
      } else setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Set up your profile</h1>
      <p className="mt-1 text-sm text-gray-600">Tell the community who you are and which town you're from.</p>
      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <TextField
          label="Username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={LIMITS.usernameMax}
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          error={errors.username ?? (availability === 'taken' ? 'This username is taken' : undefined)}
          hint={
            availability === 'available' ? (
              <span className="inline-flex items-center gap-1 text-brand-800">
                <SuccessTick /> @{username} is available
              </span>
            ) : availability === 'checking' ? (
              'Checking…'
            ) : (
              'Lowercase letters, numbers and _ only. This cannot be changed later.'
            )
          }
        />
        <ProfileFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} errors={errors} />
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sand-200 bg-white p-3 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand-800" />
          <span>
            I am at least {MIN_AGE} years old and I agree to the{' '}
            <Link to="/rules" target="_blank" className="font-medium text-brand-800 underline">
              community rules
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" className="font-medium text-brand-800 underline">
              privacy notice
            </Link>
            .
          </span>
        </label>
        {errors.agree && <p className="-mt-3 text-sm text-red-700">{errors.agree}</p>}
        {formError && <Alert>{formError}</Alert>}
        <Button type="submit" className="w-full" busy={busy || saved}>
          Finish and enter Siwu Connect
        </Button>
        <button type="button" onClick={signOut} className="block w-full text-center text-sm text-gray-600 underline">
          Sign out
        </button>
        <Link to="/setup" className="block text-center text-xs text-gray-500 underline">
          Site owner? Run the first-time setup
        </Link>
      </form>
    </div>
  );
}
