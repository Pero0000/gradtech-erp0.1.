import {
  fetchFakture,
  fetchGradilista,
  fetchKooperanti,
  fetchRadnici,
  fetchRadnoVrijeme,
  fetchRokovi,
  fetchTroskovi,
  fetchVozila,
  iznosFakture,
} from '@/lib/api';
import { loadObavijesti } from '@/lib/obavijesti';
import { loadPostavke } from '@/lib/postavke';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

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

// Sažetak podataka iz programa koji se šalje AI-u kao kontekst
export async function buildSnapshot() {
  const [gradilista, troskovi, fakture, rokovi, radnici, vozila, kooperanti, sati] = await Promise.all([
    fetchGradilista(),
    fetchTroskovi(),
    fetchFakture(),
    fetchRokovi(),
    fetchRadnici(),
    fetchVozila(),
    fetchKooperanti().catch(() => []),
    fetchRadnoVrijeme(),
  ]);
  const obavijesti = await loadObavijesti(loadPostavke()).catch(() => []);

  const sum = <T,>(list: T[], pick: (item: T) => number) => round(list.reduce((s, i) => s + pick(i), 0));

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
    radnici: radnici.map((r) => ({ ime: `${r.ime} ${r.prezime}`, uloga: r.uloga, status: r.status })),
    vozila: vozila.map((v) => ({ model: [v.marka, v.model].filter(Boolean).join(' '), status: v.status, kilometraza: v.kilometraza })),
    otvorene_obavijesti: obavijesti.map((o) => ({ vrsta: o.tipLabel, stavka: o.title, detalj: o.detail, datum: o.datum, hitnost: o.level })),
  };
}

export async function askAi(history: ChatMessage[], snapshot: unknown, webSearch: boolean): Promise<ChatMessage> {
  const system = [
    'Ti si poslovni asistent građevinske tvrtke TM Color. Odgovaraj na hrvatskom, sažeto i s konkretnim brojkama u EUR.',
    'FORMAT ODGOVORA (markdown): počni jednom kratkom rečenicom zaključka, zatim koristi kratke naslove (###) s emojijem, popise s crticama, **podebljane** ključne brojke i iznose, a za usporedbe tablice. Za status koristi ikone: ✅ dobro, ⚠️ pozor, 🔴 problem, 💰 novac, 📅 rokovi, 🏗️ gradilišta, 🚚 vozila, 👷 radnici. Završi s 💡 kratkim prijedlogom što napraviti. Ne piši dugačke odlomke.',
    'Za pitanja o firmi koristi isključivo priloženi JSON s podacima iz programa; ako podatka nema, to reci.',
    'Kod pitanja o cijenama kooperanata koristi stavke računa iz JSON-a. Navedi naziv kooperanta, gradilište, količinu/jedinicu, jediničnu cijenu i datum kad su dostupni. Nemoj zaključivati cijenu iz opisa ako strukturirana jedinična cijena nedostaje.',
    webSearch ? 'Za vanjske informacije (cijene materijala, propisi, tržište) koristi web pretragu i navedi da su to vanjski podaci.' : 'Web pretraga je isključena.',
    `PODACI IZ PROGRAMA:\n${JSON.stringify(snapshot)}`,
  ].join('\n\n');

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
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
