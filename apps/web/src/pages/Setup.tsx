import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sendEmailVerification } from 'firebase/auth';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { auth } from '../lib/firebase';
import { friendlyError } from '../lib/util';
import { Icon } from '../components/Icon';
import { Alert, Button, Card, ErrorState, PageSpinner } from '../components/ui';

interface Status {
  founderEmailConfigured: boolean;
  isFounder: boolean;
  keyConfigured: boolean;
  superAdminExists: boolean;
  callerIsSuperAdmin: boolean;
}
interface Step {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** One-time "Set up Siwu Connect" page — lets the founder finish setup from a phone. */
export function SetupPage() {
  const { user, profile } = useAuth();
  const status = useQuery({ queryKey: ['setupStatus'], queryFn: () => api<Status>('/setup/status', { method: 'GET' }), retry: false });
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // Done in small parts: Cloudflare limits how many calls one request may make.
      type Part = { ok: boolean; steps: Step[]; next?: number | null; created?: number; existing?: number; total?: number };
      const core = await api<Part>('/setup/run?part=core');
      const order = ['credentials', 'rules', 'indexes', 'towns', 'search', 'domains', 'superAdmin'];
      const show = (idx: Step | null) =>
        setSteps([...core.steps, ...(idx ? [idx] : [])].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)));
      show(null);
      if (!core.steps[0]?.ok) {
        setDone(false);
        return;
      }
      let from: number | null = 0;
      let created = 0;
      let existing = 0;
      let idxStep: Step = { id: 'indexes', label: 'Database indexes', ok: true, detail: '' };
      while (from !== null) {
        const part: Part = await api<Part>(`/setup/run?part=indexes&from=${from}`);
        const s = part.steps.find((x) => x.id === 'indexes');
        if (!s || !s.ok) {
          idxStep = s ?? { id: 'indexes', label: 'Database indexes', ok: false, detail: 'Could not create the indexes.' };
          break;
        }
        created += part.created ?? 0;
        existing += part.existing ?? 0;
        from = part.next ?? null;
        idxStep = {
          id: 'indexes',
          label: 'Database indexes',
          ok: true,
          detail:
            s.detail.startsWith('Skipped') ? s.detail
            : `${created} indexes started building, ${existing} already existed${from !== null ? ` (${from} of ${part.total})…` : '. Building can take a few minutes.'}`,
        };
        show(idxStep);
      }
      show(idxStep);
      setDone(core.ok && idxStep.ok);
      void status.refetch();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshVerification = async () => {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    await status.refetch();
  };

  if (!user) return null;
  if (status.isPending) return <PageSpinner />;
  if (status.isError) return <ErrorState message={friendlyError(status.error)} onRetry={() => status.refetch()} />;
  const s = status.data;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Set up Siwu Connect</h1>
      <p className="text-sm text-gray-700">
        This one-time setup installs the security rules, adds the five towns and makes this account the Super Admin.
      </p>

      {!s.keyConfigured ? (
        <Alert kind="warning">
          The Firebase key has not been added yet. Finish the step “Paste the key into Cloudflare”, then come back and
          tap <strong>Check again</strong>.
        </Alert>
      ) : s.superAdminExists && !s.callerIsSuperAdmin ? (
        <Alert kind="info">Setup has already been completed. You can use Siwu Connect normally.</Alert>
      ) : !s.superAdminExists && !s.isFounder ? (
        <Alert kind="warning">
          {!s.founderEmailConfigured
            ? 'The founder email has not been configured for this site yet.'
            : user.email && !user.emailVerified
              ? 'Please verify your email first: open the link we emailed you, then tap “I have verified”.'
              : `Only the founder account can run the setup. You are signed in as ${user.email ?? 'an account without email'}.`}
          {user.email && !user.emailVerified && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button small onClick={refreshVerification}>
                I have verified
              </Button>
              <Button
                small
                variant="secondary"
                onClick={async () => {
                  await sendEmailVerification(auth.currentUser!);
                  setNote('Verification email sent. Check your inbox and spam folder.');
                }}
              >
                Send the email again
              </Button>
            </div>
          )}
        </Alert>
      ) : null}

      {note && <Alert kind="info">{note}</Alert>}

      <Card className="p-4">
        <ul className="space-y-3">
          {(steps ??
            [
              ['credentials', 'Firebase key'],
              ['rules', 'Security rules'],
              ['indexes', 'Database indexes'],
              ['towns', 'Five towns'],
              ['domains', 'Website sign-in'],
              ['superAdmin', 'Super Admin'],
            ].map(([id, label]) => ({ id: id!, label: label!, ok: false, detail: '' }))
          ).map((step) => (
            <li key={step.id} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  !steps ? 'bg-sand-200 text-gray-500' : step.ok ? 'bg-brand-600 text-white' : 'bg-red-600 text-white'
                }`}
              >
                <Icon name={!steps || step.ok ? 'check' : 'close'} className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-semibold text-gray-900">{step.label}</span>
                {step.detail && <span className={`block text-sm ${step.ok ? 'text-gray-600' : 'text-red-700'}`}>{step.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {error && <Alert>{error}</Alert>}

      {done ? (
        <div className="space-y-3">
          <Alert kind="success">🎉 Siwu Connect is set up!</Alert>
          <Link
            to={profile ? '/' : '/onboarding'}
            className="flex min-h-[52px] items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white"
          >
            {profile ? 'Go to Siwu Connect' : 'Next: create your profile'}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            className="flex-1"
            busy={busy}
            disabled={!s.keyConfigured || (s.superAdminExists ? !s.callerIsSuperAdmin : !s.isFounder)}
            onClick={run}
          >
            {steps ? 'Try again' : s.callerIsSuperAdmin ? 'Run setup again' : 'Set up Siwu Connect'}
          </Button>
          <Button variant="secondary" onClick={() => status.refetch()}>
            Check again
          </Button>
        </div>
      )}
    </div>
  );
}
