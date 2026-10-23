export type BonusTip = 'pausalno' | 'komad' | 'dan' | 'sat';
export interface RadnikBonus {
  naziv: string;
  iznos: number;
  tip: BonusTip;
}
export interface RadnikPovijest {
  id: string;
  radnik_id: string;
  polje: string;
  stara_vrijednost: string | null;
  nova_vrijednost: string | null;
  created_at: string;
}
export type OdsustvoVrsta = 'praznik' | 'godisnji' | 'bolovanje';
export interface RadnikOdsustvo {
  id: string;
  radnik_id: string;
  vrsta: OdsustvoVrsta;
  datum_od: string;
  datum_do: string;
  napomena: string | null;
}
export type RadnikDokumentVrsta = 'lijecnicki' | 'atest' | 'zastita_na_radu' | 'osposobljavanje' | 'ostalo';
export interface RadnikDokument {
  id: string;
  radnik_id: string;
  vrsta: RadnikDokumentVrsta;
  naziv: string;
  putanja: string | null;
  datum_od: string | null;
  datum_do: string | null;
  napomena: string | null;
  url?: string | null;
}
export type VoziloDokumentVrsta = 'registracija' | 'tehnicki' | 'osiguranje' | 'kasko' | 'servis' | 'enc' | 'tahograf' | 'ostalo';
export interface VoziloDokument {
  id: string;
  vozilo_id: string;
  vrsta: VoziloDokumentVrsta;
  naziv: string;
  putanja: string | null;
  datum_od: string | null;
  datum_do: string | null;
  iznos: number | null;
  km: number | null;
  napomena: string | null;
  url?: string | null;
}
export type GradilisteStatus = 'ponuda' | 'planirano' | 'aktivno' | 'pauzirano' | 'zavrseno';
export type GradilisteRegija = 'dalmacija' | 'istra_kvarner' | 'slavonija' | 'zagreb_i_okolica' | 'medimurje';
export type RadnikStatus = 'aktivan' | 'neaktivan' | 'bolovanje';
export type VoziloStatus = 'slobodno' | 'zauzeto' | 'servis';
export type VoziloTip = 'teretno' | 'dostavno' | 'radno' | 'putnicko';
export type OpremaKategorija = 'alat' | 'stroj';
export type OpremaStatus = 'slobodno' | 'na_gradilistu' | 'servis' | 'neaktivno';
export type OpremaStanje = 'novo' | 'dobro' | 'osteceno';
export type OpremaDokumentVrsta = 'servis' | 'atest' | 'dokument' | 'ostalo';

export interface Oprema {
  id: string;
  kategorija: OpremaKategorija;
  naziv: string;
  marka: string | null;
  model: string | null;
  inventarski_broj: string | null;
  serijski_broj: string | null;
  status: OpremaStatus;
  stanje: OpremaStanje;
  gradiliste_id: string | null;
  kolicina: number;
  datum_nabave: string | null;
  nabavna_vrijednost: number;
  cijena_sata: number;
  radni_sati: number;
  servisni_interval_sati: number | null;
  servis_upozorenje_sati: number;
  napomena: string | null;
  created_at: string;
  updated_at: string;
  gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
}

export interface OpremaDokument {
  id: string;
  oprema_id: string;
  vrsta: OpremaDokumentVrsta;
  naziv: string;
  putanja: string | null;
  datum_od: string | null;
  datum_do: string | null;
  radni_sati: number | null;
  iznos: number | null;
  napomena: string | null;
  created_at: string;
  url?: string | null;
}

export interface Investitor {
  id: string;
  naziv: string;
  oib: string | null;
  adresa: string | null;
  mjesto: string | null;
  postanski_broj: string | null;
  kontakt_osoba: string | null;
  telefon: string | null;
  email: string | null;
  web: string | null;
  napomena: string | null;
  created_at: string;
  updated_at: string;
}

