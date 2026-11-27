# GradTech ERP — neovisna revizija softverskog proizvoda

**Datum revizije:** 27. studenoga 2026.  
**Opseg:** lokalni izvorni kod, migracije, testovi, dokumentacija i native konfiguracija.  
**Ograničenja:** nije mijenjan kod, baza ni produkcijsko okruženje. Produkcijske migracije, stvarne RLS politike, tajne, logovi, telemetrija, stvarni opseg baze i konfiguracija Supabase/Firebase/App Store računa nisu svi provjerivi iz repozitorija. Takvi zaključci označeni su kao **neprovjereno**.

## Sažetak za odlučivanje

GradTech je već stvaran, širok ERP za građevinske i terenske tvrtke, a ne mockup. Pokriva poslovne registre, gradilišta, rasporede, radne naloge, mobilni portal djelatnika, radno vrijeme, troškove, fakture, ponude, vozila, gorivo, opremu, kooperante, dokumente, povijest i povrat izbrisanih podataka.

Najveća vrijednost proizvoda je duboki vertikalni tijek:

> gradilište → dnevni raspored → radni nalog → mobilna ekipa → fotografije/materijal/zadaci/sati/kilometri → trošak gradilišta → rekapitulacija i fakturiranje.

Najveći rizici nisu nedostatak funkcionalnosti nego:

1. prevelika koncentracija koda u nekoliko datoteka;
2. složenost proizvodnog migracijskog sustava;
3. neprovjerena produkcijska migracijska povijest, backup/restore proces i monitoring;
4. nedostatak load/E2E testa na stvarnoj infrastrukturi i uređajima;
5. više poznatih ranjivosti u produkcijskim tranzitivnim ovisnostima;
6. nedostatak naplate/licenciranja, platform telemetrije i formalnog release procesa;
7. velika količina poslovnih pravila na triggerima i RPC funkcijama bez zasebne dokumentirane domenske specifikacije.

Konačna ocjena u ovoj reviziji je **69/100**: proizvod ima značajnu poslovnu vrijednost i solidnu početnu višedruštvenu arhitekturu, ali nije još operativno dokazano spreman za masovno SaaS skaliranje.

---

## 1. Statistika projekta

### 1.1 Izvorni kod

Automatizirano brojanje, isključujući `node_modules`, `dist`, Android build/Gradle cache i generirane native assete:

| Mjera | Vrijednost |
|---|---:|
| Izvorne datoteke pod `src/` | 105 |
| Linije vlastitog izvornog koda pod `src/` | 40.377 |
| TSX datoteke | 60 |
| TS datoteke | 45 |
| Datoteke view komponenti | 43 |
| Linije view sloja | 26.064 |
| Datoteke u `src/lib/` | 38 |
| React component datoteke, heuristički | 66 |
| Hook export datoteke, heuristički | 7 |
| Ukupno vlastitih datoteka koda uključujući testove i supabase JS | 175 |

Ove brojke namjerno ne računaju npm biblioteke, generirani `android/app/build`, Gradle cache, syncane `public/` assete ni `package-lock.json`.

### 1.2 SQL i backend

| Mjera | Vrijednost |
|---|---:|
| SQL migracije | 201 |
| Linije SQL migracija | 20.417 |
| Jedinstvena imena tablica nađena u povijesnim `CREATE TABLE` naredbama | 61 |
| Jedinstvena imena funkcija | 261 |
| Jedinstvena imena triggera | 103 |
| Jedinstvena imena RLS politika | 220 |
| `CREATE TABLE` naredbe, uključujući migracijske rekreacije | 92 |
| `CREATE ... FUNCTION` naredbe, uključujući replace | 374 |
| `CREATE ... TRIGGER` naredbe, uključujući replace | 125 |
| `CREATE POLICY` naredbe | 296 |
| Naredbe `CREATE ... INDEX` | 112 |
| Izričita `SECURITY DEFINER` pojavljivanja | 420 |
| Edge Functions | 3 |

SQL brojke uključuju ponovna `CREATE OR REPLACE`, mijenjanje i zamjene kroz povijest migracija. One nisu izravno jednaka konačnom broju objekata u produkcijskoj bazi.

Edge Functions:

- `gemini-proxy`
- `notify-work-order`
- `manage-companies`

### 1.3 Najveće datoteke

| Datoteka | Linije | Rizik |
|---|---:|---|
| `src/lib/api.ts` | 5.282 | Vrlo visok — sve domene u jednom servisu |
| `src/components/views/RasporedView.tsx` | 2.712 | Visok — UI, radni nalozi, drag/drop i sinkronizacija |
| `src/components/views/GradilisteDetailsPanel.tsx` | 2.195 | Visok — širok panel sa svim podacima gradilišta |
| `src/components/mobile/MobileWorkOrdersView.tsx` | 2.165 | Visok — gotovo cijeli mobilni portal u jednoj komponenti |
| `src/components/views/KooperantiView.tsx` | 1.721 | Visok |
| `src/components/views/RegistryViews.tsx` | 1.675 | Visok |
| `src/components/views/NalogIzvrsenje.tsx` | 1.444 | Visok |
| `src/components/views/GradilistaView.tsx` | 1.362 | Srednje/visok |
| `src/types.ts` | 540 | Srednji — veliki, ali centralizirani tipovi |

