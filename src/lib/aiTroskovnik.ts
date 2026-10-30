import { generateGeminiContent, GeminiRequestError } from './ai';

export interface TroskovnikRedak {
  grupa: string;
  opis: string;
  jedinica: string;
  kolicina: number;
  cijena: number;
}

const BATCH = 120;
const MAX_ROUNDS = 25;
export const MAX_FILE_MB = 15;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    stavke: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          grupa: { type: 'STRING' },
          opis: { type: 'STRING' },
          jedinica: { type: 'STRING' },
          kolicina: { type: 'NUMBER' },
          cijena: { type: 'NUMBER' },
        },
        required: ['opis', 'jedinica', 'kolicina'],
      },
    },
    ima_jos: { type: 'BOOLEAN' },
  },
  required: ['stavke', 'ima_jos'],
};

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Datoteku nije moguće pročitati.'));
    r.readAsDataURL(file);
  });

const isText = (f: File) => /\.(csv|txt|tsv)$/i.test(f.name) || f.type.startsWith('text/');

async function callBatch(file: File, content: { b64?: string; text?: string }, offset: number): Promise<{ stavke: TroskovnikRedak[]; imaJos: boolean }> {
  const prompt = [
    'Ovo je građevinski troškovnik. Izvuci stavke troškovnika redom kojim se pojavljuju u dokumentu.',
    `Preskoči prvih ${offset} stavki (već su učitane) i vrati sljedećih najviše ${BATCH} stavki. Ako nakon njih u dokumentu ima još stavki, postavi ima_jos na true, inače false.`,
    'Za svaku stavku: grupa = naziv poglavlja/grupe radova kojoj stavka pripada (npr. "Fasaderski radovi"; prazno ako ne postoji), opis = puni opis stavke bez rednog broja, jedinica = jedinica mjere (m2, m, m3, kom, kg, h, kpl...), kolicina = količina kao broj, cijena = jedinična cijena u EUR ako je u dokumentu navedena, inače 0.',
    'Naslove poglavlja, međuzbrojeve, rekapitulacije, ukupne iznose i napomene NE vraćaj kao stavke. Ne izmišljaj podatke. Decimalni zarez pretvori u broj.',
  ].join('\n');

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (content.text !== undefined) parts.push({ text: `TROŠKOVNIK:\n${content.text}` });
  else parts.push({ inline_data: { mime_type: file.type || 'application/pdf', data: content.b64 } });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let json: Awaited<ReturnType<typeof generateGeminiContent>>;
    try {
      json = await generateGeminiContent('troskovnik-import', body);
    } catch (reason) {
      if (reason instanceof GeminiRequestError && (reason.status === 429 || reason.status === 503) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      throw reason;
    }
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    try {
      const parsed = JSON.parse(text) as { stavke?: Partial<TroskovnikRedak>[]; ima_jos?: boolean };
      const stavke = (parsed.stavke ?? [])
        .filter((s) => s.opis && String(s.opis).trim())
        .map((s) => ({
          grupa: String(s.grupa ?? '').trim(),
          opis: String(s.opis).trim(),
          jedinica: String(s.jedinica ?? 'kom').trim() || 'kom',
          kolicina: Number(s.kolicina) || 0,
          cijena: Number(s.cijena) || 0,
        }));
      return { stavke, imaJos: !!parsed.ima_jos && stavke.length > 0 };
    } catch {
      // odgovor je odrezan ili neispravan; pokušaj ponovno
    }
  }
  throw new Error('AI nije vratio čitljiv odgovor ili je dosegnut limit zahtjeva. Pričekaj minutu pa pokušaj ponovno.');
}

// Veliki troškovnici čitaju se u serijama kako odgovor AI-a ne bi bio odrezan
export async function parseTroskovnik(file: File, onProgress: (count: number) => void): Promise<TroskovnikRedak[]> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Datoteka je veća od ${MAX_FILE_MB} MB. Podijeli troškovnik na manje dijelove.`);
  const content = isText(file) ? { text: await file.text() } : { b64: await toBase64(file) };
  const all: TroskovnikRedak[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { stavke, imaJos } = await callBatch(file, content, all.length);
    all.push(...stavke);
    onProgress(all.length);
    if (!imaJos) break;
  }
  return all;
}
