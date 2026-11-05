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
  (Object.keys(dokumentVrste) as RadnikDokumentVrsta[]).map((vrsta) => ({ vrsta, naziv: dokumentVrste[vrsta] }));