export type InvestitorInput = Pick<Investitor, 'naziv'>
  & Partial<Omit<Investitor, 'id' | 'created_at' | 'updated_at' | 'naziv'>>;

export interface Objekt {
  id: string;
  naziv: string;
  investitor_id: string | null;
  adresa?: string | null;
  mjesto?: string | null;
  postanski_broj?: string | null;
  kontakt_osoba?: string | null;
  telefon?: string | null;
  napomena?: string | null;
  created_at: string;
  updated_at: string;
  investitori?: Pick<Investitor, 'id' | 'naziv'> | null;
}

export type ObjektInput = Pick<Objekt, 'naziv'> & Partial<Pick<Objekt,
  'investitor_id' | 'adresa' | 'mjesto' | 'postanski_broj' | 'kontakt_osoba' | 'telefon' | 'napomena'>>;

export interface DnevniRasporedGradiliste {
  id: string;
  datum: string;
  vozilo_id: string;
  gradiliste_id: string | null;
  tekst?: string | null;
  nalog_id?: string | null;
  iz_ostalo?: boolean;
  gradiliste_potvrdeno?: boolean;
  vrijeme: string;
}

export interface DnevniRasporedOstalo {
  id: string;
  datum: string;
  tekst: string | null;
  radnik_id: string | null;
}