Ove datoteke su radni test za tehnički dug. Same po sebi ne znače da kod ne radi, ali povećavaju blast radius svake promjene.

### 1.4 Testovi

| Mjera | Vrijednost |
|---|---:|
| Testne datoteke `*.test.mjs` | 58 |
| Statički pronađene `test(...)` deklaracije | 432 |
| Zadnji kompletni pokretani test suite | 487 testova |
| Rezultat | 487/487 prolazi |
| SQL/PGlite integracijski testovi | značajan broj |
| UI regresijski testovi | prisutni |
| E2E preglednik testovi | nisu pronađeni |
| Instrumentirana pokrivenost | nema |
| Load testovi | nisu pronađeni |
| Native-device testovi | nisu pronađeni |

Kvaliteta testova je iznad prosjeka za ovakvu aplikaciju. Testovi pokrivaju povrat brisanja, atomarnost, row locking, konkurentnost, migracije, tenant izolaciju, paginaciju i UI regresije. Međutim, 487 prošlih testova ne znači 487 različitih produkcijskih korisničkih scenarija; dio testova prolazi kroz petlje i fixture varijante.

### 1.5 Tehnologije

Frontend i native:

- React 18.3
- TypeScript 5.5
- Vite 5.4
- Tailwind CSS 3.4
- Capacitor 7
- Lucide React
- `react-markdown`
- `html2canvas`, jsPDF, ExcelJS, JSZip

Backend:

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Edge Functions / Deno runtime
- Firebase Cloud Messaging za Android
- APNs za iOS
- Gemini API kroz Edge Function proxy

Testiranje i build:

- Node test runner
- PGlite
- TypeScript compiler
- ESLint
- npm/Vite
- Gradle 8/Android SDK 35
- iOS/Xcode projekt

---

## 2. Funkcionalna analiza

Ocjene su procjena komercijalne korisnosti i dovršenosti, ne veličina koda.

| Modul | Namjena i implementacija | Složenost | Dovršenost | Ocjena |
|---|---|---:|---:|---:|
| Nadzorna ploča | Finan­cijski i operativni pregled, zajednički overview iz cachea | Visoka | Funkcionalan | 8/10 |
| Gradilišta | Poslovni objekt, adresa, status, rokovi, dokumenti, zadaci, materijal, rekapitulacija | Vrlo visoka | Funkcionalan, velik UI | 8.5/10 |
| Djelatnici | Profil, status, cijene, bonusi, odsustva, dokumenti, povijest plaća, spremnost | Visoka | Funkcionalan | 8/10 |
| Vozila | Flota, kilometraža, status, servisi, jamstvo, dokumenti, trošak po km | Visoka | Funkcionalan | 8/10 |
| Gorivo | Točenja, potrošnja, anomalije, pragovi, portal za unos | Visoka | Funkcionalan | 8/10 |
| Alat i strojevi | Inventar, nabava, jamstvo, servisni intervali, stanja, radni sati | Visoka | Funkcionalan | 7.5/10 |
| Investitori/objekti | Relacijski registri i korisne veze prema gradilištima | Srednja | Funkcionalan | 8/10 |
| Kooperanti | Poslovni profil, kontakti, angažmani, ugovori, grupni računi, dokumenti i AI import | Vrlo visoka | Funkcionalan, složen | 8.5/10 |
| Stavke | Kataloška struktura i cijene | Srednja | Funkcionalan | 7.5/10 |
| Ponude | Podgrupe, izračun, PDF, status, povezano gradilište i povijest | Visoka | Funkcionalan | 8.5/10 |
| Dnevni raspored | Vozila, gradilišta, ekipa, drag/drop, potvrde, odsustva, objava radnicima, kilometri | Vrlo visoka | Ključni modul, funkcionalan | 8.5/10 |
| Terminski plan | Rokovi i planiranje prema gradilištima | Srednja/visoka | Funkcionalan | 7.5/10 |
| Radni nalozi | Nacrt, mobilna distribucija, zadaci, materijal, alati, vrijeme, kilometri, status, povrat | Vrlo visoka | Ključni modul, funkcionalan | 8.5/10 |
| Radno vrijeme | Ručni unosi, noćni sati, mjesečni obračun, odsustva | Visoka | Funkcionalan | 8/10 |
| Troškovi | Materijal, rad, gorivo, ugovoreni radovi, grupni računi i povrat | Visoka | Funkcionalan | 8/10 |
| Fakture | Izdavanje, status, rokovi, investitor, rabat, naplata | Srednja/visoka | Funkcionalan | 8/10 |
| Rekapitulacija | Site-level i globalna financijska slika, satnice, kategorije, izvoz | Visoka | Funkcionalan | 8.5/10 |
| Obavijesti | Rokovi, vozila, gorivo, ručni podsjetnici, riješena povijest | Srednja/visoka | Funkcionalan; nova migracija čeka produkciju | 7.5/10 |
| AI asistent | Poslovni sažetak, razgovor, web grounding, AI import računa/troškovnika | Srednja/visoka | Djelomično sazreo | 6.5/10 |
| Postavke/navigacija | Tema, satnica, prikazi, obavijesti, korisnički raspored izbornika | Srednja | Funkcionalan | 7/10 |
| Korisnici i prava | Pozivnice, aktivacija, povezana osoba, module edit/view, admin/platform vlasnik | Visoka | Funkcionalan | 8/10 |
| Tvrtke/platforma | Kreiranje i administracija tvrtki, platform owner | Visoka | Funkcionalan, ograničen SaaS ops | 7.5/10 |
| Mobilni portal | Radni nalozi, fotografije, materijal/alati, vrijeme, kilometri, osobni auto, gorivo | Vrlo visoka | Funkcionalan, touch UI | 8/10 |
| Push notifikacije | FCM/APNs tok implementiran, tenant-safe tokeni, ručno slanje naloga | Visoka | Funkcionalno u kodu; stvarna dostava neprovjerena | 6.5/10 |

