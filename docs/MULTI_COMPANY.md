# GradTech: više tvrtki

## Plan i izvedba

1. `tvrtke` sadrži naziv, OIB, adresu i status. Svaki profil pripada točno jednoj
   tvrtki; članstvo se ne bira u pregledniku i ne može se mijenjati običnim API pozivom.
2. `company_id` je obvezan na poslovnim tablicama, uključujući povezane stavke,
   rasporede, financije, dokumente, fotografije, korisnička prava i povijest promjena.
   Dokumenti i fotografije koriste postojeće tablice (`gradiliste_dokumenti`,
   `radni_nalozi_dokumenti`, `radni_nalozi_foto`, `radnici_dokumenti`,
   `vozila_dokumenti`, `oprema_dokumenti`); ne uvode se paralelni registri.
3. Dodatne **restriktivne** RLS politike zahtijevaju tvrtku prijavljenog korisnika,
   uz postojeća prava po modulima i ograničenja mobilnih radnih naloga. Ni
   administrator tvrtke niti vlasnik sustava time ne dobivaju tuđe poslovne podatke.
4. Trigeri provjeravaju tvrtku na svim postojećim poslovnim stranim ključevima.
   Zapis se ne može premjestiti u drugu tvrtku, niti povezati s tuđim radnikom,
   gradilištem, opremom, nalogom ili profilom.
5. Izvorne mobilne SECURITY DEFINER implementacije premještaju se u neizloženu
   shemu `private`. Javne funkcije zadržavaju potpise i provjeravaju tvrtku prije
   poziva. Izravno izvršavanje privatnih implementacija nije dopušteno klijentima.
6. Privatni Storage zadržava postojeće putanje datoteka. Dodatna politika provjerava
   tvrtku vlasničkog entiteta u putanji; postojeće potpisane poveznice vrijede do
   svojeg isteka. Prenesene/kopirane datoteke izvan sustava nije moguće opozvati.
7. Postavke ponuda i raspored stupaca imaju zaseban redak po tvrtki. Brojevi naloga
   i ponuda dodjeljuju se atomskim brojačem po tvrtki/godini. Ručno upisani postojeći
   brojevi uzimaju se u obzir; neiskorištene rezervacije mogu ostaviti praznine.
8. Lokalna poslovna konfiguracija, AI ključ i evidencija obavijesti odvojeni su po
   tvrtki. Promjena računa poništava prethodni kontekst i ponovno montira aplikaciju.
   Stare lokalne financijske/postavke ponuda prenose se samo početnoj tvrtki.
9. Vlasnik sustava ima ekran **Tvrtke** za otvaranje/aktivaciju tvrtki i pozivanje
   njihovih administratora. Administrator tvrtke poziva djelatnike iz **Korisnici
   i prava** i dodjeljuje im postojeća prava po modulima.
10. Nema aplikacijskog ograničenja broja djelatnika ili računa po tvrtki. Popisi
    radnika, korisnika i njihovih prava dohvaćaju se stranicama, a ne samo do
    standardne granice od 1000 redaka. Kapacitet infrastrukture i Supabase plan
    i dalje određuju stvarne tehničke resurse.

## Prijenos postojećeg sustava

**Prvo napraviti sigurnosnu kopiju baze i Storagea te provjeriti postupak na
staging kopiji.** Migraciju primijeniti u terminu održavanja jer zaključava
tablice tijekom promjene sheme i prijenosa.

Preduvjeti:

- Sve prethodne migracije moraju biti primijenjene.
- Postojeći profil `ivan.pericak@gmail.com` mora postojati. Samo taj račun dobiva
  `is_platform_owner`; ostali administratori ostaju administratori svoje tvrtke.
- Za novu instalaciju taj račun treba izraditi kroz Supabase Auth **prije** ove
  migracije; javna registracija nakon nje više nije dopuštena.
- Migraciju izvršava vlasnik baze, ne obični korisnik aplikacije.

Primijeniti [migraciju](../supabase/migrations/20261021100000_multi_company.sql)
kao jednu transakciju (Supabase migration runner ili `BEGIN; ... COMMIT;` u SQL
Editoru). Ona:

- otvara **Tm-color d.o.o.**, OIB **29191529726**, adresa **Karlovačka cesta 60,
  47280 Ozalj**;
