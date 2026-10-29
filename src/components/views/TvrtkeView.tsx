import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/useAuth';
import { fetchTvrtke, manageCompany, type Tvrtka, type TvrtkaPostavke } from '@/lib/company';
import { MODULES } from '@/auth/permissions';
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
    <form onSubmit={(event) => void invite(event)} className="min-w-0 max-w-full space-y-3 break-words">
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
  const { isPlatformOwner, company, refreshAccess } = useAuth();
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

  const saveSettings = async (item: Tvrtka, postavke: TvrtkaPostavke) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await manageCompany({ action: 'update_settings', company_id: item.id, postavke });
      setCompanies(await fetchTvrtke());
      if (company?.id === item.id) await refreshAccess();
      setNotice(`Postavke tvrtke „${item.naziv}” su spremljene.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Postavke tvrtke nisu spremljene.');
    } finally {
      setBusy(false);
    }
  };

  if (!isPlatformOwner) return <p role="alert">Nemate pravo upravljanja tvrtkama.</p>;

  return (
    <section className="min-w-0 max-w-full space-y-6 break-words">
      <header><h1 className="text-2xl font-bold text-slate-900">Tvrtke</h1><p className="mt-1 text-sm text-slate-600">Otvaranje tvrtki i njihovih administratora. Ovaj ekran ne daje pristup njihovim poslovnim podacima.</p></header>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
      <form onSubmit={(event) => void create(event)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Nova tvrtka</h2>
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          <Field label="Naziv"><TextInput required value={form.naziv} onChange={(event) => setForm({ ...form, naziv: event.target.value })} /></Field>
          <Field label="OIB"><TextInput required pattern="[0-9]{11}" maxLength={11} value={form.oib} onChange={(event) => setForm({ ...form, oib: event.target.value })} /></Field>
          <Field label="Adresa"><TextInput required value={form.adresa} onChange={(event) => setForm({ ...form, adresa: event.target.value })} /></Field>
          <Field label="E-mail prvog administratora"><TextInput type="email" required value={form.admin_email} onChange={(event) => setForm({ ...form, admin_email: event.target.value })} /></Field>
        </div>
        <button disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Spremanje…' : 'Otvori tvrtku i pozovi administratora'}</button>
      </form>
      {loading ? <p>Učitavanje tvrtki…</p> : companies.map((item) => (
        <article key={item.id} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:flex-wrap xl:items-center">
            <div><h2 className="font-semibold">{item.naziv}</h2><p className="text-sm text-slate-600">OIB: {item.oib} · {item.adresa}</p><p className="text-sm">{item.aktivna ? 'Aktivna' : 'Neaktivna'}</p></div>
            <button type="button" disabled={busy || company?.id === item.id} onClick={() => void toggle(item)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{item.aktivna ? 'Deaktiviraj' : 'Aktiviraj'}</button>
          </div>
          <CompanySettings item={item} busy={busy} onSave={(postavke) => void saveSettings(item, postavke)} />
          {item.aktivna && <PozoviKorisnika companyId={item.id} allowAdmin />}
        </article>
      ))}
    </section>
  );
}

function CompanySettings({ item, busy, onSave }: {
  item: Tvrtka;
  busy: boolean;
  onSave: (postavke: TvrtkaPostavke) => void;
}) {
  const [postavke, setPostavke] = useState<TvrtkaPostavke>(item.postavke);

  useEffect(() => setPostavke(item.postavke), [item.postavke]);

  const toggleModule = (moduleId: string, enabled: boolean) => {
    setPostavke((previous) => ({
      ...previous,
      disabled_modules: enabled
        ? previous.disabled_modules.filter((id) => id !== moduleId)
        : [...new Set([...previous.disabled_modules, moduleId])],
    }));
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="font-semibold text-slate-900">Opcije i dostupni moduli</h3>
        <p className="mt-1 text-xs text-slate-500">Ove postavke određuju što je uključeno za cijelu tvrtku. Prava pojedinih korisnika i dalje se podešavaju zasebno.</p>
      </div>
      <Field label="Obračun rabata na fakturama">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Obračun rabata na fakturama">
          {([
            { value: 'pribroji', title: 'Pribrojiti rabat', detail: 'Rabat povećava ukupan iznos fakture.' },
            { value: 'oduzmi', title: 'Oduzeti rabat', detail: 'Rabat smanjuje ukupan iznos fakture.' },
          ] as const).map((option) => {
            const selected = postavke.invoice_rebate_mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPostavke((previous) => ({ ...previous, invoice_rebate_mode: option.value }))}
                className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? 'border-sky-600 bg-sky-50 ring-2 ring-sky-600/20'
                    : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-sky-600' : 'border-slate-400'
                  }`}>
                    {selected && <span className="h-2 w-2 rounded-full bg-sky-600" />}
                  </span>
                  <span className="font-semibold text-slate-900">{option.title}</span>
                </span>
                <span className="mt-1 block pl-6 text-xs text-slate-600">{option.detail}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-slate-500">Primjenjuje se na nove fakture. Ranije izdane fakture zadržavaju svoj postojeći obračun.</p>
      </Field>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Moduli uključeni za tvrtku</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((module) => (
            <label key={module.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!postavke.disabled_modules.includes(module.id)}
                onChange={(event) => toggleModule(module.id, event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {module.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(postavke)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? 'Spremanje…' : 'Spremi opcije tvrtke'}
        </button>
      </div>
    </section>
  );
}
