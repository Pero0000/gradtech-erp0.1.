import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, FileText, Paperclip, Truck } from 'lucide-react';
import {
  fetchMojeRadnoVrijeme,
  fetchMojiObracunPodaci,
  fetchNalogDokumenti,
  fetchRadnikDokumenti,
  fetchRasporedObjave,
  type MobileRadniNalog,
  type MojeRadnoVrijeme,
  type MojiObracunPodaci,
  type NalogDokument,
  type RasporedObjava,
  type RasporedObjavaVozilo,
} from '@/lib/api';
import { OBRACUN_KATEGORIJE, computeObracun } from '@/lib/obracunSati';
import { dokumentVrste } from '@/components/views/RadnikDokumenti';
import type { RadnikDokument } from '@/types';

export type WorkerPortalTab = 'nalozi' | 'raspored' | 'vrijeme' | 'dokumenti';

const errText = (reason: unknown, fallback: string) =>
  reason && typeof reason === 'object' && 'message' in reason ? String((reason as { message: unknown }).message) : fallback;

const formatDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('hr-HR');
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{text}</p>;
}

function ErrorBox({ text }: { text: string }) {
  return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{text}</p>;
}

export function WorkerScheduleTab({ radnikId }: { radnikId: string | null }) {
  const [objave, setObjave] = useState<RasporedObjava[]>([]);
  const [selectedDatum, setSelectedDatum] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (initial: boolean) => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      try {
        const data = await fetchRasporedObjave(isoDate(yesterday));
        if (!active) return;
        setObjave(data);
        setError(null);
        const today = isoDate(new Date());
        setSelectedDatum((current) => current && data.some((item) => item.datum === current)
          ? current
          : (data.find((item) => item.datum >= today) ?? data[data.length - 1])?.datum ?? null);
      } catch (reason) {
        if (active && initial) setError(errText(reason, 'Raspored nije moguće učitati.'));
      } finally {
        if (active && initial) setLoading(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (loading) return <Empty text="Učitavanje rasporeda…" />;
  if (error) return <ErrorBox text={error} />;
  if (objave.length === 0) return <Empty text="Ured još nije poslao raspored." />;

  const objava = objave.find((item) => item.datum === selectedDatum) ?? objave[0];
  // Vozilo prijavljenog radnika prikazuje se prvo.
  const vozila = [...(objava.podaci?.vozila ?? [])].sort((a, b) =>
    Number(b.radnici.some((r) => r.id === radnikId)) - Number(a.radnici.some((r) => r.id === radnikId)));

  return (
    <div className="space-y-3">
      {objave.length > 1 && (
        <div className="flex min-w-0 flex-col gap-2 pb-1 xl:flex-row xl:flex-wrap">
          {objave.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelectedDatum(item.datum)} className={`min-h-10 shrink-0 rounded-xl px-3 text-xs font-bold capitalize ${item.datum === objava.datum ? 'bg-sky-700 text-white' : 'bg-white text-slate-600 shadow-sm'}`}>
              {new Date(`${item.datum}T00:00:00`).toLocaleDateString('hr-HR', { weekday: 'short', day: 'numeric', month: 'numeric' })}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl bg-slate-900 p-4 text-white">
        <p className="text-lg font-bold capitalize">{new Date(`${objava.datum}T00:00:00`).toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p className="text-xs text-slate-400">Poslano {new Date(objava.poslano_at).toLocaleString('hr-HR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <RasporedVozilaPreview vozila={vozila} radnikId={radnikId} />
    </div>
  );
}

/** Kartice vozila kakve radnik vidi u portalu; koristi ih i web kartica „Pošalji raspored”. */
export function RasporedVozilaPreview({ vozila, radnikId = null }: { vozila: RasporedObjavaVozilo[]; radnikId?: string | null }) {
  if (vozila.length === 0) return <Empty text="Raspored za ovaj dan je prazan." />;
  return (
    <div className="space-y-3">
      {vozila.map((vozilo, index) => {
        const mine = radnikId !== null && vozilo.radnici.some((r) => r.id === radnikId);
        return (
          <article key={`${vozilo.naziv}-${index}`} className={`rounded-2xl border-2 p-3 shadow-sm ${mine ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-200'}`}>
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 shrink-0 text-slate-700" />
              <span className="min-w-0 flex-1 truncate rounded border border-slate-800 bg-amber-200 px-2 py-1 text-center text-sm font-bold uppercase text-slate-900">
                {vozilo.naziv || 'Vozilo'}
              </span>
              {mine && <span className="shrink-0 rounded-full bg-sky-700 px-2 py-0.5 text-[10px] font-bold text-white">TVOJE VOZILO</span>}
            </div>
            {vozilo.vrijeme && <p className="mt-2 rounded bg-yellow-300 px-2 py-1 text-sm font-semibold text-red-600">{vozilo.vrijeme}</p>}
            <div className="mt-2 rounded-xl bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Gradilište</p>
              {vozilo.gradilista.length === 0 ? <p className="text-sm text-slate-400">—</p> : vozilo.gradilista.map((site, siteIndex) => (
                <p key={siteIndex} className={`text-sm font-semibold ${site.ostalo ? 'text-pink-500' : 'text-blue-800'}`}>{site.naziv}</p>
              ))}
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Radnici</p>
              {vozilo.radnici.length === 0 ? <p className="text-sm text-slate-400">—</p> : vozilo.radnici.map((worker) => (
                <p key={worker.id} className={`text-sm ${worker.id === radnikId ? 'font-bold text-sky-800' : 'font-medium text-emerald-700'}`}>{worker.ime}</p>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** offset 0 = tekući mjesec (do danas), 1 = prošli mjesec, … */
function mjesecRange(offset: number): [string, string] {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - offset, 1);
  const end = offset === 0 ? today : new Date(today.getFullYear(), today.getMonth() - offset + 1, 0);
  return [isoDate(start), isoDate(end)];
}

function mjesecNaziv(offset: number) {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth() - offset, 1).toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
}

const MJESECI_POVIJEST = 24;

export function WorkerTimeTab() {
  const [period, setPeriod] = useState(0);
  const [rows, setRows] = useState<MojeRadnoVrijeme[]>([]);
  const [obracunPodaci, setObracunPodaci] = useState<MojiObracunPodaci | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const [od, doo] = mjesecRange(period);
    setLoading(true);
    setError(null);
    void Promise.all([fetchMojeRadnoVrijeme(od, doo), fetchMojiObracunPodaci(od, doo)])
      .then(([data, podaci]) => {
        if (!active) return;
        setRows(data);
        setObracunPodaci(podaci);
      })
      .catch((reason: unknown) => { if (active) setError(errText(reason, 'Radno vrijeme nije moguće učitati.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + (row.sati ?? 0), 0), [rows]);
  const days = useMemo(() => new Set(rows.map((row) => row.datum)).size, [rows]);

  // Radnik vidi samo kategorije koje su mu odobrene, i to samo sate/dane (bez iznosa).
  const kategorije = useMemo(() => {
    const prava = obracunPodaci?.prava;
    if (!prava) return [];
    const [od, doo] = mjesecRange(period);
    const obracun = computeObracun({
      od,
      do: doo,
      unosi: rows.map((row) => ({ datum: row.datum, sati: row.sati ?? 0, nocni_sati: Number(row.nocni_sati) || 0, teren: Boolean(row.teren) })),
      odsustva: obracunPodaci.odsustva,
      prava,
    });
    return OBRACUN_KATEGORIJE.filter((k) => prava[k.key]).map((k) => ({ ...k, kolicina: obracun.kolicine[k.key] }));
  }, [obracunPodaci, rows, period]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setPeriod((value) => Math.min(value + 1, MJESECI_POVIJEST))}
          disabled={period >= MJESECI_POVIJEST}
          aria-label="Prethodni mjesec"
          className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-slate-700 active:bg-slate-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Mjesec</span>
          <select
            value={period}
            onChange={(event) => setPeriod(Number(event.target.value))}
            className="min-h-10 w-full rounded-xl border-0 bg-transparent text-center text-sm font-bold capitalize text-slate-900"
          >
            {Array.from({ length: MJESECI_POVIJEST + 1 }, (_, offset) => (
              <option key={offset} value={offset}>{mjesecNaziv(offset)}{offset === 0 ? ' (tekući)' : ''}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setPeriod((value) => Math.max(value - 1, 0))}
          disabled={period === 0}
          aria-label="Sljedeći mjesec"
          className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-slate-700 active:bg-slate-100 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid min-w-0 grid-cols-1 xl:grid-cols-2 gap-2">
        <div className="rounded-2xl bg-slate-900 p-4 text-white">
          <p className="text-2xl font-bold">{total.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} h</p>
          <p className="text-xs text-slate-400">ukupno sati</p>
        </div>
        <div className="rounded-2xl bg-slate-900 p-4 text-white">
          <p className="text-2xl font-bold">{days}</p>
          <p className="text-xs text-slate-400">radnih dana</p>
        </div>
      </div>
      {!loading && !error && kategorije.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 xl:grid-cols-2 gap-2 2xl:grid-cols-3">
          {kategorije.map((k) => (
            <div key={k.key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-lg font-bold text-slate-900">
                {k.kolicina.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} {k.jedinica === 'h' ? 'h' : k.kolicina === 1 ? 'dan' : 'dana'}
              </p>
              <p className="text-xs text-slate-500">{k.label}</p>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && obracunPodaci && obracunPodaci.odsustva.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Godišnji, bolovanje, praznici</p>
          <ul className="space-y-1 text-sm text-slate-700">
            {obracunPodaci.odsustva.map((o) => (
              <li key={o.id}>
                {o.vrsta === 'godisnji' ? 'Godišnji' : o.vrsta === 'bolovanje' ? 'Bolovanje' : 'Praznik'} · {formatDate(o.datum_od)} – {formatDate(o.datum_do)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {loading ? <Empty text="Učitavanje radnog vremena…" /> : error ? <ErrorBox text={error} /> : rows.length === 0 ? (
        <Empty text="Nema evidentiranog radnog vremena u odabranom mjesecu." />
      ) : rows.map((row, index) => (
        <article key={`${row.izvor}-${row.nalog_id ?? ''}-${row.datum}-${index}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{formatDate(row.datum)}</p>
            <p className="text-sm text-slate-600">{row.gradiliste_naziv ?? 'Bez gradilišta'}{row.nalog_broj ? ` · ${row.nalog_broj}` : ''}</p>
            {row.vrijeme_od && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" /> {row.vrijeme_od.slice(0, 5)} – {row.vrijeme_do ? row.vrijeme_do.slice(0, 5) : 'u tijeku'}
              </p>
            )}
            {row.napomena && <p className="mt-1 text-xs text-slate-500">{row.napomena}</p>}
            {(row.teren || Number(row.nocni_sati) > 0) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {row.teren && obracunPodaci?.prava?.teren && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Teren</span>}
                {Number(row.nocni_sati) > 0 && obracunPodaci?.prava?.nocni && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                    Noćni {Number(row.nocni_sati).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} h
                  </span>
                )}
              </div>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-sky-50 px-3 py-1 text-sm font-bold text-sky-800">
            {row.sati === null ? '—' : `${row.sati.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} h`}
          </span>
        </article>
      ))}
    </div>
  );
}

function documentStatus(document: RadnikDokument) {
  if (!document.datum_do) return null;
  const today = isoDate(new Date());
  if (document.datum_do < today) return { text: 'Istekao', className: 'bg-red-100 text-red-800' };
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  if (document.datum_do <= isoDate(soon)) return { text: 'Uskoro ističe', className: 'bg-amber-100 text-amber-800' };
  return { text: 'Važeći', className: 'bg-emerald-100 text-emerald-800' };
}

export function WorkerDocumentsTab({ radnikId, orders }: { radnikId: string; orders: MobileRadniNalog[] }) {
  const [personal, setPersonal] = useState<RadnikDokument[]>([]);
  const [orderDocs, setOrderDocs] = useState<Array<{ order: MobileRadniNalog; docs: NalogDokument[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const orderKey = orders.map((order) => order.id).join(',');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      fetchRadnikDokumenti(radnikId),
      Promise.all(orders.map(async (order) => ({ order, docs: await fetchNalogDokumenti(order.id) }))),
    ])
      .then(([own, byOrder]) => {
        if (!active) return;
        setPersonal(own);
        setOrderDocs(byOrder.filter((entry) => entry.docs.length > 0));
      })
      .catch((reason: unknown) => { if (active) setError(errText(reason, 'Dokumente nije moguće učitati.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // orderKey prati promjenu popisa naloga bez ponovnog učitavanja pri svakom osvježavanju.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radnikId, orderKey]);

  if (loading) return <Empty text="Učitavanje dokumenata…" />;
  if (error) return <ErrorBox text={error} />;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="px-1 text-sm font-bold uppercase tracking-wide text-slate-500">Osobni dokumenti</h3>
        {personal.length === 0 ? <Empty text="Nema osobnih dokumenata." /> : personal.map((document) => {
          const state = documentStatus(document);
          return (
            <article key={document.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-sky-700">{dokumentVrste[document.vrsta] ?? document.vrsta}</p>
                  <h4 className="font-bold text-slate-900">{document.naziv}</h4>
                  {(document.datum_od || document.datum_do) && (
                    <p className="mt-1 text-xs text-slate-500">
                      {document.datum_od ? formatDate(document.datum_od) : '—'} – {document.datum_do ? formatDate(document.datum_do) : 'bez roka'}
                    </p>
                  )}
                </div>
                {state && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${state.className}`}>{state.text}</span>}
              </div>
              {document.url && (
                <a href={document.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">
                  <Paperclip className="h-4 w-4" /> Otvori dokument
                </a>
              )}
            </article>
          );
        })}
      </section>
      <section className="space-y-2">
        <h3 className="px-1 text-sm font-bold uppercase tracking-wide text-slate-500">Dokumenti uz naloge</h3>
        {orderDocs.length === 0 ? <Empty text="Na tvojim nalozima nema priloženih dokumenata." /> : orderDocs.map(({ order, docs }) => (
          <article key={order.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-mono text-xs font-semibold text-indigo-600">{order.broj}</p>
            <h4 className="font-bold text-slate-900">{order.naslov}</h4>
            <ul className="mt-2 space-y-1">
              {docs.map((document) => (
                <li key={document.id}>
                  <a href={document.url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-sky-800">
                    <FileText className="h-4 w-4 shrink-0" /> <span className="truncate">{document.naziv}</span>
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}
