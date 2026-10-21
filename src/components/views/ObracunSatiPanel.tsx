import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calculator } from 'lucide-react';
import type { OdsustvoVrsta, Radnik, RadnikOdsustvo } from '@/types';
import {
  addOdsustvo,
  deleteOdsustvo,
  fetchObracunRadnoVrijeme,
  fetchOdsustvaRaspon,
  fetchRadnici,
  updateRadnik,
  type ObracunRadnoVrijemeRow,
} from '@/lib/api';
import {
  OBRACUN_KATEGORIJE,
  PRAVO_POLJA,
  computeObracun,
  mjesecRaspon,
  pravaRadnika,
  type ObracunKategorija,
} from '@/lib/obracunSati';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextInput, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const VRSTE_ODSUSTVA: { value: OdsustvoVrsta; label: string }[] = [
  { value: 'godisnji', label: 'Godišnji odmor' },
  { value: 'bolovanje', label: 'Bolovanje' },
  { value: 'praznik', label: 'Praznik (dodatni slobodan dan)' },
];

const eur = (n: number) => n.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const broj = (n: number) => n.toLocaleString('hr-HR', { maximumFractionDigits: 1 });
const fmtDatum = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('hr-HR');

const trenutniMjesec = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const pomakniMjesec = (mjesec: string, delta: number) => {
  const [y, m] = mjesec.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function ObracunSatiPanel({ canEdit }: { canEdit: boolean }) {
  const [mjesec, setMjesec] = useState(trenutniMjesec);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [unosi, setUnosi] = useState<ObracunRadnoVrijemeRow[]>([]);
  const [odsustva, setOdsustva] = useState<RadnikOdsustvo[]>([]);
  const [odsustvaDostupna, setOdsustvaDostupna] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingPravo, setSavingPravo] = useState<string | null>(null);
  const [odsustvoForm, setOdsustvoForm] = useState<{ radnik_id: string; vrsta: OdsustvoVrsta; datum_od: string; datum_do: string; napomena: string } | null>(null);
  const [savingOdsustvo, setSavingOdsustvo] = useState(false);
  const [deleteOdsustvoId, setDeleteOdsustvoId] = useState<string | null>(null);

  const raspon = useMemo(() => mjesecRaspon(mjesec), [mjesec]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, rv] = await Promise.all([fetchRadnici(), fetchObracunRadnoVrijeme(raspon.od, raspon.do)]);
      setRadnici(r);
      setUnosi(rv);
      try {
        setOdsustva(await fetchOdsustvaRaspon(raspon.od, raspon.do));
        setOdsustvaDostupna(true);
      } catch {
        setOdsustva([]);
        setOdsustvaDostupna(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju obračuna');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raspon.od, raspon.do]);

  const migracijaPokrenuta = radnici.length === 0 || typeof radnici[0].pravo_nocni === 'boolean';
  const portalMigracija = radnici.length === 0 || typeof radnici[0].portal_vrijeme === 'boolean';

  const redovi = useMemo(() => {
    return radnici
      .map((r) => {
        const prava = pravaRadnika(r);
        const obracun = computeObracun({
          od: raspon.od,
          do: raspon.do,
          unosi: unosi.filter((u) => u.radnik_id === r.id),
          odsustva: odsustva.filter((o) => o.radnik_id === r.id),
          prava,
          cijene: r,
        });
        const imaPodataka = obracun.redovniSati > 0 || odsustva.some((o) => o.radnik_id === r.id);
        return { radnik: r, prava, obracun, imaPodataka };
      })
      .filter((row) => row.radnik.status !== 'neaktivan' || row.imaPodataka)
      .sort((a, b) => `${a.radnik.prezime} ${a.radnik.ime}`.localeCompare(`${b.radnik.prezime} ${b.radnik.ime}`, 'hr'));
  }, [radnici, unosi, odsustva, raspon.od, raspon.do]);

  const ukupno = useMemo(() => {
    const sum = { redovniSati: 0, iznos: 0 } as { redovniSati: number; iznos: number } & Partial<Record<ObracunKategorija, number>>;
    for (const row of redovi) {
      sum.redovniSati += row.obracun.redovniSati;
      sum.iznos += row.obracun.iznosi.ukupno;
      for (const k of OBRACUN_KATEGORIJE) {
        if (row.prava[k.key]) sum[k.key] = (sum[k.key] ?? 0) + row.obracun.kolicine[k.key];
      }
    }
    return sum;
  }, [redovi]);

  const togglePortalVrijeme = async (radnik: Radnik, value: boolean) => {
    setSavingPravo(`${radnik.id}:portal`);
    setError(null);
    try {
      await updateRadnik(radnik.id, { portal_vrijeme: value });
      setRadnici((prev) => prev.map((r) => (r.id === radnik.id ? { ...r, portal_vrijeme: value } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju postavke portala');
    } finally {
      setSavingPravo(null);
    }
  };

  const setPortalVrijemeSvima = async (value: boolean) => {
    const zaPromjenu = radnici.filter((r) => r.portal_vrijeme !== value);
    if (zaPromjenu.length === 0) return;
    setSavingPravo('portal:svi');
    setError(null);
    try {
      const results = await Promise.allSettled(zaPromjenu.map((r) => updateRadnik(r.id, { portal_vrijeme: value })));
      const spremljeni = new Set(zaPromjenu.filter((_, i) => results[i].status === 'fulfilled').map((r) => r.id));
      setRadnici((prev) => prev.map((r) => (spremljeni.has(r.id) ? { ...r, portal_vrijeme: value } : r)));
      if (spremljeni.size < zaPromjenu.length) {
        setError(`Postavka nije spremljena za ${zaPromjenu.length - spremljeni.size} radnika. Pokušajte ponovno.`);
      }
    } finally {
      setSavingPravo(null);
    }
  };

  const togglePravo = async (radnik: Radnik, key: ObracunKategorija, value: boolean) => {
    const polje = PRAVO_POLJA[key];
    setSavingPravo(`${radnik.id}:${key}`);
    setError(null);
    try {
      await updateRadnik(radnik.id, { [polje]: value });
      setRadnici((prev) => prev.map((r) => (r.id === radnik.id ? { ...r, [polje]: value } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju prava');
    } finally {
      setSavingPravo(null);
    }
  };

  const saveOdsustvo = async () => {
    if (!odsustvoForm || !odsustvoForm.radnik_id || !odsustvoForm.datum_od || !odsustvoForm.datum_do) return;
    if (odsustvoForm.datum_do < odsustvoForm.datum_od) {
      setError('Datum završetka ne može biti prije datuma početka.');
      return;
    }
    setSavingOdsustvo(true);
    try {
      await addOdsustvo({
        radnik_id: odsustvoForm.radnik_id,
        vrsta: odsustvoForm.vrsta,
        datum_od: odsustvoForm.datum_od,
        datum_do: odsustvoForm.datum_do,
        napomena: odsustvoForm.napomena.trim() || null,
      });
      setOdsustvoForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju odsustva');
    } finally {
      setSavingOdsustvo(false);
    }
  };

  const removeOdsustvo = async () => {
    if (!deleteOdsustvoId) return;
    try {
      await deleteOdsustvo(deleteOdsustvoId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju odsustva');
    }
  };

  const imeRadnika = (id: string) => {
    const r = radnici.find((x) => x.id === id);
    return r ? `${r.ime} ${r.prezime}` : '—';
  };

  const mjesecNaziv = new Date(`${raspon.od}T00:00:00`).toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMjesec((m) => pomakniMjesec(m, -1))} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" aria-label="Prethodni mjesec">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="month"
            value={mjesec}
            onChange={(e) => e.target.value && setMjesec(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
          <button type="button" onClick={() => setMjesec((m) => pomakniMjesec(m, 1))} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" aria-label="Sljedeći mjesec">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-2 text-sm font-medium capitalize text-slate-600">{mjesecNaziv}</span>
        </div>
        {canEdit && odsustvaDostupna && (
          <button
            type="button"
            onClick={() => setOdsustvoForm({ radnik_id: '', vrsta: 'godisnji', datum_od: raspon.od, datum_do: raspon.od, napomena: '' })}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700"
          >
            <Plus className="h-4 w-4" />
            Upiši godišnji / bolovanje / praznik
          </button>
        )}
      </div>

      <p className="mb-4 text-sm text-slate-500">
        Kvačicom odobravate radniku pravo na kategoriju. Obračunava se samo ono što je odobreno; noćni rad i teren
        bez odobrenja ne idu ni u trošak gradilišta (za naloge zaključene nakon promjene).
      </p>

      {!migracijaPokrenuta && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pokrenite migraciju <code>20261021130000_obracun_sati.sql</code> u Supabaseu da bi se odobrenja mogla spremati.
          Do tada vrijedi dosadašnje pravilo: pravo ima tko ima upisanu cijenu.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
        <span className="font-medium text-slate-700">Kartica „Vrijeme” u Portalu djelatnika:</span>
        {portalMigracija ? (
          <>
            <span className="text-slate-500">
              vidi {radnici.filter((r) => r.portal_vrijeme !== false && r.status !== 'neaktivan').length} od {radnici.filter((r) => r.status !== 'neaktivan').length} aktivnih radnika
            </span>
            {canEdit && (
              <div className="ml-auto flex gap-2">
                <button type="button" disabled={savingPravo !== null} onClick={() => void setPortalVrijemeSvima(true)} className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                  Uključi svima
                </button>
                <button type="button" disabled={savingPravo !== null} onClick={() => void setPortalVrijemeSvima(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Isključi svima
                </button>
              </div>
            )}
          </>
        ) : (
          <span className="text-amber-700">pokrenite migraciju <code>20261021150000_portal_vrijeme_vidljivost.sql</code> (do tada je vide svi).</span>
        )}
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Radnik</th>
                <th className="px-4 py-3 text-center">Portal: Vrijeme</th>
                <th className="px-4 py-3 text-right">Redovni rad</th>
                {OBRACUN_KATEGORIJE.map((k) => (
                  <th key={k.key} className="px-4 py-3 text-center">{k.label}</th>
                ))}
                <th className="px-4 py-3 text-right">Ukupno</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {redovi.length === 0 && (
                <tr>
                  <td colSpan={OBRACUN_KATEGORIJE.length + 4} className="px-4 py-10 text-center text-sm text-slate-400">
                    Nema radnika za obračun.
                  </td>
                </tr>
              )}
              {redovi.map(({ radnik, prava, obracun }) => (
                <tr key={radnik.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {radnik.ime} {radnik.prezime}
                    <div className="text-xs font-normal text-slate-400">{radnik.uloga}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <label className={`inline-flex items-center gap-1.5 text-xs ${canEdit && portalMigracija ? 'cursor-pointer' : 'cursor-default'} ${radnik.portal_vrijeme !== false ? 'text-emerald-700' : 'text-slate-400'}`}>
                      <input
                        type="checkbox"
                        checked={radnik.portal_vrijeme !== false}
                        disabled={!canEdit || !portalMigracija || savingPravo !== null}
                        onChange={(e) => void togglePortalVrijeme(radnik, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      {radnik.portal_vrijeme !== false ? 'Vidi' : 'Skriveno'}
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <div className="font-semibold text-slate-900">{broj(obracun.redovniSati)} h</div>
                    <div className="text-xs text-slate-400">{eur(obracun.iznosi.redovni)}</div>
                  </td>
                  {OBRACUN_KATEGORIJE.map((k) => {
                    const odobreno = prava[k.key];
                    const kolicina = obracun.kolicine[k.key];
                    const busy = savingPravo === `${radnik.id}:${k.key}`;
                    return (
                      <td key={k.key} className={`px-4 py-3 text-center text-sm ${odobreno ? '' : 'bg-slate-50/70'}`}>
                        <label className={`inline-flex items-center gap-1.5 text-xs ${canEdit && migracijaPokrenuta ? 'cursor-pointer' : 'cursor-default'} ${odobreno ? 'text-emerald-700' : 'text-slate-400'}`}>
                          <input
                            type="checkbox"
                            checked={odobreno}
                            disabled={!canEdit || !migracijaPokrenuta || busy}
                            onChange={(e) => void togglePravo(radnik, k.key, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          {odobreno ? 'Odobreno' : 'Nije odobreno'}
                        </label>
                        <div className={`mt-1 font-semibold ${odobreno ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                          {broj(kolicina)} {k.jedinica === 'h' ? 'h' : kolicina === 1 ? 'dan' : 'dana'}
                        </div>
                        {odobreno && <div className="text-xs text-slate-400">{eur(obracun.iznosi[k.key])}</div>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">{eur(obracun.iznosi.ukupno)}</td>
                </tr>
              ))}
            </tbody>
            {redovi.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
                  <td className="px-4 py-3">Ukupno (odobreno)</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right">{broj(ukupno.redovniSati)} h</td>
                  {OBRACUN_KATEGORIJE.map((k) => (
                    <td key={k.key} className="px-4 py-3 text-center">
                      {broj(ukupno[k.key] ?? 0)} {k.jedinica === 'h' ? 'h' : 'dana'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">{eur(ukupno.iznos)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Calculator className="h-4 w-4 text-slate-400" />
          Godišnji, bolovanje i praznici u mjesecu
        </h2>
        {!odsustvaDostupna ? (
          <p className="text-sm text-amber-700">Tablica odsustava nije dostupna. Pokrenite migraciju <code>20261021130000_obracun_sati.sql</code>.</p>
        ) : odsustva.length === 0 ? (
          <p className="text-sm text-slate-400">Nema upisanih odsustava. Državni praznici na radni dan računaju se automatski.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {odsustva.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-slate-900">{imeRadnika(o.radnik_id)}</span>
                  <span className="ml-2 text-slate-500">
                    {VRSTE_ODSUSTVA.find((v) => v.value === o.vrsta)?.label ?? o.vrsta} · {fmtDatum(o.datum_od)} – {fmtDatum(o.datum_do)}
                  </span>
                  {o.napomena && <span className="ml-2 text-xs text-slate-400">{o.napomena}</span>}
                </div>
                {canEdit && (
                  <button type="button" onClick={() => setDeleteOdsustvoId(o.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Obriši odsustvo">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={odsustvoForm !== null}
        onClose={() => setOdsustvoForm(null)}
        title="Upiši odsustvo"
        footer={
          <>
            <button type="button" onClick={() => setOdsustvoForm(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Odustani
            </button>
            <button
              type="button"
              onClick={() => void saveOdsustvo()}
              disabled={savingOdsustvo || !odsustvoForm?.radnik_id}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {savingOdsustvo ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        {odsustvoForm && (
          <div className="space-y-4">
            <Field label="Radnik *">
              <Select value={odsustvoForm.radnik_id} onChange={(e) => setOdsustvoForm({ ...odsustvoForm, radnik_id: e.target.value })}>
                <option value="">— Odaberi —</option>
                {radnici.filter((r) => r.status !== 'neaktivan').map((r) => (
                  <option key={r.id} value={r.id}>{r.ime} {r.prezime}</option>
                ))}
              </Select>
            </Field>
            <Field label="Vrsta">
              <Select value={odsustvoForm.vrsta} onChange={(e) => setOdsustvoForm({ ...odsustvoForm, vrsta: e.target.value as OdsustvoVrsta })}>
                {VRSTE_ODSUSTVA.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Od">
                <TextInput type="date" value={odsustvoForm.datum_od} onChange={(e) => setOdsustvoForm({ ...odsustvoForm, datum_od: e.target.value, datum_do: odsustvoForm.datum_do < e.target.value ? e.target.value : odsustvoForm.datum_do })} />
              </Field>
              <Field label="Do">
                <TextInput type="date" value={odsustvoForm.datum_do} min={odsustvoForm.datum_od} onChange={(e) => setOdsustvoForm({ ...odsustvoForm, datum_do: e.target.value })} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">Broje se samo radni dani (pon–pet). Državni praznici ne ulaze u godišnji.</p>
            <Field label="Napomena">
              <Textarea rows={2} value={odsustvoForm.napomena} onChange={(e) => setOdsustvoForm({ ...odsustvoForm, napomena: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOdsustvoId !== null}
        onClose={() => setDeleteOdsustvoId(null)}
        onConfirm={removeOdsustvo}
        title="Obrisati odsustvo?"
        message="Obračun za mjesec će se ponovno izračunati."
      />
    </div>
  );
}
