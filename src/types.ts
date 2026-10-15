export type GradilisteStatus = 'ponuda' | 'planirano' | 'aktivno' | 'pauzirano' | 'zavrseno';
export type GradilisteRegija = 'dalmacija' | 'istra_kvarner' | 'slavonija' | 'zagreb_i_okolica' | 'medimurje';
export type RadnikStatus = 'aktivan' | 'neaktivan' | 'bolovanje';
export type VoziloStatus = 'slobodno' | 'zauzeto' | 'servis';
export type VoziloTip = 'teretno' | 'dostavno' | 'radno' | 'putnicko';

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
                                          proracun: number;
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

                                                                                                                        export type TrosakKategorija = 'materijal' | 'gorivo' | 'put' | 'smjestaj' | 'kooperanti' | 'place' | 'oprema' | 'ostalo';

                                                                                                                        export interface Trosak {
                                                                                                                          id: string;
                                                                                                                            gradiliste_id: string | null;
                                                                                                                              kategorija: TrosakKategorija;
                                                                                                                                opis: string;
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
                                                                                                                                                    napomena: string | null;
                                                                                                                                                      created_at: string;
                                                                                                                                                        radnici?: Pick<Radnik, 'id' | 'ime' | 'prezime' | 'uloga' | 'cijena_sata'> | null;
                                                                                                                                                          gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                          }

                                                                                                                                                          export type NalogStatus = 'otvoren' | 'u_tijeku' | 'zavrsen' | 'otkazan';
                                                                                                                                                          export type NalogPrioritet = 'niski' | 'srednji' | 'visoki' | 'hitno';

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
  teren?: boolean;
  poslovodja_id?: string | null;
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
  gradiliste_id: string;
  naziv: string;
  gotovo: boolean;
  gotovo_at: string | null;
  rok?: string | null;
  nalog_id?: string | null;
  created_at: string;
}

export type FakturaStatus = 'izdana' | 'placena' | 'nep placena';

                                                                                                                                                                                                export interface Faktura {
                                                                                                                                                                                                  id: string;
                                                                                                                                                                                                    gradiliste_id: string | null;
                                                                                                                                                                                                      broj: string;
                                                                                                                                                                                                        kupac: string | null;
                                                                                                                                                                                                          iznos: number;
                                                                                                                                                                                                            datum_izdavanja: string;
                                                                                                                                                                                                              datum_dospjecja: string | null;
                                                                                                                                                                                                                status: FakturaStatus;
                                                                                                                                                                                                                  opis: string | null;
                                                                                                                                                                                                                    created_at: string;
                                                                                                                                                                                                                      gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                                                                                      }

                                                                                                                                                                                                                      export type UgovoreniRadStatus = 'planirano' | 'u_tijeku' | 'zavrseno';

                                                                                                                                                                                                                      export interface UgovoreniRad {
                                                                                                                                                                                                                        id: string;
                                                                                                                                                                                                                          gradiliste_id: string | null;
                                                                                                                                                                                                                            naziv: string;
                                                                                                                                                                                                                              opis: string | null;
                                                                                                                                                                                                                                ugovoreni_iznos: number;
                                                                                                                                                                                                                                  ostvareni_iznos: number;
                                                                                                                                                                                                                                    status: UgovoreniRadStatus;
                                                                                                                                                                                                                                      created_at: string;
                                                                                                                                                                                                                                        gradilista?: Pick<Gradiliste, 'id' | 'naziv'> | null;
                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                        