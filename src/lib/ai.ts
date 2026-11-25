import {
  fetchFakture,
  fetchGradilista,
  fetchKooperanti,
  fetchRadnici,
  fetchRadnoVrijeme,
  fetchRokovi,
  fetchSviRadnikDokumenti,
  fetchSviVoziloDokumenti,
  fetchTroskovi,
  fetchVozila,
  iznosFakture,
} from '@/lib/api';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { requireCompany } from './company';

export const MODEL = 'gemini-3-flash-preview';

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] };
  }[];
  error?: string | { message?: string };
}

export class GeminiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GeminiRequestError';
  }
}

export type GeminiFeature = 'assistant' | 'kooperant-invoice' | 'troskovnik-import';

export async function generateGeminiContent(feature: GeminiFeature, request: Record<string, unknown>): Promise<GeminiResponse> {
  const { data, error } = await supabase.functions.invoke<GeminiResponse>('gemini-proxy', {
    body: { feature, request },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let message = error.message;
      try {
        const result = await error.context.json() as { error?: string | { message?: string } };
        if (typeof result.error === 'string') message = result.error;
        else if (result.error?.message) message = result.error.message;
      } catch {
        message = error.message;
      }
      throw new GeminiRequestError(message, error.context.status);
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('AI servis nije vratio odgovor.');
  if (typeof data.error === 'string') throw new Error(data.error);
  if (data.error?.message) throw new Error(data.error.message);
  return data;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  sources?: { title: string; uri: string }[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const SNAPSHOT_CACHE_MS = 5 * 60 * 1000;
let snapshotCache: { companyId: string; createdAt: number; promise: Promise<unknown> } | null = null;

export function invalidateAiSnapshot() {
  snapshotCache = null;
}

// Sažetak podataka iz programa koji se šalje AI-u kao kontekst
export function buildSnapshot(force = false) {
  const companyId = requireCompany().id;
  const now = Date.now();
  if (!force && snapshotCache?.companyId === companyId && now - snapshotCache.createdAt < SNAPSHOT_CACHE_MS) {
    return snapshotCache.promise;
  }
  const promise = createSnapshot();
  snapshotCache = { companyId, createdAt: now, promise };
  void promise.catch(() => {
    if (snapshotCache?.promise === promise) snapshotCache = null;
  });
  return promise;
}

async function createSnapshot() {
  const [gradilista, troskovi, fakture, rokovi, radnici, vozila, kooperanti, sati, radnikDokumenti, voziloDokumenti] = await Promise.all([
    fetchGradilista(),
    fetchTroskovi(),
    fetchFakture(),
    fetchRokovi(),
    fetchRadnici(),
    fetchVozila(),
    fetchKooperanti().catch(() => []),
    fetchRadnoVrijeme(),
    fetchSviRadnikDokumenti().catch(() => []),
    fetchSviVoziloDokumenti().catch(() => []),
  ]);

  const sum = <T,>(list: T[], pick: (item: T) => number) => round(list.reduce((s, i) => s + pick(i), 0));
  const workerNames = new Map(radnici.map((worker) => [
    worker.id,
    `${worker.ime} ${worker.prezime}`.trim(),
  ]));
  const siteNames = new Map(gradilista.map((site) => [site.id, site.naziv]));
  const hoursByWorker = new Map<string, typeof sati>();
  for (const row of sati) {
    const rows = hoursByWorker.get(row.radnik_id) ?? [];
    rows.push(row);
    hoursByWorker.set(row.radnik_id, rows);
  }
  const summarizeWorkerMonths = (rows: typeof sati) => {
    const byMonth = new Map<string, { sati: number; nocni_sati: number; gradilista: Set<string> }>();
    for (const row of rows) {
      const month = row.datum.slice(0, 7);
      const item = byMonth.get(month) ?? { sati: 0, nocni_sati: 0, gradilista: new Set<string>() };
      item.sati += Number(row.sati) || 0;
      item.nocni_sati += Number(row.nocni_sati) || 0;
      if (row.gradiliste_id) item.gradilista.add(siteNames.get(row.gradiliste_id) ?? row.gradiliste_id);
      byMonth.set(month, item);
    }
    return [...byMonth.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([mjesec, item]) => ({
        mjesec,
        sati: round(item.sati),
        nocni_sati: round(item.nocni_sati),
        gradilista: [...item.gradilista],
      }));
  };
  const summarizeWorkerSites = (rows: typeof sati) => {
    const bySite = new Map<string, number>();
    for (const row of rows) {
      const site = row.gradiliste_id ? siteNames.get(row.gradiliste_id) ?? 'Nepoznato gradilište' : 'Bez gradilišta';
      bySite.set(site, (bySite.get(site) ?? 0) + (Number(row.sati) || 0));
    }
    return [...bySite.entries()]
      .map(([gradiliste, hours]) => ({ gradiliste, sati: round(hours) }))
      .sort((left, right) => right.sati - left.sati);
  };
  const expiringDocuments = [
    ...radnikDokumenti
      .filter((document) => document.datum_do)
      .map((document) => ({
        tip: 'radnik',
        subjekt: workerNames.get(document.radnik_id) ?? 'Nepoznat djelatnik',
        naziv: document.naziv,
        istice: document.datum_do,
      })),
    ...voziloDokumenti
      .filter((document) => document.datum_do && document.vrsta !== 'servis')
      .map((document) => {
        const vehicle = vozila.find((item) => item.id === document.vozilo_id);
        return {
          tip: 'vozilo',
          subjekt: vehicle ? [vehicle.marka, vehicle.model].filter(Boolean).join(' ') : 'Nepoznato vozilo',
          naziv: document.naziv,
          istice: document.datum_do,
        };
      }),
  ].sort((left, right) => String(left.istice).localeCompare(String(right.istice)));

  return {
    danas: new Date().toISOString().slice(0, 10),
    valuta: 'EUR',
    gradilista: gradilista.map((g) => {
      const t = troskovi.filter((x) => x.gradiliste_id === g.id);
      const f = fakture.filter((x) => x.gradiliste_id === g.id);
      const byKat: Record<string, number> = {};
      t.forEach((x) => { byKat[x.kategorija] = round((byKat[x.kategorija] ?? 0) + x.iznos); });
      return {
        naziv: g.naziv,
        status: g.status,
        regija: g.regija,
        investitor: g.objekti?.investitori?.naziv ?? null,
        objekt: g.objekti?.naziv ?? null,
        pocetak: g.datum_pocetka,
        zavrsetak: g.datum_zavrsetka,
        ugovorena_vrijednost: g.ugovorena_vrijednost,
        predvidena_marza: g.predvidena_marza,
        troskovi_ukupno: sum(t, (x) => x.iznos),
        troskovi_po_kategoriji: byKat,
        radni_sati: sum(sati.filter((x) => x.gradiliste_id === g.id), (x) => x.sati),
        fakturirano: sum(f, iznosFakture),
        placeno: sum(f.filter((x) => x.status === 'placena'), iznosFakture),
        rokovi: rokovi.filter((r) => r.gradiliste_id === g.id).map((r) => ({ naziv: r.naziv, datum: r.datum, status: r.status })),
      };
    }),
    kooperanti: kooperanti.map((k) => ({
      naziv: k.naziv,
      djelatnost: k.djelatnost,
      troskovi_ukupno: sum(troskovi.filter((t) => t.kooperant_id === k.id), (t) => t.iznos),
    })),
    stavke_racuna_kooperanata: troskovi
      .filter((cost) => cost.kooperant_racun_id)
      .map((cost) => ({
        kooperant: cost.kooperanti?.naziv ?? 'Nepoznat kooperant',
        gradiliste: cost.gradilista?.naziv ?? 'Bez gradilišta',
        datum: cost.datum,
        broj_racuna: cost.broj_racuna ?? null,
        opis: cost.opis,
        kolicina: cost.kolicina ?? null,
        jedinica: cost.jedinica ?? null,
        jedinicna_cijena: cost.jedinicna_cijena ?? null,
        iznos: cost.iznos,
        placen: Boolean(cost.placen),
      })),
    radnici: radnici.map((r) => {
      const rows = hoursByWorker.get(r.id) ?? [];
      return {
        ime: `${r.ime} ${r.prezime}`.trim(),
        uloga: r.uloga,
        status: r.status,
        ukupno_sati: sum(rows, (row) => Number(row.sati) || 0),
        ukupno_nocni_sati: sum(rows, (row) => Number(row.nocni_sati) || 0),
        zadnji_datum_rada: rows[0]?.datum ?? null,
        mjeseci: summarizeWorkerMonths(rows),
        gradilista: summarizeWorkerSites(rows),
      };
    }),
    vozila: vozila.map((v) => ({ model: [v.marka, v.model].filter(Boolean).join(' '), status: v.status, kilometraza: v.kilometraza })),
    dokumenti_s_istekom: expiringDocuments,
  };
}

export async function askAi(history: ChatMessage[], snapshot: unknown, webSearch: boolean): Promise<ChatMessage> {
  const system = [
    'Ti si poslovni asistent GradTech ERP sustava za građevinske tvrtke. Odgovaraj na hrvatskom, sažeto i s konkretnim brojkama u EUR.',
    'FORMAT ODGOVORA (markdown): počni jednom kratkom rečenicom zaključka, zatim koristi kratke naslove (###) s emojijem, popise s crticama, **podebljane** ključne brojke i iznose, a za usporedbe tablice. Za status koristi ikone: ✅ dobro, ⚠️ pozor, 🔴 problem, 💰 novac, 📅 rokovi, 🏗️ gradilišta, 🚚 vozila, 👷 radnici. Završi s 💡 kratkim prijedlogom što napraviti. Ne piši dugačke odlomke.',
    'Za pitanja o firmi koristi isključivo priloženi JSON s podacima iz programa; ako podatka nema, to reci.',
    'Kod pitanja o cijenama kooperanata koristi stavke računa iz JSON-a. Navedi naziv kooperanta, gradilište, količinu/jedinicu, jediničnu cijenu i datum kad su dostupni. Nemoj zaključivati cijenu iz opisa ako strukturirana jedinična cijena nedostaje.',
    webSearch ? 'Za vanjske informacije (cijene materijala, propisi, tržište) koristi web pretragu i navedi da su to vanjski podaci.' : 'Web pretraga je isključena.',
    `PODACI IZ PROGRAMA:\n${JSON.stringify(snapshot)}`,
  ].join('\n\n');

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: history.slice(-8).map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
  };
  if (webSearch) body.tools = [{ google_search: {} }];

  let json: GeminiResponse;
  try {
    json = await generateGeminiContent('assistant', body);
  } catch (reason) {
    if (reason instanceof GeminiRequestError && reason.status === 429) {
      throw new Error('Dosegnut je besplatni limit zahtjeva. Pričekaj minutu pa pokušaj ponovno.');
    }
    throw reason;
  }
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  const chunks = (candidate?.groundingMetadata?.groundingChunks ?? []) as { web?: { title?: string; uri?: string } }[];
  const sources = chunks.filter((c) => c.web?.uri).map((c) => ({ title: c.web?.title ?? c.web?.uri ?? '', uri: c.web?.uri ?? '' }));
  return { role: 'model', text: text || 'Nema odgovora.', sources };
}