### 2.1 Podmoduli s najvećom poslovnom vrijednošću

1. Dnevni raspored + radni nalozi.
2. Mobilni portal za djelatnike.
3. Automatski prijenos zadataka i materijala između naloga.
4. Radno vrijeme i trošak rada.
5. Kilometarski trošak vozila i dnevna raspodjela.
6. Financijska rekapitulacija.
7. Povijest izmjena i povrat brisanja.
8. Multi-company korisnici i dozvole.
9. Kooperantski računi i grupni troškovi.
10. AI pomoć pri računu/troškovniku, pod uvjetom kontrole rezultata.

### 2.2 Djelomično implementirano ili prototipno

- AI asistent: tehnički radi, ali nema dokazanu točnost, citiranu bazu odgovora, metering, latenciju ni troškovnu kontrolu.
- Push: infrastruktura je ozbiljna, ali fizička dostava na Android/iOS nije dokaziva iz repozitorija.
- Offline mobilni rad: nije pronađena durable offline baza, sync engine niti konfliktno usklađivanje.
- Licenciranje/pretplata: nema modula za pakete, invoicing SaaS pretplate ili feature entitlement po planu.
- Store release: native projekti postoje, ali prod signing, listing, privacy obrazac, TestFlight/Google Play testiranje nisu dokazani.
- Operational observability: nema evidentnog Sentry/Datadog/APM/sistemskog log pipelinea.

---

## 3. Arhitektura i kvaliteta koda

### 3.1 Organizacija

Pozitivno:

- jasna `src/components`, `src/lib`, `src/auth`, `supabase/migrations` podjela;
- feature viewovi imaju očekivane lokacije;
- shared UI postoji (`Field`, `Modal`, `Badge`, `PrivateImage`);
- centralni tipovi nalaze se u `src/types.ts`;
- lokalizacija i pomoćnici za rokove, servise, PDF i obračune odvojeni su u `src/lib/`.

Slabo:

- `api.ts` nije servisni sloj nego transversalni API za gotovo cijelu aplikaciju;
- veliki viewovi spajaju dohvat podataka, poslovna pravila, modal stanja, drag/drop, PDF i UI;
- navigacija nije URL-bazirana; `App` i lokalni state određuju trenutni ekran, što otežava bookmark, deep link i browser history.

### 3.2 Modularnost i održavanje

Ocjena: **5.5/10**.

Konkretniji problemi:

- `src/lib/api.ts` — 5.282 linije, više od 30 domenskih područja.
- `RasporedView.tsx` — 2.712 linije.
- `GradilisteDetailsPanel.tsx` — 2.195 linija.
- `MobileWorkOrdersView.tsx` — 2.165 linija.
- `KooperantiView.tsx` — 1.721 linija.
- `RegistryViews.tsx` — 1.675 linija.

Rizik: jedna promjena u radnom nalogu može utjecati na raspored, portal, financije, kilometre i povijest, a taj utjecaj nije zatvoren u jednom modulu.

### 3.3 Konfiguracija i tipizacija

Pozitivno:

- TypeScript `strict: true`;
- `noFallthroughCasesInSwitch`;
- izolirani moduli;
- aliasi `@/*`;
- striktan build prolazi.

Nedostatak:

