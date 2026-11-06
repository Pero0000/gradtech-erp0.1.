import type { RadnikDokumentVrsta } from '@/types';

export const dokumentVrste: Record<RadnikDokumentVrsta, string> = {
  lijecnicki: 'Liječnički pregled',
  atest: 'Atest',
  zastita_na_radu: 'Zaštita na radu',
  osposobljavanje: 'Osposobljavanje',
  ostalo: 'Ostalo',
};

export interface RadnikDokumentKategorija {
  vrsta: RadnikDokumentVrsta;
  naziv: string;
}

export const osnovneDokumentKategorije: RadnikDokumentKategorija[] =
  (Object.keys(dokumentVrste) as RadnikDokumentVrsta[])
    .filter((vrsta) => vrsta !== 'atest')
    .map((vrsta) => ({ vrsta, naziv: dokumentVrste[vrsta] }));

export const obavezniRadnikDokumenti = [
  { type: 'lijecnicki', label: dokumentVrste.lijecnicki },
  { type: 'zastita_na_radu', label: dokumentVrste.zastita_na_radu },
  { type: 'osposobljavanje', label: dokumentVrste.osposobljavanje },
] satisfies Array<{ type: RadnikDokumentVrsta; label: string }>;
