import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { Building2, LogOut } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { supabase } from '@/lib/supabase';

function PasswordRecoveryForm({ onSave }: { onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Lozinke se ne podudaraju.');
      return;
    }
    setBusy(true);
    try {
      await onSave(password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Lozinku nije moguće promijeniti.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Postavljanje nove lozinke</h1>
        <label className="mt-5 block text-sm font-medium text-slate-700">
          Nova lozinka
          <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Ponovite lozinku
          <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
        </label>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="mt-5 w-full rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-60">{busy ? 'Spremanje…' : 'Spremi novu lozinku'}</button>
      </form>
    </main>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (authError) throw authError;
        setMessage('Ako račun postoji, poslana je poveznica za postavljanje nove lozinke.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Prijava nije uspjela.');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'login' ? 'Prijava u aplikaciju' : 'Promjena lozinke';
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-600 text-white"><Building2 className="h-6 w-6" /></div>
          <div><h1 className="text-xl font-bold text-slate-900">GradTech</h1><p className="text-sm text-slate-500">{title}</p></div>
        </div>
        <label className="mb-4 block text-sm font-medium text-slate-700">
          E-mail
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
        </label>
        {mode !== 'reset' && (
          <label className="mb-4 block text-sm font-medium text-slate-700">
            Lozinka
            <input type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
          </label>
        )}
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60">
          {busy ? 'Molimo pričekajte…' : mode === 'login' ? 'Prijavi se' : 'Pošalji poveznicu'}
        </button>
        <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
          {mode !== 'login' && <button type="button" onClick={() => { setMode('login'); setError(null); setMessage(null); }} className="text-sky-700 hover:underline">Prijava</button>}
          {mode === 'login' && <span className="text-xs text-slate-500">Za novi račun zatražite pozivnicu administratora tvrtke.</span>}
          {mode === 'login' && <button type="button" onClick={() => { setMode('reset'); setError(null); setMessage(null); }} className="text-slate-600 hover:underline">Zaboravljena lozinka?</button>}
        </div>
      </form>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, profile, company, loading, accessError, recoveryMode, updatePassword, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  if (recoveryMode) return <PasswordRecoveryForm onSave={updatePassword} />;
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Provjera prijave…</div>;
  if (!session) return <AuthForm />;
  if (accessError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-xl border border-red-200 bg-white p-6">
          <h1 className="font-semibold text-slate-900">Pristup nije moguće provjeriti</h1>
          <p className="mt-2 text-sm text-red-700">{accessError}</p>
          <button onClick={() => void signOut().catch((reason: unknown) => setSignOutError(reason instanceof Error ? reason.message : 'Odjava nije uspjela.'))} className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white">Odjava</button>
          {signOutError && <p role="alert" className="mt-2 text-sm text-red-700">{signOutError}</p>}
        </div>
      </div>
    );
  }
  if (!profile?.approved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Račun čeka odobrenje</h1>
          <p className="mt-2 text-sm text-slate-600">Administrator će odobriti vaš račun i dodijeliti prava pristupa. Poslovni podaci nisu dostupni dok se to ne učini.</p>
          <button onClick={() => void signOut().catch((reason: unknown) => setSignOutError(reason instanceof Error ? reason.message : 'Odjava nije uspjela.'))} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"><LogOut className="h-4 w-4" />Odjavi se</button>
          {signOutError && <p role="alert" className="mt-2 text-sm text-red-700">{signOutError}</p>}
        </div>
      </div>
    );
  }
  return <Fragment key={`${profile.id}:${company?.id}`}>{children}</Fragment>;
}