- `noUnusedLocals` i `noUnusedParameters` isključeni u [`tsconfig.app.json`](tsconfig.app.json);
- veliki dio Supabase rezultata mapira se kroz `as`, ponekad kroz `any` u SQL testovima i specijalnim helperima;
- generički tipovi za PostgREST nisu centralno generirani iz stvarne sheme.

### 3.4 Duplikati i hardkodirane vrijednosti

Primjeri:

- slično ponašanje i UI za izvršenje naloga postoji u desktop i mobilnom portalu;
- povijest/resolve logika ponavljana je po modulima;
- `gemini-3-flash-preview` i drugi modeli bili su hardkodirani; fallback je sada uveden, ali model konfiguraciju treba držati u jednoj konfiguraciji;
- broj redaka paginacije `500` centraliziran je, ali broj stranica/povijest i refresh intervali često su hardkodirani;
- Android/iOS produkcijski bundle identiteti ispravno su migrirani, ali još zahtijevaju vanjsku Firebase/Apple konfiguraciju.

### 3.5 Upravljanje greškama

Ocjena: **7/10**.

Pozitivno:

- većina poslovnih API metoda baca stvarnu grešku;
- UI često razlikuje uspješan upis i neuspješan refresh;
- zaštitene funkcije vraćaju migracijske poruke;
- postoje history/conflict guardovi i optimističko zaključavanje.

Problemi:

- dio catch blokova namjerno degradira sadržaj na praznu listu;
- nema globalnog capturea grešaka;
- nema correlation ID-a za korisnički zahtjev i Edge Function log;
- povijesno su postojale generičke “non-2xx” Edge poruke;
- neke migracijske poruke su korisnički vidljive kao tehničke.

### 3.6 Model baze

Pozitivno:

- bogata povezanost poslovnih entiteta;
- company_id na tenant tablicama;
- indeksi po tipičnim relacijama i datumima;
- atomarne settlement i history funkcije;
- važni UNIQUE indeksi za lanac materijala/alata/zadataka.

Rizici:

- 201 migracija u kratkom razdoblju pokazuje brz i evolucijski razvoj;
- konačni model nije javno generiran u tipove;
- veliki broj SECURITY DEFINER funkcija povećava surface;
- copy-chain model za materijal/zadatke je snažan, ali teški za brzo razumijevanje i podatkovnu migraciju;
- migracijski ledger i produkcijski schema moraju se strogo uskladiti.

---

## 4. Sigurnosna analiza

### 4.1 Sažetak ozbiljnosti

#### Kritični

Nisu pronađeni **potvrđeni kritični propusti koji trenutno dokazuju cross-company pristup**.

To nije potvrda produkcije. Stvarni production policy set nije izvađen tijekom ove revizije.

#### Visoki

1. **Produkcijska RLS/migracijska provjera nije automatizirana i nije dokaziva iz repozitorija.** Početne migracije imaju izrazito široke politike `USING (true)`, a kasnije migracije ih trebaju zamijeniti. Ako produkcijska povijest preskoči kasniju hardening migraciju, posljedica je ozbiljna. Primjeri: [`20261013124641_create_construction_company_schema.sql`](supabase/migrations/20261013124641_create_construction_company_schema.sql), [`20261016150000_auth_permissions.sql`](supabase/migrations/20261016150000_auth_permissions.sql).
2. **Dependency audit:** `npm audit --omit=dev` prijavljuje 8 ranjivosti: 4 visoke i 4 srednje. Neke su uglavnom build-time/transitivne, ali aktualni produkcijski dependency set nije čist.
3. **Service-role logika u Edge Functions:** `manage-companies` i push funkcije zahtijevaju potpuno ispravne ručne tenant provjere. Svaki propust ima veliki učinak jer RLS se zaobilazi.
4. **Backup/restore nije standardiziran kao operativni proces.** Repo nema jasan periodički job, retention, restore test ili RPO/RTO dokaz.

#### Srednji

1. CORS Edge Functions dopušta `*`; JWT i backend autorizacija ostaju obvezni, ali origin ograničenje nije prisutno.
2. 326 migracijskih pojavljivanja `SECURITY DEFINER`; svaka funkcija mora imati fiksni `search_path`, ograničen EXECUTE i server-side auth.
3. AI šalje poslovni snapshot modelu prema korisnikovim pravima; treba formalni DPIA/politiku privatnosti i izričit opt-in za osjetljive podatke.
4. Push instalacijski dokaz i tokeni zahtijevaju strogo upravljanje uređajima, rotacijom i odjavom; stvarna produkcijska dostava nije dokazana.
5. Privatni dokumenti koriste signed URL-ove i privatni storage, ali detaljan lifecycle, retention i izvoz osobnih podataka nisu dokazani.
6. Role su dovoljno za radionicu, ali nema formalnog policy testinga za svaki endpoint i svaku novu tabelu.

#### Niski

1. `noUnusedLocals` i `noUnusedParameters` isključeni.
2. Tehničke migracijske poruke ponekad dopiru do korisnika.
3. Supabase/Firebase/Apple deployment djelomično ovisi o ručnoj dokumentaciji.