export interface DnevniRasporedRadnik {
  id: string;
  datum: string;
  vozilo_id: string;
  radnik_id: string;
}

                    export interface Gradiliste {
                      id: string;
                        naziv: string;
                      adresa: string | null;
                    regija: GradilisteRegija | null;
                            objekt_id: string | null;
                              voditelj_gradilista: string | null;
                                ugovorena_vrijednost: number | null;
                                  predvidena_marza: number | null;
                                    status: GradilisteStatus;
                                      datum_pocetka: string | null;
                                        datum_zavrsetka: string | null;
                                            opis: string | null;
                                              created_at: string;
                                                updated_at: string;
                                                  objekti?: Objekt | null;
                                                  }

                                                  export interface Radnik {
                                                    id: string;
                                                      ime: string;
                                                        prezime: string;
                                                          uloga: string;
                                                            telefon: string | null;
                                                              email: string | null;
                                                                status: RadnikStatus;
                                                                  cijena_sata: number;
                                                                  nocni_dodatak?: number;
                                                                  teren_dnevnica?: number;
                                                                  cijena_praznik?: number;
                                                                  cijena_godisnji?: number;
                                                                  cijena_bolovanje?: number;
                                                                  cijena_put_sat?: number;
                                                                  pravo_nocni?: boolean;
                                                                  pravo_teren?: boolean;
                                                                  pravo_praznik?: boolean;
                                                                  pravo_godisnji?: boolean;
                                                                  pravo_bolovanje?: boolean;
                                                                  portal_vrijeme?: boolean;
                                                                  bonusi?: RadnikBonus[];
                                                                    created_at: string;
                                                                      updated_at: string;
                                                                      }

                                                                      export interface Vozilo {
                                                                        id: string;
                                                                          registracija: string;
                                                                            marka: string;
                                                                              model: string | null;
                                                                                tip: VoziloTip;
                                                                                  status: VoziloStatus;
                                                                                    kilometraza: number;
                                                                                      godina_proizvodnje: number | null;
                                                                                        broj_mjesta: number;
                                                                                        cijena_km?: number;
                                                                                        u_rasporedu?: boolean;
                                                                                        nosivost_kg?: number | null;
                                                                                        masa_kg?: number | null;
                                                                                        enc_broj?: string | null;
                                                                                        servis_interval_km?: number | null;
                                                                                        servis_interval_mjeseci?: number | null;
                                                                                        servis_upozorenje_km?: number;
                                                                                        servis_upozorenje_dana?: number;
                                                                                          napomena: string | null;
                                                                                            created_at: string;
                                                                                              updated_at: string;
                                                                                              }

                                                                                              export interface Raspored {
                                                                                                id: string;
                                                                                                  datum: string;
                                                                                                    gradiliste_id: string | null;
                                                                                                      napomena: string | null;
                                                                                                        created_at: string;
                                                                                                          gradilista?: Pick<Gradiliste, 'id' | 'naziv' | 'adresa'> | null;
                                                                                                            radnici?: Radnik[];
                                                                                                              vozila?: Vozilo[];
                                                                                                              }

                                                                                                              export interface RasporedInput {
                                                                                                                datum: string;
                                                                                                                  gradiliste_id: string | null;
                                                                                                                    napomena: string | null;
                                                                                                                      radnik_ids: string[];
                                                                                                                        vozilo_ids: string[];
                                                                                                                        }

                                                                                                                        export type TrosakKategorija = 'materijal' | 'gorivo' | 'put' | 'smjestaj' | 'kooperanti' | 'place' | 'oprema' | 'direktni' | 'ostalo';

                                                                                                                        export interface Kooperant {
                                                                                                                          id: string;
                                                                                                                          naziv: string;
                                                                                                                          djelatnost: string | null;
                                                                                                                          oib: string | null;
                                                                                                                          iban: string | null;
                                                                                                                          adresa: string | null;
                                                                                                                          mjesto: string | null;
                                                                                                                          postanski_broj: string | null;
                                                                                                                          kontakt_osoba: string | null;
                                                                                                                          telefon: string | null;
                                                                                                                          email: string | null;
                                                                                                                          web: string | null;
                                                                                                                          napomena: string | null;
                                                                                                                          created_at: string;
                                                                                                                          updated_at: string;
                                                                                                                        }

                                                                                                                        export type KooperantInput = Pick<Kooperant, 'naziv'>
                                                                                                                          & Partial<Omit<Kooperant, 'id' | 'created_at' | 'updated_at' | 'naziv'>>;

                                                                                                                        export interface Trosak {
                                                                                                                          id: string;
                                                                                                                            gradiliste_id: string | null;
                                                                                                                              kategorija: TrosakKategorija;
                                                                                                                                opis: string;
                                                                                                                                kooperant_id?: string | null;
                                                                                                                                kooperanti?: Pick<Kooperant, 'id' | 'naziv'> | null;
                                                                                                                                  iznos: number;
                                                                                                                                    datum: string;
                                                                                                                                      created_at: string;
                                                                                                                                        gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                        }

                                                                                                                                        export interface RadnoVrijeme {
                                                                                                                                          id: string;
                                                                                                                                            radnik_id: string;
                                                                                                                                              gradiliste_id: string | null;
                                                                                                                                                datum: string;
                                                                                                                                                  sati: number;
                                                                                                                                                    nalog_id?: string | null;
                                                                                                                                                    nocni_sati?: number | null;
                                                                                                                                                    napomena: string | null;
                                                                                                                                                      created_at: string;
                                                                                                                                                        radnici?: Pick<Radnik, 'id' | 'ime' | 'prezime' | 'uloga' | 'cijena_sata'> | null;
                                                                                                                                                          gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                          }

                                                                                                                                                          export type NalogStatus = 'otvoren' | 'u_tijeku' | 'zavrsen' | 'otkazan';
                                                                                                                                                          export type NalogPrioritet = 'niski' | 'srednji' | 'visoki' | 'hitno';
                                                                                                                                                          export type MobileNalogStatus = 'nije_poslan' | 'dodijeljen' | 'u_tijeku' | 'predan' | 'odobren' | 'zakljucen_bez_potvrde';

                                                                                                                                                          export interface RadniNalog {
                                                                                                                                                            id: string;
                                                                                                                                                              broj: string;
                                                                                                                                                                gradiliste_id: string | null;
                                                                                                                                                                  naslov: string;
                                                                                                                                                                    opis: string | null;
                                                                                                                                                                      status: NalogStatus;
                                                                                                                                                                        prioritet: NalogPrioritet;
                                                                                                                                                                          datum_kreiranja: string;
  zakljucen_at?: string | null;
  mobile_status?: MobileNalogStatus;
  teren?: boolean;
  bez_troska?: boolean;
  poslovodja_id?: string | null;
  vozac_id?: string | null;
                                                                                                                                                                            rok: string | null;
                                                                                                                                                                              created_at: string;
                                                                                                                                                                                gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                                                  radnici?: Radnik[];
                                                                                                                                                                                  }

                                                                                                                                                                                  export type RokStatus = 'otvoren' | 'zavrsen' | 'prekoracen';

                                                                                                                                                                                  export interface Rok {
                                                                                                                                                                                    id: string;
                                                                                                                                                                                      gradiliste_id: string;
                                                                                                                                                                                        naziv: string;
                                                                                                                                                                                          datum: string;
                                                                                                                                                                                            status: RokStatus;
nalog_id?: string | null;
zadatak_id?: string | null;
                                                                                                                                                                                              opis: string | null;
                                                                                                                                                                                                created_at: string;
                                                                                                                                                                                                }

                                                                                                                                                                                                export interface GradilisteZadatak {
  id: string;
  gradiliste_id: string | null;
  naziv: string;
  gotovo: boolean;
  gotovo_at: string | null;
  rok?: string | null;
  nalog_id?: string | null;
  /** Prije migracije 20261021160000 stupac ne postoji pa se tretira kao 'zadatak'. */
  vrsta?: ZadatakVrsta;
  created_at: string;
}

