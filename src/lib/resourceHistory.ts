import type { HistoryValue, DocumentChangeHistory } from './api';
import { formatHrDate } from './localization';

const labels: Record<string, string> = {
  ime: 'Ime', prezime: 'Prezime', telefon: 'Telefon', email: 'E-mail', naziv: 'Naziv',
  napomena: 'Napomena', registracija: 'Registracija', broj_sasije: 'Broj šasije',
  marka: 'Marka', model: 'Model', tip: 'Tip', status: 'Status', kilometraza: 'Kilometraža (km)',
  godina_proizvodnje: 'Godina proizvodnje', broj_mjesta: 'Broj mjesta', nosivost_kg: 'Nosivost (kg)',
  masa_kg: 'Masa (kg)', u_rasporedu: 'U rasporedu', enc_broj: 'ENC broj',
  servis_interval_km: 'Servisni interval (km)', servis_interval_mjeseci: 'Servisni interval (mjeseci)',
  servis_upozorenje_km: 'Upozorenje servisa (km)', servis_upozorenje_dana: 'Upozorenje servisa (dana)',
  sljedeci_servis_napomena: 'Napomena sljedećeg servisa', jamstvo_aktivno: 'Jamstvo aktivno',
  jamstvo_od: 'Početak jamstva', jamstvo_mjeseci: 'Trajanje jamstva (mjeseci)',
  jamstvo_do_km: 'Jamstvo do (km)', jamstvo_uvjeti: 'Uvjeti jamstva',
  jamstvo_do_radnih_sati: 'Jamstvo do (radnih sati)', podkategorija: 'Podkategorija',
  inventarski_broj: 'Inventarski broj', serijski_broj: 'Serijski broj', stanje: 'Stanje',
  datum_nabave: 'Datum nabave', nabavna_vrijednost: 'Nabavna vrijednost',
  servisni_interval_sati: 'Servisni interval (sati)', servis_upozorenje_sati: 'Upozorenje servisa (sati)',
  cijena_km: 'Cijena kilometra', cijena_sata: 'Cijena sata', radni_sati: 'Radni sati',
  gradiliste_id: 'Dodjela gradilištu', radnik_id: 'Dodjela djelatniku', kategorija: 'Kategorija',
  kolicina: 'Količina', uloga: 'Kategorija djelatnika', cijena_praznik: 'Cijena praznika',
  cijena_godisnji: 'Cijena godišnjeg', cijena_bolovanje: 'Cijena bolovanja',
  cijena_put_sat: 'Cijena putnog sata', nocni_dodatak: 'Noćni dodatak',
  teren_dnevnica: 'Terenska dnevnica', bonusi: 'Bonusi',
  vrsta: 'Vrsta dokumenta', putanja: 'Prilog', datum_od: 'Početak', datum_do: 'Kraj / istek',
  iznos: 'Iznos', km: 'Kilometraža (km)', serviser: 'Serviser', dijelovi: 'Dijelovi',
  vozilo_id: 'Vozilo', oprema_id: 'Oprema',
  adresa: 'Adresa', regija: 'Regija', objekt_id: 'Objekt (ID)', voditelj_gradilista: 'Voditelj gradilišta',
  datum_pocetka: 'Datum početka', datum_zavrsetka: 'Datum završetka', opis: 'Opis',
  onedrive_map_link: 'OneDrive poveznica', ugovorena_vrijednost: 'Ugovorena vrijednost',
  predvidena_marza: 'Predviđena marža',
  datum: 'Datum', kooperant_id: 'Kooperant (ID)', nalog_id: 'Radni nalog (ID)', zadatak_id: 'Zadatak (ID)',
  sati: 'Ukupni sati', nocni_sati: 'Noćni sati',
  placen: 'Plaćeno', placeno_at: 'Datum plaćanja',
  broj_racuna: 'Broj računa', jedinica: 'Jedinica', jedinicna_cijena: 'Jedinična cijena',
  broj: 'Broj', kupac: 'Kupac', investitor_id: 'Investitor (ID)', rabat: 'Rabat', rabat_smjer: 'Smjer rabata',
  datum_izdavanja: 'Datum izdavanja', datum_dospjecja: 'Datum dospijeća', datum_naplate: 'Datum naplate',
  ugovoreni_iznos: 'Ugovoreni iznos', ostvareni_iznos: 'Ostvareni iznos',
  ponuda_id: 'Ponuda (ID)', dokument_putanja: 'Prilog rada', dokument_naziv: 'Naziv priloga',
  rok: 'Rok', gotovo: 'Dovršeno', gotovo_at: 'Vrijeme dovršetka',
  naslov: 'Naslov', prioritet: 'Prioritet',
  oib: 'OIB', mjesto: 'Mjesto', postanski_broj: 'Poštanski broj', kontakt_osoba: 'Kontakt osoba', web: 'Web-stranica',
  djelatnost: 'Djelatnost', iban: 'IBAN', timeline_color: 'Boja terminskog plana',
  dogovoreni_iznos: 'Dogovoreni iznos',
  sifra: 'Šifra', vrsta_posla: 'Vrsta posla', cijena: 'Kataloška cijena',
  cijena_promijenjena_at: 'Vrijeme promjene cijene',
};