### 4.2 Autentikacija i autorizacija

Pozitivno:

- Supabase Auth;
- odobren profil i povezana tvrtka;
- module-level `view/edit`;
- platform owner, admin i worker portal;
- worker access preko povezane osobe;
- server-side permission RPC u Edge Functions.

Nedostaci:

- nema vidljivog formalnog RBAC matrice dokumenta za svaki objekt i akciju;
- admin i platform owner putovi trebaju redovite cross-company negativne testove;
- licencna prava nisu odvojena od funkcionalnih prava.

### 4.3 Multi-company

Repo sadrži dobar dizajn:

- `company_id` na tenant tabelama;
- restriktivne tenant politike;
- trigger za usklađivanje `company_id` s FK zapisima;
- Edge Function filtriranje po profilu i tvrtki;
- AI i push koriste aktivni company kontekst.

Dokaz: [`20261021100000_multi_company.sql`](supabase/migrations/20261021100000_multi_company.sql).

Neprovjereno:

- je li svaka novija tablica nakon tenant migracije dobila company policy;
- je li produkcijska shema potpuno usklađena s migracijama;
- jesu li sve service-role funkcije pravilno filtrirane.

### 4.4 Tajne i datoteke

- Klijentski Supabase anon/publishable ključ je očekivan.
- Privatni Firebase/APNs/Gemini ključevi moraju ostati samo u Edge Secretima.
- `google-services.json` je konfiguracijski, ali ne privatna korisnička baza; unatoč tome ostaje van repozitorija.
- Storage je privatan; signed URL-ovi imaju vremensko ograničenje.
- Nije pronađen jasan proces rotacije tajni, DLP skeniranja ili revizije access key logova.

### 4.5 Ovisnosti

Zadnji `npm audit --omit=dev` izvršen tijekom revizije:

| Težina | Broj |
|---|---:|
| Kritične | 0 |
| Visoke | 4 |
| Srednje | 4 |
| Niske | 0 |

Najvažniji obrasci: `brace-expansion`, `minimatch`, `cross-spawn`, `ws`, `uuid`, `glob` i lanac `exceljs → uuid`. Dio problema dolazi iz build/nativnog CLI lanca, ne nužno runtime preglednika, ali ovisi o tome gdje se koristi.

### 4.6 Push

Pozitivno:

- FCM i APNs;
- token lifecycle;
- instalacijski proof;
- company filtriranje;
- invalid-token cleanup;
- notification channel.

Neprovjereno:

- dostava na fizičkim uređajima;
- Android OEM battery restrictions;
- iOS production signing/certifikat;
- rate limiting prema FCM/APNs;
- delivery analytics i retry queue.

### 4.7 Backup, DR i migracije

Procjena: **4/10**.

Repo ima složen history/recovery za poslovne zapise, što je vrlo pozitivno. Međutim, to nije zamjena za:

- automatski full database backup;
- Supabase PITR;
- izolirani backup Storage datoteka;
- restore drill;
- dokumentirani RPO/RTO;
- migracijski rollback paket za svaku produkcijsku promjenu.

---

## 5. Performanse i skalabilnost

### 5.1 Stvarno izmjereno

- Puni testni suite prolazi u lokalnom okruženju.
- Typecheck, lint i production build prolaze.
- Grupirana rekapitulacija smanjuje opterećenje s broja gradilišta putem pojedinačnog agregacijskog RPC-a.
- Sidebar brojači koriste exact HEAD upite.
- Deferred file loading odgađa dokumente/fotografije.
- Radni nalozi dijele execution cache između detalja i modala.
- AI snapshot ima 5-minutni cache i više ne učitava isti snapshot za svako pitanje.

Nije izmjereno:

- vrijeme odgovora produkcije;
- SQL query planovi na stvarnom volumenu;
- P95/P99 po ekranu;
- broj aktivnih websocket/HTTP veza;
- propusnost Storagea;
- ponašanje s 200 ili 2.000 istodobnih korisnika.

### 5.2 Poznata uska grla

1. `fetchAllRows` koristi 500-redne sekvencijalne stranice.
2. Nekoliko UI viewova učitava pune liste i filtrira u pregledniku.
3. Nema Evidentiranog virtualiziranja velikih tablica; DOM raste s podacima.
4. Polling na 15–60 sekundi proizvodi ponavljajuće zahtjeve.
5. AI snapshot može i dalje biti velik pri dugom povijesnom radnom vremenu.
6. PDF generiranje je klient-side i zahtjevno po CPU/memoriji.
7. Veliki Excel importi mogu zauzeti browser memoriju.
8. Fotografski uploadovi koriste kompresiju, ali masovno korištenje zahtijeva kvote.
9. SQL poslovna logika je bogata i treba query plan nadzor.

### 5.3 Scenariji