- sve postojeće podatke i profile povezuje s tom tvrtkom, bez promjene odobrenja,
  administratorskih prava, dodijeljenih modula ili ID-jeva;
- provjerava veze, postavlja `NOT NULL`, indekse, RLS i zaštitu funkcija;
- privremeno isključuje i vraća izvorni način rada korisničkih trigera za sam
  backfill kako prijenos ne bi stvarao lažne promjene u dnevniku naloga.

[Skripta prijenosa/provjere](../supabase/scripts/assign_existing_company.sql) može
se ponovno pokrenuti kao vlasnik baze: dodjeljuje samo zapise s praznom tvrtkom i
prikazuje kontrolne brojeve. Ne premješta već dodijeljene zapise između tvrtki.
Ne pokretati stare migracije ponovno nakon nove sheme.

## Objavljivanje i pozivnice

1. U Supabase Secrets postaviti `APP_URL` na produkcijski HTTPS URL aplikacije.
   Taj URL dodati i u Supabase Auth Redirect URLs. Ne koristiti URL iz korisničkog
   zahtjeva kao odredište pozivnice.
2. Konfigurirati produkcijski SMTP i Supabase Auth predložak pozivnice. E-pošta
   koristi službenu Auth pozivnicu; tvrtka i uloga dolaze iz zaštićene tablice
   pozivnica, a ne iz promjenjivih korisničkih metapodataka.
3. Deployati obje funkcije:

   ```powershell
   supabase functions deploy manage-companies
   supabase functions deploy notify-work-order
   ```

   `SUPABASE_SERVICE_ROLE_KEY` ostaje samo na poslužitelju. Ne stavljati ga u
   klijent, `.env` ili repozitorij.
4. Objaviti novi web build. Za mobilne klijente pokrenuti build i Capacitor sync
   te izraditi/distribuirati nove Android/iOS pakete. Stare verzije klijenta nisu
   podržane za nove postavke i brojače.
5. Vlasnik se prijavi, otvori **Tvrtke** i unese novu tvrtku te adresu prvog
   administratora. Administrator iz e-pošte otvara aplikaciju i postavlja lozinku.
6. Administrator poziva svoje djelatnike, dodjeljuje prava i po potrebi ih
   povezuje s njihovim zapisima u modulu **Radnici**. Novi obični korisnik nema
   prava na module dok mu ih administrator ne dodijeli.

### Prva prijava djelatnika

1. Administrator šalje pozivnicu kroz **Korisnici i prava → Pošalji pozivnicu**.
2. Djelatnik otvara poveznicu iz primljenog e-maila (provjeriti i neželjenu poštu).
3. U aplikaciji postavlja lozinku od najmanje 8 znakova i ponavlja je radi provjere.
4. Za sljedeće prijave koristi pozvani e-mail i spremljenu lozinku.

Običan obrazac prijave ne registrira korisnika. Pogreška „Invalid login
credentials” znači neispravne pristupne podatke, a ne problem s odobrenjem ili
pravima modula. Klijent prikazuje hrvatsku poruku s uputama za prvi pristup i
oporavak lozinke, bez otkrivanja postoji li uneseni račun. Za postojeći račun
zaboravljena lozinka šalje novu poveznicu; taj postupak ne stvara novi račun.

### GradTech pozivnica i Gmail pošiljatelj

Pripremljen je [HTML predložak pozivnice](../supabase/templates/invite-user.html)
s kontaktom `ivan.pericak@gmail.com`. Datoteka sama ne mijenja Supabase postavke.
U Supabase Dashboardu otvoriti **Authentication → Email Templates → Invite user**
(u novijem sučelju pod **Authentication → Emails**), postaviti predmet
**Dobro došli u GradTech – prihvatite pozivnicu**, zalijepiti cijeli HTML i spremiti.
Predložak sadrži hrvatski pregledni tekst poruke, tamno zaglavlje GradTech,
plavi gumb i odvojene upute za prvi pristup. Promjena SMTP pošiljatelja ne
mijenja sadržaj e-maila: ažurirani HTML treba posebno spremiti u **Invite user**.
Zadržati `{{ .ConfirmationURL }}`: Supabase njime generira službenu poveznicu
pozivnice. Ne zamijeniti ga običnim URL-om aplikacije.

Za slanje s Gmail računa:

