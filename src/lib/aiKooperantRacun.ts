import { generateGeminiContent, GeminiRequestError } from './ai';

export interface KooperantRacunStavka {
  opis: string;
  kolicina: number;
  jedinica: string;
  cijena: number;
  iznos: number;
}

export interface KooperantRacun {
  dobavljac: string;
  broj_racuna: string;
  datum: string;
  valuta: string;
  ukupno: number | null;
  stavke: KooperantRacunStavka[];
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    dobavljac: { type: 'STRING' },
    broj_racuna: { type: 'STRING' },
    datum: { type: 'STRING' },
    valuta: { type: 'STRING' },
    ukupno: { type: 'NUMBER' },
    stavke: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          opis: { type: 'STRING' },
          kolicina: { type: 'NUMBER' },
          jedinica: { type: 'STRING' },
          cijena: { type: 'NUMBER' },
          iznos: { type: 'NUMBER' },
        },
        required: ['opis', 'kolicina', 'jedinica', 'cijena', 'iznos'],
      },
    },
  },
  required: ['dobavljac', 'broj_racuna', 'datum', 'valuta', 'ukupno', 'stavke'],
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Račun nije moguće pročitati.'));
    reader.readAsDataURL(file);
  });
}

function validateInvoiceFile(file: File) {
  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const allowedExtensions = /\.(pdf|jpe?g|png|webp)$/i;
  if (!allowedMimeTypes.includes(file.type) && !allowedExtensions.test(file.name)) {
    throw new Error('Podržani su računi u PDF-u ili kao JPEG, PNG i WebP slika.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('Račun ne smije biti veći od 15 MB.');
}

function mimeType(file: File) {
  if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file.type;
  if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg';
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.webp$/i.test(file.name)) return 'image/webp';
  return 'application/pdf';
}

export async function parseKooperantRacun(file: File): Promise<KooperantRacun> {
  validateInvoiceFile(file);

  const base64 = await toBase64(file);
  const prompt = [
    'Pročitaj priloženi račun dobavljača/kooperanta i vrati njegove podatke kao JSON po zadanoj shemi.',
    'Izvuci svaku zasebnu naplaćenu robu ili uslugu kao stavku, redoslijedom s računa. Ne vraćaj naslove, međuzbrojeve, ukupne iznose kao stavke ni podatke o plaćanju.',
    'Za stavku vrati opis, količinu, jedinicu mjere, jediničnu cijenu i iznos retka u valuti računa. Iznos retka treba biti stvarni iznos stavke kako je iskazan na računu (uključi PDV ako su cijene na računu s PDV-om).',
    'Ukupno vrati kao ukupni iznos za plaćanje ako je jasno naveden. Valutu vrati kao ISO oznaku (npr. EUR, USD), simbol € označi kao EUR. Valutu ne pretvaraj. Ako pojedinačni podatak nije vidljiv, vrati prazan tekst ili nulu; ne izmišljaj vrijednosti.',
    'Datum vrati u obliku YYYY-MM-DD samo ako je čitljiv i jednoznačan, inače kao prazan tekst. Decimalni zarez pretvori u decimalnu točku.',
  ].join('\n');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType(file), data: base64 } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let json: Awaited<ReturnType<typeof generateGeminiContent>>;
    try {
      json = await generateGeminiContent('kooperant-invoice', body);
    } catch (reason) {
      if (reason instanceof GeminiRequestError && (reason.status === 429 || reason.status === 503) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
        continue;
      }
      throw reason;
    }
    if (!json.candidates?.length) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
        continue;
      }
      break;
    }

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? '')
      .join('');
    try {
      const parsed = JSON.parse(text) as Partial<KooperantRacun>;
      const stavke = (parsed.stavke ?? [])
        .filter((item) => typeof item.opis === 'string' && item.opis.trim())
        .map((item) => {
          const quantity = Number(item.kolicina) || 0;
          const price = Number(item.cijena) || 0;
          const amount = Number(item.iznos) || 0;
          return {
            opis: String(item.opis).trim(),
            kolicina: quantity,
            jedinica: String(item.jedinica ?? '').trim(),
            cijena: price,
            iznos: amount || quantity * price,
          };
        })
        .filter((item) => item.iznos > 0);
      if (stavke.length === 0) throw new Error('Na računu nisu pronađene stavke s iznosima.');
      return {
        dobavljac: String(parsed.dobavljac ?? '').trim(),
        broj_racuna: String(parsed.broj_racuna ?? '').trim(),
        datum: isValidDate(String(parsed.datum ?? '')) ? String(parsed.datum) : '',
        valuta: String(parsed.valuta ?? '').trim().toUpperCase().replace(/^€|EURO$/g, 'EUR'),
        ukupno: typeof parsed.ukupno === 'number' && Number.isFinite(parsed.ukupno) && parsed.ukupno > 0 ? parsed.ukupno : null,
        stavke,
      };
    } catch (reason) {
      if (reason instanceof Error && reason.message === 'Na računu nisu pronađene stavke s iznosima.') throw reason;
      if (attempt === 2) break;
    }
  }
  throw new Error('AI nije uspio pouzdano pročitati račun. Provjeri kvalitetu skena ili unesi trošak ručno.');
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