| Okruženje | Procjena | Potrebno |
|---|---|---|
| 1 tvrtka / 20 korisnika | Vjerojatno dobro uz normalni Supabase plan | Osnovne mjere upita i backup |
| 10 tvrtki / 200 korisnika | Upravljivo, ali rizik polling/pagination | Load test, index review, rate limits |
| 100 tvrtki / 2.000 korisnika | Neprovjereno; opravdan rizik velikih lista i RPC lockova | APM, query plans, queue/worker, sharding plan |
| 500 tvrtki / 10.000 korisnika | Trenutno ne može biti proglašeno spremnim | Formalna capacity arhitektura, DB read scaling, CDN, async obrada |

Ove procjene nisu benchmark.

---

## 6. Korisničko iskustvo

### Prednosti

- hrvatsko sučelje i specifična terminologija;
- dobar posao na tipičnim operativnim tokovima;
- izuzetno široka pokrivenost poslovnih potreba;
- touch-friendly mobilni portal;
- brza navigacija među modulima;
- jasni statusni badgeovi;
- povijesti i povrat podataka smanjuju strah od pogreške.

### Nedostaci

1. Navigacija nema URL rute, deep linkove ili browser back ponašanje.
2. Veliki modali i dugi paneli zahtijevaju puno scrollanja.
3. Nekoliko ekrana ima guste tablice i mnogo kontrola.
4. Nedostaje konzistentan globalni UX za “spremanje, čekanje, retry, uspješno”.
5. AI odgovori nisu streaming.
6. Ne postoji započeta korisnička tura ili onboarding checklist.
7. Pristupačnost nije sistematski testirana.
8. Mobilni portal je dobar za djelatnike, ali nije puna mobilna verzija cijelog ERP-a.
9. Ručne obavijesti i riješena povijest novo su uvedene mogućnosti; treba korisnički feedback.
10. Nema formalnog command searcha ili globalne pretrage.

### Česti tijekovi

- Kreiranje radnog naloga: značajno optimizirano; još ima više DB operacija iza scene.
- Knjiženje računa kooperanta: dobar AI import, ali mora podnijeti i vrlo velike/skupne greške jasnijim korisničkim odgovorima.
- Završetak naloga: bogat, ali zahtijeva mnogo potvrda.
- Kreiranje nove tvrtke: funkcionalno, ali nije komercijalno self-service.

---

## 7. Mobilna aplikacija

### Spremnost

| Tema | Stanje |
|---|---|
| Android tehnologija | Capacitor wrapper — spreman za build |
| iOS tehnologija | Capacitor — spreman za build, signing potreban |
| Android push kod | Implementiran |
| iOS APNs kod | Implementiran |
| Autentikacija | Supabase Auth |
| Token lifecycle | Tenant-aware, rotation i logout logika |
| Fotografije | Kompresija, upload, private URL |
| Dokumenti | Podržani s privatnim Storage pristupom |
| Offline | Ne postoji potpuni offline sync |
| Djelatnički portal | Najzrelija mobilna površina |
| Store readiness | Neprovjerena |

### Ključni blockers

- Fizička testiranjе FCM/APNs i cold start nisu automatski potvrđeni.
- Offline uređaji mogu izgubiti tijek rada kada nestane mreža.
- Upload callback/retry treba testirati na lošim 4G/5G vezama.
- Push dopuštenja, battery optimization i background delivery nisu izmjereni na različitim OEM uređajima.
- iOS Apple signing/provisioning nije dokaziv u ovom okruženju.
- Store privacy, consent, deletion/export osobnih podataka i policy tekst nisu potpuni.

---

## 8. Komercijalna spremnost

### Pozitivno

- Multi-company model i company context postoje.
- Admin može upravljati korisnicima i pravima.
- Platform owner ima površinu tvrtki.
- Moduli mogu biti onemogućeni po tvrtki.
- Invitation-based onboarding postoji.
- Poslovni podaci su razdvojeni po `company_id`.
- APK/Capacitor pipeline postoji.

### Nedostaje prije ozbiljne SaaS prodaje

1. Subscription/billing model i paketiranje.
2. Trial, suspendiran tenant i automatsko gašenje zbog neplaćanja.
3. Usage-based limits i quota.
4. Billing invoicing za GradTech, ne samo ERP fakture klijenata.
5. Centralni tenant health i aktivnost dashboard.
6. Self-service onboarding za prvu tvrtku.
7. Seed/demo tenant i reset demo podatka.
8. Uvoz podataka i migracijski alat za novog klijenta.
9. Izvoz kompletnih podataka i korisnički prenosivost.
10. SLA, DPA, privacy policy, uvjeti korištenja.
11. Podrška i ticketing.
12. Formalni incident, rollback i deployment runbook.
13. APM, error monitoring i audit log review.
14. Backup restore drill.

### Prepreke prvom vanjskom klijentu

Obvezno:

