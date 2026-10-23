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
import { companyStorage } from './company';

const KEY_STORAGE = 'tm_gemini_key';
export const MODEL = 'gemini-3-flash-preview';

export const getAiKey = () => companyStorage.getItem(KEY_STORAGE) ?? '';
export const setAiKey = (key: string) => (key ? companyStorage.setItem(KEY_STORAGE, key) : companyStorage.removeItem(KEY_STORAGE));

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
    radnici: radnici.map((r) => ({ ime: `${r.ime} ${r.prezime}`, uloga: r.uloga, status: r.status })),
    vozila: vozila.map((v) => ({ model: [v.marka, v.model].filter(Boolean).join(' '), status: v.status, kilometraza: v.kilometraza })),
    otvorene_obavijesti: obavijesti.map((o) => ({ vrsta: o.tipLabel, stavka: o.title, detalj: o.detail, datum: o.datum, hitnost: o.level })),
  };
}

export async function askAi(history: ChatMessage[], snapshot: unknown, webSearch: boolean): Promise<ChatMessage> {
  const key = getAiKey();
  if (!key) throw new Error('Nedostaje Gemini API ključ. Upiši ga u Postavke.');

  const system = [
    'Ti si poslovni asistent građevinske tvrtke TM Color. Odgovaraj na hrvatskom, sažeto i s konkretnim brojkama u EUR.',
    'FORMAT ODGOVORA (markdown): počni jednom kratkom rečenicom zaključka, zatim koristi kratke naslove (###) s emojijem, popise s crticama, **podebljane** ključne brojke i iznose, a za usporedbe tablice. Za status koristi ikone: ✅ dobro, ⚠️ pozor, 🔴 problem, 💰 novac, 📅 rokovi, 🏗️ gradilišta, 🚚 vozila, 👷 radnici. Završi s 💡 kratkim prijedlogom što napraviti. Ne piši dugačke odlomke.',
    'Za pitanja o firmi koristi isključivo priloženi JSON s podacima iz programa; ako podatka nema, to reci.',
    webSearch ? 'Za vanjske informacije (cijene materijala, propisi, tržište) koristi web pretragu i navedi da su to vanjski podaci.' : 'Web pretraga je isključena.',
    `PODACI IZ PROGRAMA:\n${JSON.stringify(snapshot)}`,
  ].join('\n\n');

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
  };
  if (webSearch) body.tools = [{ google_search: {} }];

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    const message = String(json?.error?.message ?? 'Greška AI servisa.');
    if (response.status === 429) throw new Error('Dosegnut je besplatni limit zahtjeva. Pričekaj minutu pa pokušaj ponovno.');
    throw new Error(message);
  }
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  const chunks = (candidate?.groundingMetadata?.groundingChunks ?? []) as { web?: { title?: string; uri?: string } }[];
  const sources = chunks.filter((c) => c.web?.uri).map((c) => ({ title: c.web?.title ?? c.web?.uri ?? '', uri: c.web?.uri ?? '' }));
  return { role: 'model', text: text || 'Nema odgovora.', sources };
}
