import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/useAuth';
import { fetchTvrtke, manageCompany, type Tvrtka } from '@/lib/company';
import { Field, TextInput } from '@/components/ui/Field';

export function PozoviKorisnika({ companyId, allowAdmin = false, onInvited }: {
  companyId: string;
  allowAdmin?: boolean;
  onInvited?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await manageCompany({ action: 'invite', company_id: companyId, email, is_admin: allowAdmin && admin });
      setMessage(`Pozivnica je poslana na ${email}.`);
      setEmail('');
      onInvited?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pozivnica nije poslana.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void invite(event)} className="space-y-3">
      <Field label="E-mail novog korisnika"><TextInput type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      {allowAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={admin} onChange={(event) => setAdmin(event.target.checked)} />Administrator ove tvrtke</label>}
      <button disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Slanje…' : 'Pošalji pozivnicu'}</button>
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

const emptyForm = { naziv: '', oib: '', adresa: '', admin_email: '' };

export function TvrtkeView() {
  const { isPlatformOwner, company } = useAuth();
  const [companies, setCompanies] = useState<Tvrtka[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!isPlatformOwner) return;
    let active = true;
    fetchTvrtke().then((items) => { if (active) setCompanies(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Tvrtke nije moguće učitati.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isPlatformOwner]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await manageCompany({ action: 'create_company', ...form });
      setNotice('Tvrtka je otvorena i pozivnica je poslana prvom administratoru.');
      setForm(emptyForm);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tvrtka nije otvorena.');
    } finally {
      try {
        setCompanies(await fetchTvrtke());
      } catch (reason) {
        setError((previous) => `${previous} ${reason instanceof Error ? reason.message : 'Popis tvrtki nije osvježen.'}`.trim());
      }
      setBusy(false);
    }
  };

  const toggle = async (item: Tvrtka) => {
    setBusy(true);
    setError('');
    try {
      await manageCompany({ action: 'set_active', company_id: item.id, aktivna: !item.aktivna });
      setCompanies(await fetchTvrtke());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Status tvrtke nije spremljen.');
    } finally {
      setBusy(false);
    }
  };

  if (!isPlatformOwner) return <p role="alert">Nemate pravo upravljanja tvrtkama.</p>;

  return (
    <section className="space-y-6">
      <header><h1 className="text-2xl font-bold text-slate-900">Tvrtke</h1><p className="mt-1 text-sm text-slate-600">Otvaranje tvrtki i njihovih administratora. Ovaj ekran ne daje pristup njihovim poslovnim podacima.</p></header>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
      <form onSubmit={(event) => void create(event)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Nova tvrtka</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Naziv"><TextInput required value={form.naziv} onChange={(event) => setForm({ ...form, naziv: event.target.value })} /></Field>
          <Field label="OIB"><TextInput required pattern="[0-9]{11}" maxLength={11} value={form.oib} onChange={(event) => setForm({ ...form, oib: event.target.value })} /></Field>
          <Field label="Adresa"><TextInput required value={form.adresa} onChange={(event) => setForm({ ...form, adresa: event.target.value })} /></Field>
          <Field label="E-mail prvog administratora"><TextInput type="email" required value={form.admin_email} onChange={(event) => setForm({ ...form, admin_email: event.target.value })} /></Field>
        </div>
        <button disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Spremanje…' : 'Otvori tvrtku i pozovi administratora'}</button>
      </form>
      {loading ? <p>Učitavanje tvrtki…</p> : companies.map((item) => (
        <article key={item.id} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold">{item.naziv}</h2><p className="text-sm text-slate-600">OIB: {item.oib} · {item.adresa}</p><p className="text-sm">{item.aktivna ? 'Aktivna' : 'Neaktivna'}</p></div>
            <button type="button" disabled={busy || company?.id === item.id} onClick={() => void toggle(item)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{item.aktivna ? 'Deaktiviraj' : 'Aktiviraj'}</button>
          </div>
          {item.aktivna && <PozoviKorisnika companyId={item.id} allowAdmin />}
        </article>
      ))}
    </section>
  );
}