- potvrditi finalni schema/migration ledger;
- odraditi production backup i restore test;
- izvršiti security review stvarnih RLS politika;
- osigurati monitoring;
- odraditi fizički Android/iOS acceptance test;
- primijeniti sve nove migracije;
- dokumentirati potpuni onboarding;
- definirati support/SLA;
- osigurati dependency security baseline.

---

## 9. Procjena troška razvoja

Ovo je procjena za izgradnju **ekvivalentnog proizvoda od nule** profesionalnim timom, ne izračun današnje tržišne vrijednosti.

### Pretpostavke

- srednje senior tim;
- postojeća poslovna logika i zahtjevi su već poznati;
- uključuje temeljan multi-company ERP, mobilni portal i Supabase backend;
- uključuje testove i deployment, ali ne prodajne i operativne troškove;
- ne uključuje cijenu Supabase/AI/Apple/Google usluga;
- satnice se namjerno ne prevode u EUR.

| Kategorija | Konzervativno | Srednji scenarij |
|---|---:|---:|
| Poslovna analiza i specifikacija | 700 h | 500 h |
| UX/UI dizajn i design system | 1.000 h | 700 h |
| Frontend React/Vite | 5.800 h | 4.300 h |
| Backend/API/Edge Functions | 5.500 h | 4.000 h |
| Baza, RLS, migracije, SQL funkcije | 3.200 h | 2.300 h |
| Android/iOS/Capacitor | 2.200 h | 1.600 h |
| AI import i asistent | 700 h | 500 h |
| Sigurnosni dizajn i hardening | 1.500 h | 1.100 h |
| Automatizirani testovi i QA | 3.600 h | 2.700 h |
| DevOps, deployment, operacije | 1.100 h | 800 h |
| Dokumentacija i onboarding | 700 h | 500 h |
| **Ukupno** | **26.000 h** | **18.900 h** |

Ekvivalent:

- konzervativno: približno **15 osobogodišnjih iskustava razvoja**;
- srednje: približno **11 osobogodišnja razvoja**.

Tim od 8–12 osoba realno bi takav opseg radio oko 18–24 mjeseca, uz aktivnu domensku suradnju naručitelja.

Ova procjena nije tržišna vrijednost softvera, budući IP, potencijal prihoda ni cijena licence.

---

## 10. Završna ocjena

| Kategorija | Maksimum | Ocjena | Obrazloženje |
|---|---:|---:|---|
| Funkcionalnost | 20 | **16.5** | Široka i realno povezana domena |
| Arhitektura i kod | 15 | **9.0** | Dobra podjela top-level, veliki monoliti i centralni API |
| Sigurnost | 15 | **10.0** | Dobar RLS model, ali production/migration/operativni dokaz manjkaju |
| UX/UI | 10 | **7.0** | Korisno i specifično, ali gusto i složeno |
| Stabilnost i testovi | 10 | **8.0** | Odličan regresijski skup; nema E2E/coverage/load dokaza |
| Performanse i skalabilnost | 10 | **5.5** | Neke optimizacije postoje; nema stvarne kapacitetne mjere |
| Mobilne aplikacije | 5 | **3.5** | Jak portal, no offline i native release nepotvrđen |
| Komercijalna spremnost | 10 | **5.5** | Multi-company postoji, SaaS ops i billing nedostaju |
| Dokumentacija i održavanje | 5 | **3.5** | Mnogo workflow dokumentacije, malo DR/SLO/runbooka |
| **Ukupno** | **100** | **68.5 / 100** | Zaokruženo: **69/100** |

Najpravednija interpretacija: **vrlo razvijen proizvod za pilot i ograničen broj klijenata, ali još nije dokazano spreman za agresivnu SaaS distribuciju i veliki broj tvrtki**.

---

## 11. Plan razvoja

### P0 — obvezno prije prvog vanjskog klijenta

| Zadatak | Trud | Korist | Rizik |
|---|---:|---|---|
| Potvrditi produkcijske migracije, RLS i grants auditnom skriptom | 3–5 dana | kritična sigurnost | Srednji |
| Production backup/PITR + restore drill | 3–5 dana | opstanak podataka | Visok ako izostane |
| Release runbook s deploymentom i rollbackom | 2–3 dana | kontroliran release | Srednji |
| Riješiti/ažurirati npm high ranjivosti | 1–3 dana | sigurnost lanca | Srednji |
| Fizički Android/iOS push i auth test | 3–5 dana | mobilno povjerenje | Srednji |
| Dodati Sentry/APM/logging i upozorenja | 4–7 dana | incident visibility | Srednji |
| Security regression za svaku novu tablicu/RPC | 5–8 dana | sprječavanje cross-tenant grešaka | Srednji |
| Definirati tenant DPA/privacy/retention | 5–10 dana | pravna/spremnost | Visok |
| E2E test core flowa | 5–10 dana | stabilnost | Srednji |
| Formalni smoke test svih pending migracija u stagingu | 2–4 dana | sigurnije objave | Srednji |

