import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getAiKey, setAiKey } from '@/lib/ai';
import { loadPostavke, obavijestTipovi, savePostavke, type ObavijestTip, type Postavke } from '@/lib/postavke';
import { useAuth } from '@/auth/useAuth';
import { DEFAULT_GRADILISTE_COLUMN_LABELS, manageCompany } from '@/lib/company';
import { Field, TextInput } from '@/components/ui/Field';

const toMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export function PostavkeView() {
  const { company, isAdmin, isPlatformOwner, refreshAccess } = useAuth();
  const [p, setP] = useState<Postavke>(loadPostavke);
  const [aiKey, setAiKeyState] = useState(getAiKey);
  const [columnLabels, setColumnLabels] = useState<string[]>([...DEFAULT_GRADILISTE_COLUMN_LABELS]);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState('');
  const [labelsNotice, setLabelsNotice] = useState('');

  useEffect(() => {
    setColumnLabels(company?.postavke.gradiliste_column_labels ?? [...DEFAULT_GRADILISTE_COLUMN_LABELS]);
  }, [company]);

  const update = (next: Postavke) => {
    setP(next);
    savePostavke(next);
  };

  const dan = toMin(p.danOd);
  const noc = toMin(p.nocOd);
  const dayLen = ((noc - dan + 1440) % 1440) / 60;
  const nightLen = 24 - dayLen;
  // Pozicije na traci 00:00–24:00 (noć može prelaziti ponoć)
  const dayStart = (dan / 1440) * 100;
  const nightStart = (noc / 1440) * 100;
  const wraps = noc > dan;

  const setTipValue = (tip: ObavijestTip, patch: Partial<Postavke['obavijesti'][ObavijestTip]>) =>
    update({ ...p, obavijesti: { ...p.obavijesti, [tip]: { ...p.obavijesti[tip], ...patch } } });

  const grupe = [...new Set(obavijestTipovi.map((t) => t.grupa))];
  const canEditLabels = isAdmin || isPlatformOwner;
  const saveLabels = async () => {
    if (!company) return;
    const labels = columnLabels.map((label) => label.trim());
    setSavingLabels(true);
    setLabelsError('');
    setLabelsNotice('');
    try {
      await manageCompany({ action: 'update_board_labels', company_id: company.id, labels });
      await refreshAccess();
      setLabelsNotice('Nazivi vrsta gradilišta su spremljeni za cijelu tvrtku.');
    } catch (reason) {
      setLabelsError(reason instanceof Error ? reason.message : 'Nazivi vrsta gradilišta nisu spremljeni.');
    } finally {
      setSavingLabels(false);
    }
  };

  return (
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Postavke sustava</h1>
        <p className="mt-1 text-sm text-slate-500">Obavijesti i dnevni/noćni rad spremaju se u ovom pregledniku; nazivi vrsta gradilišta spremaju se za cijelu tvrtku.</p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-5">
          {canEditLabels && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900">Vrste gradilišta</h2>
              <p className="mb-4 mt-1 text-xs text-slate-500">Nazivi stupaca primjenjuju se na Gradilišta i Dnevni raspored za sve korisnike vaše tvrtke.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {columnLabels.map((label, index) => (
                  <Field key={index} label={`Vrsta ${index + 1}`}>
                    <TextInput
                      maxLength={60}
                      value={label}
                      onChange={(event) => setColumnLabels((current) => current.map((value, i) => i === index ? event.target.value : value))}
                    />
                  </Field>
                ))}
              </div>
              {labelsError && <p role="alert" className="mt-3 text-sm text-red-700">{labelsError}</p>}
              {labelsNotice && <p role="status" className="mt-3 text-sm text-emerald-700">{labelsNotice}</p>}
              <button
                type="button"
                disabled={savingLabels || !company}
                onClick={() => void saveLabels()}
                className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {savingLabels ? 'Spremanje…' : 'Spremi nazive'}
              </button>
            </section>
          )}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">Dnevni i noćni rad</h2>
            <p className="mb-4 text-xs text-slate-500">Odaberi sat početka dnevnog i noćnog rada · koristi se za obračun noćnih sati</p>

            <div className="relative h-14 overflow-hidden rounded-lg bg-indigo-900">
              {wraps ? (
                <div className="absolute inset-y-0 flex items-center justify-center bg-amber-100 text-xs font-semibold text-amber-800" style={{ left: `${dayStart}%`, width: `${nightStart - dayStart}%` }}>
                  Dnevni rad · {dayLen} h
                </div>
              ) : (
                <>
                  <div className="absolute inset-y-0 left-0 flex items-center justify-center bg-amber-100 text-xs font-semibold text-amber-800" style={{ width: `${nightStart}%` }}>Dnevni rad</div>
                  <div className="absolute inset-y-0 right-0 flex items-center justify-center bg-amber-100 text-xs font-semibold text-amber-800" style={{ width: `${100 - dayStart}%` }}>Dnevni rad</div>
                </>
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-3 text-[10px] text-indigo-200">
                <span>{wraps ? 'Noćni' : ''}</span>
                <span>{wraps ? 'Noćni' : ''}</span>
              </div>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t) => <span key={t}>{t}</span>)}
            </div>

            <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-1 text-xs font-semibold text-amber-800"><Sun className="h-3.5 w-3.5" /> Dnevni rad</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <select value={p.danOd} onChange={(event) => update({ ...p, danOd: event.target.value })} className="rounded border border-slate-300 bg-white px-2 py-1">
                    {hours.map((h) => <option key={h}>{h}</option>)}
                  </select>
                  <span>–</span>
                  <strong>{p.nocOd}</strong>
                  <span className="text-xs text-slate-500">({dayLen} h)</span>
                </div>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <p className="flex items-center gap-1 text-xs font-semibold text-indigo-800"><Moon className="h-3.5 w-3.5" /> Noćni rad</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <select value={p.nocOd} onChange={(event) => update({ ...p, nocOd: event.target.value })} className="rounded border border-slate-300 bg-white px-2 py-1">
                    {hours.map((h) => <option key={h}>{h}</option>)}
                  </select>
                  <span>–</span>
                  <strong>{p.danOd}</strong>
                  <span className="text-xs text-slate-500">({nightLen} h)</span>
                </div>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">AI asistent</h2>
            <p className="mb-3 text-xs text-slate-500">
              Besplatni Google Gemini ključ: otvori aistudio.google.com/apikey, prijavi se Google računom, klikni „Create API key” i zalijepi ga ovdje. Ključ se sprema samo u ovom pregledniku.
            </p>
            <input
              type="password"
              value={aiKey}
              onChange={(event) => { setAiKeyState(event.target.value); setAiKey(event.target.value.trim()); }}
              placeholder="Gemini API ključ"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Obavijesti</h2>
          <p className="mb-2 text-xs text-slate-500">Za svaku vrstu roka: uključi/isključi i koliko dana prije isteka stiže podsjetnik</p>
          {grupe.map((g) => (
            <div key={g} className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              <div className="divide-y divide-slate-100">
                {obavijestTipovi.filter((t) => t.grupa === g).map((t) => {
                  const cfg = p.obavijesti[t.tip];
                  return (
                    <div key={t.tip} className="flex min-w-0 flex-wrap items-center gap-3 py-2">
                      <Toggle on={cfg.on} onChange={(value) => setTipValue(t.tip, { on: value })} />
                      <span className="min-w-0 flex-1 basis-[calc(100%_-_4rem)] text-sm text-slate-800 xl:basis-0">{t.label}</span>
                      <input
                        type="number"
                        min={0}
                        value={cfg.dana}
                        disabled={!cfg.on}
                        onChange={(event) => setTipValue(t.tip, { dana: Math.max(0, Number(event.target.value) || 0) })}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm disabled:opacity-40"
                      />
                      <span className="w-14 text-xs text-slate-400">dana prije</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