const siteValues: Record<string, string> = {
  ponuda: 'Ponuda', planirano: 'Planirano', aktivno: 'Aktivno', pauzirano: 'Pauzirano',
  neplaceno: 'Neplaćeno', zavrseno: 'Završeno', dalmacija: 'Dalmacija',
  istra_kvarner: 'Istra i Kvarner', slavonija: 'Slavonija', zagreb_i_okolica: 'Zagreb i okolica',
  medimurje: 'Međimurje',
  otvoren: 'Otvoren', zavrsen: 'Završen', prekoracen: 'Prekoračen',
  izdana: 'Izdana', placena: 'Plaćena', 'nep placena': 'Neplaćena',
  pribroji: 'Pribraja se', oduzmi: 'Oduzima se',
  u_tijeku: 'U tijeku',
  niski: 'Niski', srednji: 'Srednji', visoki: 'Visoki', hitno: 'Hitno',
  otkazano: 'Otkazano',
};

function display(value: HistoryValue | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Da' : 'Ne';
  if (typeof value === 'number') return value.toLocaleString('hr-HR');
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatHrDate(value) : value;
  return JSON.stringify(value);
}

export function resourceHistoryDifferences(change: Pick<DocumentChangeHistory, 'before_data' | 'after_data'>) {
  const before = change.before_data ?? {};
  const after = change.after_data ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !['id', 'company_id', 'created_at', 'updated_at'].includes(key)
      && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      key, label: labels[key] ?? `Dodatno polje (${key})`,
      before: ['status', 'regija', 'rabat_smjer', 'prioritet'].includes(key) && typeof before[key] === 'string'
        ? siteValues[before[key]] ?? display(before[key]) : display(before[key]),
      after: ['status', 'regija', 'rabat_smjer', 'prioritet'].includes(key) && typeof after[key] === 'string'
        ? siteValues[after[key]] ?? display(after[key]) : display(after[key]),
    }));
}

export function taskDeadlineHistoryLines(deadlines: Array<Record<string, HistoryValue>>): string[] {
  if (deadlines.length === 0) return ['Nema povezanih rokova.'];
  return deadlines.map((deadline) => [
    display(deadline.naziv),
    `Datum: ${display(deadline.datum)}`,
    `Raspon: ${display(deadline.datum_pocetka)} – ${display(deadline.datum_zavrsetka)}`,
    `Status: ${typeof deadline.status === 'string' ? siteValues[deadline.status] ?? display(deadline.status) : display(deadline.status)}`,
    `Kooperant: ${display(deadline.kooperant_id)}`,
    `Opis: ${display(deadline.opis)}`,
    `Gradilište: ${display(deadline.gradiliste_id)}`,
    `Nalog: ${display(deadline.nalog_id)}`,
    `ID: ${display(deadline.id)}`,
  ].join(' · '));
}