### P1 — poželjno prije komercijalne prodaje

| Zadatak | Trud | Korist | Rizik |
|---|---:|---|---|
| Load test za 20/200/2000 korisnika | 5–10 dana | realna skalabilnost | Visok |
| Podijeliti `api.ts` po domenama | 5–10 dana | održavanje | Srednji |
| Podijeliti Raspored i MobileWorkOrders | 10–20 dana | manje regresija | Visok |
| URL routing i deep links | 5–8 dana | UX | Srednji |
| Tenant onboarding wizard | 7–12 dana | brže uvođenje | Srednji |
| Billing/paketni planovi | 15–30 dana | komercijalizacija | Visok |
| Monitoring SLA dashboard | 5–10 dana | operacije | Srednji |
| AI observability, usage limit i fallback | 5–8 dana | kontrola troška/točnosti | Srednji |

### P2 — nakon prvih klijenata

| Zadatak | Trud | Korist | Rizik |
|---|---:|---|---|
| Offline queue/sync za mobilni nalog | 15–30 dana | rad na terenu | Visok |
| Global search | 5–10 dana | produktivnost | Srednji |
| Standardizirani data import/export | 10–20 dana | onboarding | Srednji |
| Stvarna i mjerljiva accessibility provjera | 4–7 dana | pristupačnost | Nizak |
| UI virtualizacija velikih lista | 5–10 dana | performanse | Srednji |
| Tenant usage dashboard | 7–12 dana | SaaS operacije | Srednji |

### P3 — dugoročno

| Zadatak | Trud | Korist | Rizik |
|---|---:|---|---|
| Modularni/domain service arhitektura | 30–60 dana | skaliranje tima | Visok |
| Background queue za teške zadatke i obavijesti | 10–20 dana | pouzdanost | Srednji |
| Event/audit analitika | 10–20 dana | business intelligence | Srednji |
| White-label/branding po tvrtki | 10–15 dana | enterprise | Srednji |
| Plugin/integration SDK | 20–40 dana | ekosustav | Visok |

---

## 10 najvećih prednosti

1. Zbilja pokriva cijeli operativni tijek gradilišta do rekapitulacije.
2. Multi-company model već postoji.
3. Mobilni portal nije površna izvedba, već stvarni workflow.
4. Dobra povijest izmjena, oporavci i zaštite od djelomičnog spremanja.
5. Rad s fotografijama, dokumentima i privatnim Storage pristupom.
6. Snažan model radnih naloga, ekipa, materijala, zadataka i kilometraže.
7. Mnoge kritične SQL operacije atomarne su i testirane.
8. Regrеsijski testovi imaju ozbiljan broj i stvarnu SQL integraciju.
9. UI i poslovni terminologija specifični su za hrvatsko tržište.
10. Postoji tehnička osnova za AI, push, mobilne aplikacije i komercijalni SaaS.

## 10 najvećih nedostataka

1. Nije potvrđen proces produkcijskih migracija/RLS iz stvarne baze.
2. Nema dokazivog backup/PITR restore procesa.
3. Nema centralnog monitoringa, alertinga i incident runbooka.
4. `api.ts` i nekoliko viewova su preveliki.
5. Nema učinkovitog URL routing/deep-link modela.
6. Nema E2E, load testova ni coverage izvještaja.
7. Nema offline synca.
8. Nema billing/licensing/subscription modela.
9. Package audit ima 4 visoke ranjivosti.
10. AI i push imaju tehnički dobru osnovu, ali produkcijski učinak i dostavu treba realno potvrditi.

---

## Izričito neprovjereno

Sljedeće nije moguće potvrditi samo iz repozitorija:

- stvarni produkcijski migracijski ledger;
- stvarne produkcijske RLS politike i grants;
- stvarne Supabase/Firebase/Apple tajne i expiry;
- uspješnost stvarnih FCM/APNs notifikacija;
- broj i veličina produkcijskih tablica;
- stvarne latency i throughput vrijednosti;
- backup/PITR retention i uspješan restore;
- production signing i store approval;
- GDPR/DPA pravni dokumenti;
- SLA, podrška i incident response tim;
- stvarna naplata GradTech pretplata.

## Završna preporuka

GradTech je dovoljno bogat i tehnički razvijen za **kontrolirani pilot s jednom ili nekoliko tvrtki**, uz aktivni nadzor razvoja i operacija. Nije preporučljivo odmah prodavati ga kao zreli široki SaaS za stotine tvrtki bez P0 paketa i load/security provjere.

Najbolji sljedeći poslovni korak nije nova velika značajka, nego potvrditi produkcijsku sigurnost, oporavak, monitoring i fizički mobilni tijek. Nakon toga bi platforma imala čvrstu osnovu za komercijalnu ekspanziju.
