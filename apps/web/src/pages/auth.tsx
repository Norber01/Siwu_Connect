import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { TOWNS } from '@siwu/shared';
import { auth } from '../lib/firebase';
import { friendlyError } from '../lib/util';
import { Alert, Button, TextField } from '../components/ui';

export function WelcomePage() {
  return (
    <div className="pt-6 text-center">
      <img src="/favicon.svg" alt="" width={72} height={72} className="mx-auto" />
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-brand-900">Siwu Connect</h1>
      <p className="mt-3 text-gray-700">
        Stay connected with home. News, announcements and conversations from the four Siwu-speaking Akpafu towns — for
        people at home, across Ghana and abroad.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-2 text-sm font-semibold text-brand-900">
        {TOWNS.map((t) => (
          <li key={t.id} className="rounded-xl border border-brand-200 bg-white px-3 py-3">
            {t.name}
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col gap-3">
        <Link to="/register" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-brand-800 font-semibold text-white hover:bg-brand-900">
          Join Siwu Connect
        </Link>
        <Link to="/login" className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-sand-200 bg-white font-semibold text-brand-900 hover:bg-sand-50">
          I already have an account
        </Link>
      </div>
      <p className="mt-8 text-xs text-gray-600">
        Free to join. <Link to="/rules" className="underline">Community rules</Link> ·{' '}
        <Link to="/privacy" className="underline">Privacy notice</Link>
      </p>
    </div>
  );
}

function GoogleButton({ onError }: { onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e instanceof FirebaseError && e.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
        return;
      }
      onError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="secondary" className="w-full" busy={busy} onClick={go}>
      <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </Button>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs uppercase text-gray-500">
      <span className="h-px flex-1 bg-sand-200" /> or <span className="h-px flex-1 bg-sand-200" />
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
      <p className="mt-1 text-sm text-gray-600">Welcome back to Siwu Connect.</p>
      <div className="mt-6">
        <GoogleButton onError={setError} />
      </div>
      <Divider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" busy={busy}>
          Sign in
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link to="/forgot-password" className="font-medium text-brand-800 underline">
          Forgot password?
        </Link>
        <Link to="/register" className="font-medium text-brand-800 underline">
          Create an account
        </Link>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      void sendEmailVerification(cred.user).catch(() => {});
      navigate('/onboarding');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Join Siwu Connect</h1>
      <p className="mt-1 text-sm text-gray-600">It's free. Next you'll choose your hometown and set up your profile.</p>
      <div className="mt-6">
        <GoogleButton onError={setError} />
      </div>
      <Divider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" busy={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        Already a member?{' '}
        <Link to="/login" className="font-medium text-brand-800 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      // Do not reveal whether an account exists for this email.
      if (err instanceof FirebaseError && err.code === 'auth/user-not-found') setSent(true);
      else setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
      {sent ? (
        <div className="mt-6 space-y-4">
          <Alert kind="success">
            If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. Check your inbox
            and spam folder.
          </Alert>
          <Link to="/login" className="font-medium text-brand-800 underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <p className="text-sm text-gray-600">
            Enter the email you signed up with. If you joined with Google, use "Continue with Google" instead.
          </p>
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" className="w-full" busy={busy}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-brand-800 underline">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