export type ZadatakVrsta = 'zadatak' | 'dodatni';

export const zadatakVrsta = (z: Pick<GradilisteZadatak, 'vrsta'>): ZadatakVrsta => (z.vrsta === 'dodatni' ? 'dodatni' : 'zadatak');

export type FakturaStatus = 'izdana' | 'placena' | 'nep placena';

                                                                                                                                                                                                export interface Faktura {
                                                                                                                                                                                                  id: string;
                                                                                                                                                                                                    gradiliste_id: string | null;
                                                                                                                                                                                                        investitor_id: string | null;
                                                                                                                                                                                                      broj: string;
                                                                                                                                                                                                        kupac: string | null;
                                                                                                                                                                                                          iznos: number;
                                                                                                                                                                                                              rabat: number;
                                                                                                                                                                                                            datum_izdavanja: string;
                                                                                                                                                                                                              datum_dospjecja: string | null;
                                                                                                                                                                                                                status: FakturaStatus;
                                                                                                                                                                                                                  opis: string | null;
                                                                                                                                                                                                                    created_at: string;
                                                                                                                                                                                                                      gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                                                                                         investitori?: Pick<Investitor, 'id' | 'naziv'> | null;
                                                                                                                                                                                                                      }

                                                                                                                                                                                                                      export type UgovoreniRadStatus = 'planirano' | 'u_tijeku' | 'zavrseno';
                                                                                                                                                                                                                      export type UgovoreniRadVrsta = 'ugovoreni' | 'vtr';

                                                                                                                                                                                                                      export interface UgovoreniRad {
                                                                                                                                                                                                                        id: string;
                                                                                                                                                                                                                          gradiliste_id: string | null;
                                                                                                                                                                                                                            naziv: string;
                                                                                                                                                                                                                              opis: string | null;
                                                                                                                                                                                                                                ugovoreni_iznos: number;
                                                                                                                                                                                                                                  ostvareni_iznos: number;
                                                                                                                                                                                                                                    status: UgovoreniRadStatus;
                                                                                                                                                                                                                                    vrsta?: UgovoreniRadVrsta;
                                                                                                                                                                                                                                    ponuda_id?: string | null;
                                                                                                                                                                                                                                    dokument_putanja?: string | null;
                                                                                                                                                                                                                                    dokument_naziv?: string | null;
                                                                                                                                                                                                                                      created_at: string;
                                                                                                                                                                                                                                        gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                        