1. Na Google računu `ivan.pericak@gmail.com` uključiti potvrdu u dva koraka.
2. U [Google App Passwords](https://myaccount.google.com/apppasswords) stvoriti
   zasebnu lozinku za aplikaciju, naziva npr. **GradTech Supabase**. Ako opcija
   nije dostupna, račun ili njegova sigurnosna pravila možda je ne podržavaju;
   koristiti drugog SMTP pružatelja, ne isključivati zaštitu računa.
3. U Supabase **Authentication → SMTP Settings** uključiti custom SMTP:

   | Polje | Vrijednost |
   |---|---|
   | Sender email | `ivan.pericak@gmail.com` |
   | Sender name | `GradTech` |
   | Host | `smtp.gmail.com` |
   | Port | `587` (STARTTLS) |
   | Username | `ivan.pericak@gmail.com` |
   | Password | Googleova lozinka za aplikaciju |

   Lozinku upisati samo u zaštićene SMTP postavke Supabase Dashboarda.
   Ne koristiti glavnu Google lozinku i ne spremati vjerodajnice u repozitorij,
   `.env`, SQL migraciju ili chat. Promjena glavne Google lozinke poništava
   lozinke za aplikacije pa treba ažurirati i SMTP postavke.
4. Provjeriti **Authentication → URL Configuration**: Site URL i dopuštene
   Redirect URLs moraju odgovarati stvarnoj aplikaciji; `APP_URL` u Supabase
   Secrets mora biti ispravno postavljen za postojeću funkciju pozivnica.
5. Poslati pozivnicu na novu testnu adresu preko **Korisnici i prava**. Provjeriti
   pošiljatelja, izgled poruke, otvaranje poveznice, dvostruki unos lozinke i
   naknadnu prijavu. Zasebno provjeriti **Zaboravljena lozinka?**.

SMTP postavke vrijede za sve Supabase Auth poruke (uključujući oporavak lozinke),
a ovaj HTML samo za pozivnice. Ne mijenjaju slanje push obavijesti.
Gmail je privremeno rješenje za manji broj poruka, s Googleovim i Supabaseovim
ograničenjima slanja; za veći obujam koristiti namjenski transakcijski SMTP.
Odgovori na pozivnicu stižu u navedeni Gmail sandučić. Lozinka za aplikaciju
ne mijenja uobičajenu prijavu u Gmail.

Izvori: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
i [Googleove lozinke za aplikacije](https://support.google.com/accounts/answer/185833).

Postojeći račun ne može se pozivnicom premjestiti u drugu tvrtku. Ista e-mail
adresa koristi jedan račun u jednoj tvrtki. Za ponovnu dostavu već kreirane Auth
pozivnice koristiti Supabase Auth postupak ponovnog slanja; ne brisati korisnika
koji već ima podatke. Ako slanje pozivnice zakaže, ekran izričito prikazuje
grešku; otvorena tvrtka ostaje vidljiva i može joj se zasebno pozvati administrator.
Deaktivacija tvrtke odmah blokira nove pristupe bazi/funkcijama; otvoreni klijent
osvježava status pri sljedećoj provjeri prijave.

## Provjere

[SQL integracijski test](../supabase/tests/multi_company.sql) izvršiti kao
`postgres` na testnoj bazi nakon migracija. Test stvara odvojenu tvrtku i testne
račune, provjerava izolaciju čitanja/pisanja, strane ključeve, Storage, RPC-e,
prava modula, mobilnu ekipu, zasebne postavke/brojeve, više od 1000 djelatnika,
zabranu javne registracije i blokadu deaktivirane tvrtke. Sve vraća kroz `ROLLBACK`.
Ne pokretati test na produkciji.

Klijentske provjere: `npm run test:company` (Node testovi paginacije, odvojenih
lokalnih postavki i autorizacije serverskih pozivnica), `npm run typecheck`,
ciljani ESLint i `npm run build`.
Edge funkcije: `deno check` za obje funkcije. Posebno na stagingu provjeriti stvarno
slanje/otvaranje pozivnice, postavljanje lozinke, prijavu s računima dviju tvrtki,
upload i potpisane poveznice te Android tok radnog naloga.

Stari skup migracija očekuje stupac `gradilista.investitor` koji prethodne
migracije ne stvaraju. Lokalna PostgreSQL provjera koristila je taj dodatni
legacy stupac kao fixture; postojeća povijesna migracija nije prepisana.
