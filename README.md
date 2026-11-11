# Tm-color

## Provjere prije objave

### Zajedničko izvršenje i read-only otvaranje radnog naloga

Detalj naloga i modal **Uredi** dijele stanje izvršenja po ID-u naloga tijekom boravka u modulu. Ekipa/vremena, zadaci, materijal, inventar alata i strojeva te kilometri, napomena i oznake izvršenja učitavaju se jednom. Otvaranje **Uredi** nakon uspješnog učitavanja detalja dodaje **0 zahtjeva za tih šest izvora** umjesto prethodnih šest; aktivni zahtjevi također se dijele. Prazan rezultat smatra se učitanim, a nakon djelomične pogreške ponavlja se samo neuspješan izvor. Izmjene i blokade spremanja sati/zadataka/stavki vidljive su u oba prikaza. Fotografije, dokumenti i povijesti ostaju zasebno odgođeni do otvaranja pripadajućeg prikaza.

Cache nije globalan: odvaja naloge i ponovno se stvara pri promjeni korisnika, tvrtke ili ovlasti te nakon izlaska iz modula. Dok je detalj otvoren, modal koristi iste podatke; nakon napuštanja svih prikaza jednog naloga, ponovni odabir tog naloga ponovno provjerava izvore kao ranije. Postojeće ponovno učitavanje liste nakon spremanja/povrata invalidira izvršenja, tako da se promijenjena ekipa ili vraćeni podaci ponovno učitaju. Nema trajnog spremanja cachea u preglednik.

Samo otvaranje više ne sprema poslovođu ni početak rada 06:00 i ne poziva obračun sati/troškova/kilometara. Ako vrijeme nije uneseno (i nije označeno nula sati), 06:00 ostaje samo prikazana početna vrijednost; isto vrijedi za predloženog poslovođu kada nalog ima jednog djelatnika. Nedostajuće vrijednosti spremaju se tek pri izričitom spremanju osnovnog naloga ili izvršenja (kilometri/napomena, radno vrijeme, teren, promjena završnog statusa). Nedostajući počeci spremaju se jednim uvjetnim batch ažuriranjem, bez zasebnog obračuna po djelatniku; postojeće spremanje zatim koristi svoj dosadašnji obračun. Već upisani počeci, nula sati i postojeći poslovođa ne prepisuju se inicijalizacijom. Pogreške inicijalizacije prikazuju se, a naknadno spremanje može ih ponovno pokušati. Kreiranje naloga već zadržava postojeće postavljanje jedinog djelatnika kao poslovođe.

Nije potrebna nova SQL migracija; objaviti web-build. Provjere: `node --test tests/nalog-execution-cache.test.mjs tests/copied-completion-ui.test.mjs tests/deferred-files.test.mjs`. Testovi izvršavaju zajednički store i stvarnu komponentu s lokalnim API zamjenama: nula dodatnih zahtjeva za modal, dijeljenje aktivnih zahtjeva/izmjena, dohvat nedostajućeg izvora, read-only otvaranje, spremanje početnih vrijednosti tek na korisničku radnju, greške i izolaciju cachea. Nisu mjerenje produkcijskog Network prometa.

### Grupirana rekapitulacija svih gradilišta

Primijeniti `supabase/migrations/20261110700000_rekapitulacija_grupirani_sazeci.sql` prije objave novog web-builda. Zadani pregled svih gradilišta više ne poziva šest upita za svako gradilište. Jedan read-only RPC grupira troškove po gradilištu/kategoriji, sate i rad po satnicama, fakture s postojećim smjerom rabata, plaćene fakture i ugovorene iznose. Povezane izvore agregira odvojeno prije spajanja, bez umnožavanja redaka. Nalozi i rokovi ne dohvaćaju se za pregled svih gradilišta jer se ondje ne prikazuju; detaljni pregled pojedinačnog gradilišta i dalje ih učitava postojećim putem.

Za 20 gradilišta pregled sada traži jedan zahtjev sa sažecima umjesto 120 detaljnih zahtjeva (plus postojeći dohvat liste gradilišta). Sažeci se paginiraju po 500 gradilišta uz stabilan redoslijed; broj poziva ne ovisi o broju troškova/sati po gradilištu. Ne prenose se pojedinačni troškovi, sati, fakture ni dokumenti. Prazna gradilišta ostaju u rezultatu s nulama. Pogreška ili nedostupan sažetak ne zamjenjuje se nulom niti parcijalnim uspjehom.

Funkcija je `STABLE SECURITY INVOKER`, ograničena na prijavljene korisnike, postojeći RLS svih izvornih tablica i trenutačnu tvrtku. Nema proširivanja prava ni potpisivanja datoteka. Univerzalna satnica i način obračuna po djelatnicima mijenjaju rezultat odmah lokalno bez novog RPC-a; nedostupna/neunesena satnica koristi univerzalnu, a spremljena nula ostaje nula. Kategorije, statusni filtar, sortiranje, izvoz i otvaranje detalja ostaju dostupni. Kartica financija zadržava postojeći grupni dohvat potreban njezinim detaljnim filtrima.

Provjera: `node --test tests/recap-grouped.test.mjs`. Stvarni SQL testiran je za RLS, drugu tvrtku, skrivene djelatnike, rabate, negativne iznose, prazna gradilišta i više od 1000 zapisa. API/UI testovi provjeravaju broj zahtjeva, paginaciju, greške te iznose prikaza/izvoza pri promjeni satnice, načina obračuna, statusa i sortiranja.

### Zajednički globalni brojači i obavijesti

Objaviti novi web-build; nova SQL migracija nije potrebna. Šest bočnih brojača koristi RLS-zaštićene `HEAD` upite s `count: 'exact'`, bez prijenosa redaka, relacija ili paginacije punih lista. Brojač obavijesti računa se iz iste spremljene liste koju prikazuju Obavijesti i Dashboard. Dashboard ponovno koristi i gradilišta, fakture i rokove iz tog zajedničkog izvora; financijski obračun i njegove filtre ne mijenja.

Promjena stranice ne osvježava globalne brojače niti devet izvora obavijesti. Jedna memorijska instanca vezana je uz korisnika, tvrtku i ovlasti; promjena pristupa ili odjava ne prenosi stare rezultate u novi opseg. Paralelni zahtjevi i razvojni StrictMode dijele dohvat. Uspješni relevantni REST upisi i mutacijski RPC-ovi pokreću objedinjeno osvježavanje nakon 300 ms; čitanje, Storage potpisi, Auth i neuspjeli upisi ga ne pokreću. Promjena tijekom aktivnog dohvata zakazuje jedan naknadni dohvat.

Ostaje periodično osvježavanje svakih 30 minuta dok je stranica vidljiva, uz osvježavanje pri povratku na vidljivu stranicu ako je zadnja provjera starija od minute. Obavijesti imaju i ručno osvježavanje. Promjene s drugih uređaja postaju vidljive pri tim provjerama ili ručnom osvježavanju, a ne samom navigacijom. Lokalne postavke prikaza ponovno filtriraju spremljeni izvor bez mrežnog dohvata. Greške su vidljive uz mogućnost ponovnog pokušaja; zadnji uspješni rezultati ostaju sačuvani. Čitanje obavijesti i dalje ne obračunava anomalije niti piše u bazu.

Provjera: `node --test tests/overview.test.mjs tests/auth-refresh.test.mjs tests/fuel-anomalies-readonly.test.mjs tests/company.test.mjs`. Pokriveni su točni brojevi iznad limita redaka, zabrana punih lista za brojače, deduplikacija, navigacija bez novih globalnih dohvata, izolacija opsega, greške i invalidacija samo nakon uspješnih mutacija.

### Trajne poslovne greške bez PostgREST retry petlje

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110690000_poslovne_greske_bez_serialization_retry.sql`. Migracija u instaliranim PL/pgSQL funkcijama shema `public` i `private` zamjenjuje samo eksplicitne dodjele `ERRCODE = '40001'` s `P0001`. Inventar trenutačnih definicija sadrži 30 funkcija i 43 takve dodjele: zaštitu ekipe naloga, povrat iz povijesti, zaštite povezanih stavki i potvrdu dnevnih kilometara. Koristi se instalirana definicija funkcije kako se ne bi vratila starija verzija iz povijesne migracije. Uvjeti, poruke, potpisi, vlasnici, ovlasti, sigurnosne postavke i triggeri ostaju sačuvani. Stare migracije ostaju nepromijenjene.

`40001` je rezerviran za stvarnu prolaznu serialization grešku; PostgREST 14 može beskonačno ponavljati transakciju ako ga poslovno pravilo ručno vraća. Stvarne PostgreSQL serialization greške i njihovi exception handleri nisu promijenjeni. Novi web-build nije potreban. Već aktivna retry petlja može preživjeti primjenu migracije: administrator mora svježe potvrditi PID, početak sesije, korisnika i problematični upit prije prekidanja isključivo tog zahtjeva; ne prekidati procese samo prema starom PID-u.

Provjera: `node --test tests/business-error-codes.test.mjs tests/work-order-team-guard.test.mjs tests/work-order-team-history.test.mjs tests/work-order-republish.test.mjs tests/work-order-team-api.test.mjs`. Testovi izvršavaju migraciju u PostgreSQL-u, uspoređuju sva inventarizirana tijela i metapodatke prije/poslije te provjeravaju dopuštene promjene ekipe i trajni `P0001` pri zabranjenim promjenama bez djelomičnog spremanja. Lokalni SQL test nije zamjena za produkcijsku provjeru PostgREST odgovora i novih logova nakon primjene.

### Pasivno čitanje obavijesti i obračun anomalija goriva pri promjeni

Primijeniti `supabase/migrations/20261110680000_gorivo_anomalije_samo_pri_promjeni.sql` i objaviti novi web-build. Svih devet izvora obavijesti koristi isključivo SELECT: gradilišta, djelatnici, vozila, rokovi, fakture, dokumenti djelatnika/vozila, prijave vozila i spremljene otvorene anomalije. Otvaranje dashboarda, obavijesti, bočnih brojača ili modula Vozila ne obračunava niti upisuje anomalije. Stari RPC `refresh_vozila_gorivo_anomalije` ostaje kompatibilan, ali sada je STABLE/read-only, tako da ni stariji otvoreni klijent ne pokreće obračun tijekom čitanja.

Triggeri u istoj transakciji preračunavaju anomalije nakon unosa, relevantne izmjene, brisanja i vraćanja točenja te promjene praga odstupanja. To pokriva uredski unos, portal i postojeći povrat iz povijesti bez dodatnih klijentskih obračuna. Interni obračun koristi tvrtku promijenjenog retka, materijalizira rezultat jednom, uklanja zastarjele anomalije i ažurira samo stvarno promijenjene rezultate. Oznake „riješeno” postojećih anomalija ostaju sačuvane. Neuspješan obračun vraća cijelu promjenu podataka, umjesto spremanja netočnog stanja.

U **Vozila → odabrano vozilo → Gorivo** korisnik s pravom uređivanja vozila ima gumb **Ponovno izračunaj anomalije**, koji namjerno preračunava sva vozila njegove tvrtke i obavještava prikaze da ponovno pročitaju rezultate. Migracija ne pokreće početni obračun: postojeći spremljeni rezultati ostaju, a za usklađivanje cijele ranije evidencije nakon nadogradnje jednom ručno pokrenuti taj gumb. Izračun, pragovi i tekstovi obavijesti ostaju isti; postojeća prava čitanja i označavanja riješenim nisu proširena.

Provjera: `node --test tests/fuel-anomalies-readonly.test.mjs tests/fuel-mileage.test.mjs`. Testovi provjeravaju svih devet stvarnih API izvora bez dopuštenih upisnih/RPC metoda, otvaranje kartice i ručni gumb, PostgreSQL READ ONLY transakciju za čitanje i stari RPC, jednaku formulu kao prije, unos iz portala, izmjene/brisanje/povrat, prag, tvrtke/prava i rollback pri grešci.

### Provjera ovlasti bez globalnog ponovnog učitavanja

AuthContext i dalje provjerava profil, tvrtku i ovlasti svakih 60 sekundi dok je stranica vidljiva te pri povratku na stranicu. Nepromijenjeni podaci zadržavaju reference profila, tvrtke i prava; usporedba ne ovisi o redoslijedu ključeva objekata ili redoslijedu redaka prava. Time ostaje stabilna i referenca `canAccess`, pa sama provjera ovlasti ne pokreće ponovno učitavanje obavijesti i bočnih brojača niti njihovih lista gradilišta, naloga, vozila i troškova. Stvarne promjene prava, postavki tvrtke i uloga i dalje se primjenjuju; greška provjere i odjava i dalje uklanjaju pristup. Navigacija i postojeći namjenski timeri osvježavanja ostaju nepromijenjeni.

Objaviti novi web-build; SQL migracija nije potrebna. Provjera: `node --test tests/auth-refresh.test.mjs tests/auth-onboarding.test.mjs`. Regresijski test izvršava stvarne globalne podatkovne efekte iz aplikacije tijekom tri simulirane periodične provjere i provjerava da nema novih poziva poslovnih dohvata.

### Pomicanje datuma na Terminskom planu

Kalendar se može povlačiti mišem ili prstom: lijevo prikazuje kasnije, desno ranije datume. Pomak prati širinu dana pri odabranom broju tjedana. Povlačenje ne mijenja rokove ni podatke gradilišta; običan klik i dalje otvara gradilište, a strelice i gumb za današnji datum ostaju dostupni. Okomito pomicanje na dodir ostaje omogućeno. Nova migracija nije potrebna. Provjera: `node --test tests/timeline-site-periods.test.mjs`.

### Stabilne kategorije gradilišta na više računala

Primijeniti `supabase/migrations/20261110650000_gradiliste_board_revision.sql` i objaviti novi web-build na svim računalima. Gradilišta bez spremljene kategorije prikazuju se u trećem stupcu (zadano „ostala gradilišta”), a ne u najkraćem stupcu. Samo otvaranje pregleda više ne sprema automatsku preraspodjelu. Spremljene kategorije zadržavaju se i za gradilišta koja trenutačni odgovor nije učitao. Oba ekrana, Gradilišta i Dnevni raspored, spremaju prema učitanoj verziji rasporeda; zastarjelo spremanje se odbija. Nakon konflikta osvježiti cijelu stranicu i ponoviti namjernu izmjenu. Potrebno je ažurirati sve otvorene/starije klijente: stari kod koji bezuvjetno prepisuje raspored ne koristi ovu provjeru. Migracija ne vraća kategorije koje su ranije pogrešno spremljene; njih treba ručno provjeriti. Test: `node --test tests/site-board-categories.test.mjs`.

### Jedna izvorna stavka pri pripremi naloga

Pri odabiru radnih zadataka, dodatnih radova, materijala i alata za nalog iz Dnevnog rasporeda izvor i njegove povezane kopije nude se jednom. Prepoznaju se po vezama `izvor_zadatak_id`, `izvor_materijal_id`, `izvor_alat_id` i `izvor_id`, uključujući lance kopija. Prednost ima zapis već na nalogu koji se uređuje, zatim izvor. Isto pravilo primjenjuje se pri kopiranju odabranih zadataka, spremanju odabira materijala/alata i automatskom prijenosu otvorenih stavki. Zasebno unesene stavke istog naziva ostaju zasebne. Ranija povijest se ne briše niti se postojeći nalozi automatski čiste. Nova SQL migracija nije potrebna. Provjera: `node --test tests/work-order-items.test.mjs`.

### Zajednički popis Ostalo u Dnevnom rasporedu

Popis **Ostalo** zajednički je svim datumima i računalima unutar iste tvrtke. Čita se iz Supabase tablice `dnevni_raspored_ostalo`, uz postojeće RLS ovlasti, i osvježava svakih 15 sekundi dok je stranica vidljiva te pri povratku na prozor. Datum zapisa ostaje sačuvan, ali više ne ograničava prikaz ni odabir stavke. Dodjele stavki i djelatnika na vozila i dalje se spremaju za odabrani dan. Uklanjanje stavke iz zajedničkog popisa uklanja je za sve dane, ali ne briše ranije dodjele na vozila. Postojeći zapisi se ne brišu, ne prepisuju i ne spajaju automatski; mogu se pojaviti raniji zasebni unosi istog naziva. Neuspjelo učitavanje prikazuje upozorenje i zadržava zadnji učitani popis.

Nova migracija nije potrebna; objaviti novi web-build na svim računalima. Provjera: `node --test tests/schedule-other-assignments.test.mjs`. U istoj tvrtki dodati „Dostava”, promijeniti datum i otvoriti raspored na drugom računalu: stavka mora ostati dostupna. Dodijeliti je vozilu i provjeriti da se dodjela vidi samo za odgovarajući dan. Ako starog zapisa nema ni nakon nadogradnje, provjeriti istu tvrtku, prava i postojeće retke u bazi; ovaj popravak ne vraća ranije izbrisane zapise.

- `npm test` pokreće sve `tests/*.test.mjs` provjere: izolaciju lokalnih postavki tvrtki, autorizaciju pozivnica s testnim klijentima, paginaciju, obračun sati i kilometarskih troškova, očuvanje stavki naloga, preuzimanje datoteka i renderiranje prilagodljivih prikaza.
- `npm run typecheck` provjerava TypeScript, `npm run lint` provjerava kod, a `npm run build` izrađuje produkcijsku web-aplikaciju.
- Testovi koriste lokalne podatke i zamjene za mrežne pozive; ne pristupaju produkcijskoj bazi. Renderiranje prikaza nije zamjena za vizualnu provjeru u pregledniku ili provjeru na fizičkom mobitelu.
- Dohvati rasporeda i naloga dodatno provjeravaju pretvaranje povezanih djelatnika/vozila u popise, prazne veze i prosljeđivanje grešaka baze.
- SQL migracije i prava baze provjeravaju se zasebno na testnoj bazi. Prije produkcijske primjene osigurati sigurnosnu kopiju i provjeriti ključne tokove s testnim računima.

ESLint preskače generirane mape `build` unutar Android/iOS projekata, ali ne i izvorni kod tih projekata. Postojeće lint greške treba otkloniti, ne isključivati pravila kako bi provjera prividno prolazila.

### Preklapanje sati radnih naloga

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110600000_provjera_sati_zakljucenih_naloga.sql` i objaviti novi web-build. Ured i dalje može ispravljati sate otvorenih/predanih naloga, uključujući ranije preklopljene unose, ali zaključivanje odbija konflikt. Na zaključenom nalogu provjera vrijedi i pri naknadnom unosu/izmjeni djelatnika, osnovne smjene, dodatnih dionica ili datuma. Osnovna smjena i dodatne dionice ne smiju se preklapati ni unutar istog naloga. Susjedni intervali dopušteni su, prelazak preko ponoći ostaje podržan, a jednaki početak i kraj znače nula sati. Opcija **Nije radio (0 sati)** ostaje dostupna.

Provjera koristi isti datum kao obračun: najraniji povezani dan rasporeda, zatim rok, pa datum kreiranja naloga (UTC). Naknadna promjena/povezivanje/uklanjanje dana rasporeda također se provjerava za zaključene naloge. Otkazani nalozi i nalozi završeni bez izvršenja ne zauzimaju sate; vraćanje na izvršeni zaključeni nalog ponovno provjerava konflikt. Odbijena izmjena u prikazu osvježava spremljena vremena i prikazuje grešku; promjena statusa čeka završetak spremanja vremena.

Migracija ne mijenja stare sate, obračune ni iznose. Ranije konfliktne naloge ispraviti na stvarna vremena ili označiti nula sati ako djelatnik nije radio; po potrebi ponovno otvoriti nalog, uskladiti vremena pa zaključiti. Ciljane provjere: `node --test tests/work-order-time-entries.test.mjs`. Prije produkcijske primjene na testnoj bazi provjeriti i dva istodobna korisnika te povrat podataka iz povijesti.

### Predaja naloga iz portala bez potvrde strojeva

Primijeniti `supabase/migrations/20261110630000_portal_predaja_bez_potvrde_strojeva.sql` nakon prethodnih migracija. Jednoparametarski `mobile_submit_nalog`, koji poziva portal, više ne zahtijeva uklonjenu zasebnu potvrdu **Strojevi**. Strojevi i upis njihovih sati ostaju na nalogu. Djelatnici označeni s **0 sati** ne trebaju početak i završetak osnovne smjene za predaju; potvrda vremena ekipe ostaje obvezna. Ne dodaju se izmišljene potvrde na postojeće naloge. Ostaju provjere dodjele/prava, statusa, poslova, fotografija, materijala, alata, primjenjivih dodatnih radova, ENC-a i kilometara. Predaja i dalje šalje nalog u ured (`mobile_status = predan`), bez završnog zaključivanja ili obračuna.

Ciljano: `node --test tests/work-order-time-entries.test.mjs`. Nakon primjene u portalu predati nalog bez potvrde strojeva, ponoviti s djelatnikom označenim s 0 sati i provjeriti da izostavljena vidljiva obvezna potvrda i dalje blokira predaju. Za ovaj popravak nije potrebna promjena web-koda; dovoljan je SQL popravak nakon prethodnih migracija.

### Odustajanje od zaključenog naloga u jednom koraku

Primijeniti `supabase/migrations/20261110660000_otkazivanje_zakljucenog_naloga.sql` nakon prethodnih migracija i objaviti novi web-build. **Odustani od naloga** dostupan je i za završene naloge na popisu Radnih naloga. U dnevnom rasporedu ista radnja na završenom nalogu otkazuje ga umjesto brisanja; postojeće odustajanje od nezavršenog nacrta i dalje koristi zaštićeno brisanje. Odabir statusa **Otkazan** u uređivanju prolazi istu provjeru baze.

Promjena statusa, uklanjanje obračunatih sati/troškova rada i opreme, uklanjanje kilometarskih redova tog naloga i odvezivanje rasporeda odvijaju se u istoj transakciji. Postojeće funkcije obračuna bilježe snimke u povijest, a aktivnost naloga bilježi otkazivanje. Ako nedostaju potrebna prava na naloge, radno vrijeme ili troškove, odnosno bilo koji dio ne uspije, sve se poništava. Kilometarski iznosi drugih naloga ostaju nepromijenjeni (ne raspodjeljuju se ponovno); izvorna vremena, očitanja, dokumenti, materijal i dovršeni zadaci ostaju na otkazanom nalogu. Stanje kilometraže vozila ne spušta se. Nalog se ne mora prethodno ponovno otvoriti.

Ciljano: `node --test tests/work-order-settlement.test.mjs tests/work-order-schedule-cancel.test.mjs`. Na testnoj bazi potvrditi odustajanje iz oba prikaza, očuvanje ostalih naloga i odbijanje bez potrebnih prava.

### Promjena ekipe prije rada i ponovno slanje

Primijeniti `supabase/migrations/20261110670000_nalog_ekipa_ponovno_slanje.sql` i objaviti novi web-build. Nakon **Vrati u nacrt**, dodavanja/uklanjanja djelatnika i **Zaključi nalog**, ažurira se isti nalog, ne stvara kopija. Nacrt prikazuje točno spremljenu ekipu: djelatnici vozila ostaju ponuđeni za odabir, ali se ne dodaju automatski natrag. Ekipa i ponovno slanje spremaju se u jednoj transakciji uz postojeći RLS. Poslovođa ostaje ako je još dodijeljen; jedini djelatnik automatski postaje poslovođa. Ako ukloniš poslovođu i ostane više djelatnika, spremi nacrt i u detaljima odaberi novog poslovođu prije slanja. Uklonjeni vozač više nije vozač naloga. Nakon početka rada ili evidentiranih sati izmjena ekipe i dalje je zabranjena.

Portal pri redovitom osvježavanju popisa (do 30 sekundi u vidljivoj kartici) ili ručnom osvježavanju uklanja nedostupne naloge, prikazuje nalog novim djelatnicima i ponovno učitava otvorene detalje nakon promjene vremena slanja. Kasni odgovor starog učitavanja ne smije prepisati novu ekipu. Push obavijest šalje se postojećim mehanizmom nakon uspješne objave.

Ciljano: `node --test tests/work-order-republish.test.mjs tests/work-order-team-api.test.mjs tests/work-order-team-guard.test.mjs`. Na testnim računima provjeriti uklonjenog, zadržanog i dodanog djelatnika, ponovno slanje istog ID-a te odbijanje izmjene nakon početka rada.

### Provjera kilometara naloga i dnevnog obračuna

Primijeniti `supabase/migrations/20261110610000_provjera_kilometara_naloga.sql` nakon prethodnih migracija i objaviti novi web-build. Trošak bez ručne raspodjele računa se iz razlike završnog i početnog očitanja **svakog naloga**, ne iz najvećeg završnog i najmanjeg početnog očitanja različitih naloga. Ručna postotna raspodjela ostaje dostupna i dijeli zbroj tih vožnji. Prazna polja ostaju `NULL`; nisu nula i ne ulaze u obračun. Početno očitanje može se spremiti prije završnog, ali nepotpuni par ne stvara trošak. Negativna, necjelobrojna, beskonačna i obrnuta očitanja odbijaju se bez automatskog zaokruživanja.

Za više od **1.000 prijeđenih km**, ne ukupnog stanja brojila, ured i portal traže izričitu potvrdu ispravnosti. Granica nije zabrana: potvrđena vožnja može imati i više od 10.000 km. Ured dodatno potvrđuje ukupne kilometre istog vozila/dana ako više kraćih naloga zajedno prijeđe granicu. Potvrde su vezane uz točna očitanja i korisnika; izmjena očitanja poništava njihovu primjenjivost. Baza provjerava potvrdu velikih vožnji i dnevnog zbroja, te odbija kilometarski red veći od ukupne vrijednosti upisanih vožnji vozila/dana. Odustajanje ne zamjenjuje kilometre nulom niti briše postojeći obračun. Ako je status naloga već spremljen, a dnevni obračun zaustavljen, aplikacija prikazuje zasebnu grešku sinkronizacije.

Migracija ne prepravlja stare kilometre ni financijske redove. Za postojeći pogrešan obračun prvo provjeriti sva očitanja vozila za taj dan i ispraviti stvarni izvor. Zatim ponovno spremiti izvršenje naloga ili pokrenuti postojeću ponovnu sinkronizaciju kilometara: atomska zamjena obračuna ponovno računa sve povezane naloge toga dana. Ne brisati pojedinačni automatski kilometarski trošak izravnim SQL-om. Ako je i stanje vozila pogrešno podignuto, provjeriti ga zasebno prema valjanim očitanjima; automatsko spuštanje stanja vozila ostaje onemogućeno.

Na izričit zahtjev korisnika zasebna migracija `supabase/migrations/20261110620000_uklanjanje_pogresnog_puta_brane_stan.sql` uklanja samo trošak **22.960 € / Vivaro / 82.000 km / Brane Stan / 09.11.2026.** Mora postojati točno jedan takav red; više podudaranja zaustavlja ispravak, a bez podudaranja nema izmjene. Stvara se zapis povijesti dnevnog obračuna sa snimkom izvornog troška i naloga. Izvorna očitanja, stanje vozila, sati i svi ostali troškovi ostaju netaknuti. Izvorni nalog dobiva `km_bez_obracuna = true`, što ga isključuje iz kilometarskog obračuna i sprječava ponovno nastajanje uklonjenog troška pri sinkronizaciji ili ručnoj raspodjeli. U detaljima naloga prikazuje se razlog isključenja. Povrat pogrešnih velikih kilometara nije automatsko zaobilaženje novih provjera; prvo moraju biti provjereni i potvrđeni.

Ciljano: `node --test tests/vehicleKmCosts.test.mjs tests/work-order-km-validation.test.mjs tests/work-order-settlement.test.mjs`. Na testnoj bazi provjeriti potvrdu/odustajanje u uredu i portalu, dvije vožnje od 600 km istim vozilom u danu, izmjenu potvrđenog očitanja, ručne postotke i ponovni obračun povijesnog dana. SQL testovi ne pristupaju produkcijskim podacima.

### Prikaz povijesti i vraćanja

Zajedničke povijesti modula otvaraju se kroz gumb **Povijest** u gornjoj traci aplikacije, a ne zauzimaju prostor u prikazu gradilišta ni drugih modula. Detalji se prikazuju u zasebnom prozoru, a podaci se dohvaćaju tek nakon otvaranja odgovarajuće povijesti. Povijesti vezane uz pojedinačni zapis ostaju dostupne uz taj zapis. Ova UX promjena ne mijenja pravila povrata ni migracije baze i ne znači da su migracije primijenjene ili da je aplikacija objavljena.

### Osobni izbornik modula

Lijevi izbornik može se prebaciti na prikaz samo ikona ili ikona s nazivima. Izgled sprema se zasebno po korisničkom računu u lokalnoj pohrani ovog uređaja; redoslijed modula ostaje unaprijed zadan.

### Egress fotografija i dokumenata

Potpisani URL-ovi privatnih datoteka ponovno se koriste u memoriji preglednika aplikacije do jedne minute prije isteka te se istodobni zahtjevi za isti URL spajaju. To može omogućiti pregledniku ponovno korištenje HTTP cachea pri navigaciji između ekrana. Cache je ograničen na 500 URL-ova i ne pohranjuje potpisane URL-ove u trajnu pohranu. Usporediti Supabase Storage Egress kroz nekoliko dana prije i poslije promjene; stvarni učinak ovisi o pravilima cachea i obrascu korištenja.

Upload fotografija u portalu i uredskom prikazu naloga te upload slika/dokumenata gradilišta vraća samo novoumetnuti zapis. Za novu sliku potpisuje se samo minijatura kroz postojeći cache, a zapis se dodaje postojećoj galeriji bez ponovnog dohvata popisa i bez promjene postojećih fotografija ili njihovih URL-ova. Portal nakon napuštanja naloga ne priprema prikaz novog uploada za drugi nalog; spremljena fotografija dostupna je pri ponovnom otvaranju izvornog naloga. Greška prikaza nakon uspješnog spremanja nije razlog za ponavljanje uploada. Ručni oporavak neispravnih poveznica ostaje dostupan, kao i obnova cachea prije isteka. Nije potrebna SQL migracija.

U detaljima gradilišta fotografije naloga i dokumenti/slike gradilišta čekaju otvaranje kartice **Dokumenti**, u oba izgleda aplikacije. Automatski refresh fotografija svakih 30 sekundi radi samo dok je ta kartica aktivna i preglednik vidljiv; dokumenti imaju zaseban ručni refresh. VTR poveznice pripremaju se tek na kartici **Radovi**. U uredskom izvršenju naloga kartice **Fotografije** i **Dokumenti** početno nisu otvorene. U portalu se odjeljci **Dokumenti i slike**, **Dokumenti** i **Fotografije izvedenog rada** otvaraju na klik; osnovno učitavanje/osvježavanje naloga ne dohvaća njihove priloge. Potvrde pregleda, dodavanje i brisanje, minijature, uvećani pregled i preuzimanje ostaju dostupni nakon otvaranja. Svaki izvor priloga spaja istodobne zahtjeve u jedan; zakašnjeli odgovor drugog naloga/gradilišta ne smije zamijeniti trenutačni prikaz. Pogreška jednog izvora dokumenata ne skriva uspješno učitane dokumente drugog izvora.

Otvaranje galerije dohvaća metapodatke i potpisuje minijature, ne originale slika. Original se potpisuje kroz isti cache tek pri kliku na fotografiju, otvaranju/listanju uvećanog pregleda ili preuzimanju. **Preuzmi sve** potpisuje originale svih fotografija tek nakon tog izričitog zahtjeva. Greške otvaranja prikazuju se uz mogućnost ponovnog pokušaja; neispravna slika u pregledu ima ručnu obnovu potpisa. Starije slike bez zasebne minijature (ili s istom putanjom za sliku i minijaturu) prikazuju zamjensku sličicu, a original je i dalje dostupan na klik i za preuzimanje. Time ni ti zapisi ne učitavaju originale tijekom prikaza galerije. Ne generiraju se nove datoteke niti se mijenja sadržaj u Storageu.

### Učitavanje gradilišta i radnih naloga

Glavni dohvat i dohvat rokova prihvaćaju samo odgovor najnovijeg zahtjeva dok je prikaz otvoren. Stariji odgovori, greške i završetak učitavanja ne smiju prepisati novije stanje. Promjena filtra sama ne pokreće novi dohvat; filtriranje ostaje lokalno. Pozadinsko osvježavanje rasporeda stupaca gradilišta ostaje svakih 30 sekundi, samo u vidljivoj kartici, bez preklapanja vlastitih zahtjeva i bez prepisivanja lokalnog premještanja/sortiranja odgovorom započetim prije te izmjene. Greške dohvaćanja rokova prikazuju se umjesto da se rokovi zamijene praznim popisom.

Ručna provjera nakon objave web-builda:

1. Na testnom gradilištu promijeniti naziv, spremiti i ponovno otvoriti detalje; naziv mora ostati ažuriran bez osvježavanja stranice.
2. Na testnom nalogu promijeniti naslov/prioritet, spremiti, odabrati **Svi** ako ga trenutačni datumski filtar skriva i ponovno otvoriti nalog.
3. Mijenjati kategorije gradilišta i filtre naloga; prikaz mora pratiti zadnji odabir bez petlje učitavanja.
4. Uz usporenu mrežu u pregledniku napustiti modul tijekom učitavanja pa se vratiti; kasni odgovori ne smiju vratiti stari prikaz.
5. Ako postoje prava uređivanja, premjestiti testno gradilište u drugi stupac i pričekati dva ciklusa osvježavanja; položaj mora ostati spremljen.
6. Prekid veze provjeravati samo pri čitanju, bez spremanja ili brisanja: neuspjeh mora prikazati grešku, ne uspješan prazan rezultat. Nakon povratka veze ponovno otvoriti modul.

U razvojnom React StrictModeu početni efekti namjerno se ponavljaju; moguće je vidjeti dva početna mrežna zahtjeva. To nije beskonačna petlja, a rezultat prethodnog pokretanja zanemaruje se. Testovi životnog ciklusa zahtjeva su u `tests/request-scope.test.mjs`; oni nisu zamjena za mrežnu i vizualnu provjeru stvarnog prikaza.

### Zakašnjeli unos goriva i kilometraža vozila

Pri zaključivanju naloga provjera za ažuriranje kilometraže vozila koristi završno očitanje iz izvještaja koji se upravo sprema, uključujući prvi unos pri zaključivanju. Ako se izvještaj ne šalje, koristi se već spremljeno očitanje; izričito prazno završno očitanje ne preuzima staru vrijednost. Nova migracija nije potrebna. Regresijska provjera: `node --test tests/fuel-mileage.test.mjs`.

Primijeniti novu migraciju `supabase/migrations/20261109180000_vozila_gorivo_zakasnjeli_unos.sql` nakon prethodnih migracija goriva i objaviti novi web-build. Unos i uređivanje točenja dopuštaju nenegativnu cjelobrojnu kilometražu manju od trenutnog stanja vozila. Web i portal djelatnika prikazuju poruku za provjeru datuma i kilometraže, ali ne blokiraju spremanje. Zapis točenja zadržava uneseno očitanje; postojeći okidač baze povisuje stanje vozila samo kada je unos veći. Zaključivanje naloga uzima najveće završno očitanje povezanih završenih naloga i ažurira vozilo samo ako je ono veće od trenutnog stanja.

Na testnom vozilu sa stanjem 100.000 km spremiti zakašnjelo točenje na 99.500 km: zapis mora ostati na 99.500, a vozilo na 100.000 km. Zatim spremiti 100.200 km: vozilo mora porasti na 100.200 km. Urediti ili obrisati ranije točenje i zaključiti nalog s manjim očitanjem: stanje vozila ne smije pasti. Ponoviti unos kroz portal djelatnika. Unijeti stvarni datum točenja jer se potrošnja i anomalije i dalje računaju kronološki; negativne kilometraže ostaju zabranjene. SQL ponašanje provjeriti na testnoj bazi; Node testovi koriste zamjenu za bazu.

### Datumi i decimalni unos goriva

Potpuni datumi u prikazima i PDF ispisima koriste `DD.MM.GGGG.` (npr. `04.11.2026.`), s četveroznamenkastom godinom. Nazivi mjeseci i dana u kalendarima ostaju hrvatski, a datumi u bazi i vrijednosti polja ostaju ISO radi sortiranja, filtriranja i API-ja. Kalendarska polja imaju hrvatski jezik; njihov konačni izgled određuje preglednik odnosno sustav.

Web i portal djelatnika za litre goriva prihvaćaju i `42,5` i `42.5`, uključujući lijepljenje vrijednosti. Oba se spremaju kao broj `42.5`. Prazan unos, miješani separatori i tekst nisu valjani, a količina mora biti veća od nule. Provjera nakon objave: spremiti oba formata na testnom vozilu, potvrditi prikaz `42,5 l`, provjeriti uređivanje postojećeg točenja i prikaz datuma u popisu, filtrima te PDF/Excel izvozu. Nova SQL migracija nije potrebna.

### Kategorije dokumenata djelatnika

Primijeniti `supabase/migrations/20261109190000_radnik_dokument_kategorije.sql` i objaviti novi build. U dokumentima djelatnika odabire se kategorija koja je ujedno naziv novog dokumenta; zasebno polje naziva uklonjeno je. Korisnici s pravom `radnici/edit` mogu dodati kategoriju zajedničku svim djelatnicima svoje tvrtke. Standardni liječnički, atest i zaštita na radu zadržavaju svoje identifikatore i provjere obveznih dokumenata. Postojeći nazivi i prilozi ne mijenjaju se. Svaka prilagođena kategorija ima zasebnu provjeru isteka u obavijestima, a portal prikazuje njen naziv.

Na testnom djelatniku dodati kategoriju, npr. „Rad na visini”, te dokument s datumima i prilogom. Potvrditi da je naziv dokumenta „Rad na visini”, da se kategorija može odabrati na drugom djelatniku i nakon ponovnog otvaranja aplikacije, da ista kategorija ne može biti dodana dvaput te da korisnik druge tvrtke nema pristup. Provjeriti portal i upozorenja za dvije različite prilagođene kategorije. Korisnik bez prava uređivanja ne smije dodavati kategorije niti dokumente.

### Vraćanje pogrešnih promjena — prva faza (gorivo)

Primijeniti `supabase/migrations/20261109200000_gorivo_povijest_vracanje.sql` na testnoj bazi prije objave. Migracija uvodi privatni zajednički dnevnik, ali okidač i vraćanje zasad obuhvaćaju samo `vozila_gorivo`. Bilježe se unosi, izmjene i brisanja, uključujući unos iz portala i promjene preko baze. U **Vozila → Gorivo → Povijest promjena i vraćanje (30 dana)** korisnik s pravom `vozila/edit` vidi prethodno i novo stanje, autora, vrijeme, te može potvrditi vraćanje. Povijest se učitava po 50 zapisa uz **Starije promjene**.

Vraćanje se izvršava atomarno u bazi, provjerava tvrtku/prava i trenutno stanje, te samo zapisuje novu radnju u dnevnik — nema zaobilaženja postojećih okidača. Za nekoliko koraka istog zapisa najprije vratiti najnoviju izvornu promjenu, pa sljedeću stariju. Već vraćene promjene i same evidencije vraćanja ne vraćaju se ponovno. Ako postoji novija nevraćena promjena ili se podaci ne podudaraju, vraćanje se odbija. Nedostajući djelatnik, korisnik, vozilo ili nevaljana veza također zaustavljaju vraćanje. Povijest ne omogućuje obnovu obrisanog vozila, drugih modula, datoteka ni zapisa obrisanih prije aktivacije.

Vraćanje goriva ne smanjuje kilometražu vozila i nije povrat cijele transakcije/izračuna iz drugih modula. Po potrebi ručno ispraviti trenutno stanje vozila, a potrošnja i obavijesti osvježavaju se iz vraćenih točenja. Povijest nije zamjena za sigurnosnu kopiju.

Povijest prestaje biti dostupna 30 dana nakon radnje. Migracija zahtijeva podršku za Supabase `pg_cron` i zakazuje satno uklanjanje isteklih zapisa (posao `prune-business-change-history`). Provjeriti uspjeh posla u Supabase Cron prikazu; fizičko uklanjanje može kasniti do jednog ciklusa i dulje ako posao ne radi. Novi zapisi vraćanja imaju vlastiti rok od 30 dana.

Provjera prije produkcije:

1. Na testnom vozilu dodati točenje, promijeniti litre dvaput i pokušati vratiti stariju izmjenu: mora biti onemogućena ili odbijena.
2. Vratiti drugu pa prvu izmjenu: obje prethodne vrijednosti moraju se vratiti redom.
3. Obrisati testno točenje i vratiti ga iz povijesti; datum, litre, kilometraža i osoba moraju ostati sačuvani.
4. Vratiti početno dodavanje: točenje se uklanja, ali vozilo ne gubi kilometražu.
5. U dvije sesije mijenjati isti zapis: potvrda iz zastarjele povijesti ne smije prepisati noviji unos.
6. Provjeriti korisnika bez `vozila/edit` i korisnika druge tvrtke, rok od 30 dana i uspješno čišćenje dnevnika.

`node --test tests/fuel-history.test.mjs` provjerava API parametre, greške i UI potvrdu s lokalnim zamjenama. `tests/fuel-history-sql.test.mjs` izvršava stvarne migracije goriva i povijesti u lokalnom PostgreSQL-u (PGlite, samo razvojna ovisnost), uz minimalnu testnu Supabase shemu. Pokriva nekoliko koraka vraćanja, konflikt, brisanje, prava, izolaciju tvrtki, paginaciju i čišćenje. Samo `pg_cron` raspoređivač zamijenjen je testnom funkcijom; njegovo pokretanje provjeriti na Supabaseu. `supabase/tests/gorivo_povijest_vracanje.sql` sadrži dodatne SQL provjere za staging (postgres, uz postojeći odobreni administrator tvrtke); izvršava ih u transakciji koja se na kraju poništava. Lokalni testovi nisu zamjena za provjeru punog skupa Supabase pravila i istodobnih sesija. Sljedeće faze su dokumenti/prilozi i šifrarnici, zatim povezane radnje naloga i financije s vlastitim pravilima vraćanja.

### Povrat izmjena osnovnih podataka resursa

Nakon migracije goriva primijeniti `supabase/migrations/20261109210000_resursi_povijest_izmjena.sql` na testnoj bazi i objaviti novi build. U obrascima **Uredi radnika**, **Uredi vozilo** i **Uredi alat/stroj** dostupna je povijest podržanih izmjena iz zadnjih 30 dana. Povrat prikazuje promijenjena polja i traži potvrdu; nakon uspjeha zatvara obrazac i osvježava popis. Potvrda upozorava da se nespremljeni nacrt ne čuva. Prava se ponovno provjeravaju u bazi prema trenutačnom modulu resursa (posebno `alat` i `strojevi`), a tuđe tvrtke i računi/prava nisu dostupni tim funkcijama.

Podržani su ime, prezime i kontakti djelatnika; identifikacija, tehnički podaci, kilometraža, servisne postavke i jamstvo vozila; identifikacija, stanje, podaci nabave, servisne postavke i jamstvo opreme. Cijene obračuna, plaće, kategorija/status djelatnika, dodjele i radni sati opreme te druga neodobrena polja zasad se samo evidentiraju: promjena koja ih sadrži ne može se vratiti i prikazuje razlog. Vraćanje nije povrat cijelog poslovnog procesa. Povrat kilometraže može sniziti trenutno stanje vozila, ali ne mijenja očitanja u točenjima i nalozima.

Ovaj prikaz vraća samo izmjene postojećih zapisa, ne i njihovo stvaranje. Povrat brisanja resursa zasebno je dostupan u panelu **Obrisani resursi i povezani podaci** opisanom u nastavku; povijest dokumenata i priloga ima zaseban panel u sljedećoj fazi. Brisanje i ponovno stvaranje istog ID-a ne omogućuje zaobilaženje provjere novijih događaja. Postojeći cron posao čisti i ovu povijest nakon isteka. Ne mijenjati već primijenjene migracije.

Ručna provjera na testnim zapisima: dva puta promijeniti ime djelatnika i vratiti izmjene redom; promijeniti kilometražu testnog vozila pa vratiti; promijeniti naziv alata i stroja te provjeriti prava pojedinog modula. Promjena cijene ili kombinacije cijene i naziva mora biti blokirana, ne djelomično vraćena. Dvije sesije ne smiju prepisati novije stanje. Otvoriti uređivanje nakon povrata i potvrditi nove vrijednosti. Lokalni PostgreSQL testovi u `tests/fuel-history-sql.test.mjs` pokrivaju SQL migraciju resursa, nekoliko koraka vraćanja, granice polja/prava, rok isteka, brisanje i ponovnu uporabu ID-a.

### Vraćanje dokumenata i čuvanje priloga

Nakon prethodnih migracija povijesti primijeniti `supabase/migrations/20261109220000_dokumenti_povijest_vracanje.sql` te objaviti novi web-build. Povijest uz dokumente djelatnika, vozila i opreme sada obuhvaća **dodavanje, izmjenu i brisanje dokumenta** iz zadnjih 30 dana. Povrat dodavanja uklanja zapis, povrat brisanja vraća isti zapis i prilog, a povrat izmjene vraća stare vrijednosti i prethodni prilog. Obrazac dokumenta se resetira, popis i povezani servisni pokazatelji osvježavaju se. Baza provjerava trenutačna prava uređivanja modula i tvrtku, postojeći resurs, novije promjene, prilog u spremištu i sva postojeća pravila zapisa. Ne vraća se zaseban obračun niti stanje kilometara/radnih sati resursa.

Prilozi se više ne brišu iz `nalozi-foto` pri brisanju dokumenta niti zamjeni priloga. Privatna evidencija zadržanih putanja i dodatne restriktivne Storage politike sprječavaju klijentsko brisanje/prepisivanje tih datoteka. Arhivirani prilozi bez aktivnog dokumenta ne dopuštaju novu poveznicu/preuzimanje kroz Storage API; već izdane potpisane poveznice ostaju valjane do isteka. Postojeće politike tvrtke, modula i portala djelatnika ostaju na snazi.

**Rok od 30 dana odnosi se na dostupnost vraćanja, ne na fizičko uklanjanje datoteka.** U ovoj fazi zadržane datoteke i privatna evidencija putanja ostaju u spremištu i nakon isteka povijesti; automatsko čišćenje datoteka još nije uvedeno. Planirati kapacitet Storagea. Ne brisati redove `storage.objects` SQL-om jer to ne uklanja stvarne datoteke. Ručno administratorsko brisanje u Storageu ili servisnim ključem zaobilazi klijentsku zaštitu i može onemogućiti povrat. Ne vraćaju se ranije trajno obrisani prilozi ni dokumenti obrisanog/ponovno stvorenog resursa. Ako kategorija dokumenta više ne postoji ili bi postojeći trigger promijenio njegov raniji naziv, povrat se odbija atomarno umjesto djelomičnog/izmijenjenog rezultata.

Provjera na testnim zapisima nakon migracije i objave:

1. Dodati atest djelatnika s PDF prilogom, otvoriti PDF, obrisati dokument te ga vratiti iz povijesti. Naziv, datumi i sadržaj PDF-a moraju biti isti.
2. Na vozilu promijeniti datum/iznos servisa i zamijeniti prilog drugom datotekom. Povrat mora vratiti prijašnje vrijednosti i prijašnji PDF; zbroj servisa/pokazatelji osvježavaju se.
3. Ponoviti dodavanje, brisanje i vraćanje atesta/servisa alata i stroja. Pravo za alat ne smije omogućiti povrat dokumenta stroja.
4. Vratiti dvije izmjene istog dokumenta od najnovije prema starijoj, pa početno dodavanje. Dokument se uklanja, ali prilog ostaje sačuvan i ne može se iznova otvoriti kroz novu Storage poveznicu dok nema aktivnog zapisa.
5. U dvije sesije promijeniti isti dokument: zastarjeli povrat mora biti odbijen. Otkazivanje potvrde ne smije ništa zapisati. Spremanje/brisanje istog obrasca onemogućeno je dok traje povrat.
6. Provjeriti korisnika bez prava uređivanja, drugu tvrtku, nedostajući prilog i kategoriju. Ne smije se pojaviti djelomično obnovljen zapis.

Lokalni test `tests/fuel-history-sql.test.mjs` primjenjuje stvarne migracije dokumenata/kategorija i nove povijesti u PGliteu te provjerava povrate, pohranu putanja, restriktivne Storage politike, rok isteka i granice prava. Testna tablica Storagea modelira metapodatke i RLS, ne stvarno preuzimanje datoteka — otvaranje PDF-a treba provjeriti na testnom Supabaseu.

### Povrat cijele radnje brisanja resursa

Primijeniti `supabase/migrations/20261109230000_resursi_povrat_brisanja.sql` **nakon svih prethodnih migracija povijesti**, prvo na testnoj bazi. Objaviti novi build zajedno s migracijom: stari klijenti više ne mogu izravno brisati resurse. U **Djelatnici**, **Vozila**, **Alat** i **Strojevi** na vrhu je **Obrisani resursi i povezani podaci (30 dana)**. Nove radnje brisanja prolaze kroz `delete_resource_with_history`; nema nezaštićenog povratnog načina rada ako migracija nedostaje.

Zaštićena transakcija bilježi resurs, kaskadno obrisane redove i postojeće redove kojima brisanje isprazni veze. Povrat istog paketa vraća izvorne identitete, dokumente/priloge, dodjele rasporeda i naloga, vozača/poslovođu, radno vrijeme, odsustva, povijest cijena, veze opreme, gorivo i povezane provjere/prijave koje je konkretno brisanje zahvatilo. **To nije samostalno vraćanje bilo koje izmjene naloga, rasporeda ili financijskog dokumenta.** Ne mijenja se račun koji uopće nije zahvaćen brisanjem niti se ponovno izračunavaju drugi poslovni procesi.

Povrat je jedna transakcija. Nedostajući prilog, resurs ili kategorija, zauzet identitet/jedinstvena kombinacija, promjena zahvaćenog reda ili pravilo baze koje onemogućuje točno staro stanje odbijaju cijeli povrat, uključujući već obnovljeni glavni resurs. Privatni brojevi revizija prepoznaju i izmjenu reda pa ponovno upisivanje istih vrijednosti. Kod preklapajućih brisanja vraćati prvo noviju radnju i nedostajuće povezane resurse. Novi dnevnici aktivnosti ostaju sačuvani; povrat ne briše audit trag o brisanju.

Prava se provjeravaju pri brisanju i ponovno pri povratu za **sve zahvaćene module**, ne samo osnovni resurs. Npr. povrat djelatnika s radnim vremenom i rasporedom traži uređivanje tih modula. Ponovno povezivanje postojećeg korisničkog računa s djelatnikom traži administratora. Čuvaju se samo ID računa, tvrtka i veza djelatnika; odobrenja, administratorske uloge, prava, tokeni, sesije i lozinke nisu u tom snapshotu niti se vraćaju. Obrisani Auth račun ne stvara se ponovno.

Postojeći validatori i RLS pravila ostaju uključeni. Samo tijekom internog atomarnog povrata validatori zadržavaju sačuvani povijesni naziv dokumenta, ime osobe iz goriva te cijenu i vrijeme korištenja stroja, nakon provjere pripadnosti tvrtki/kategoriji. U običnom unosu i dalje se primjenjuju dosadašnja pravila. Završna provjera otkriva i promjenu ranije obnovljenog reda drugim triggerom (npr. sinkronizacijom kilometraže): ako se ne može sačuvati cijelo prethodno stanje, radnja se odbija.

Migracija postavlja interne okidače za praćenje revizija na postojeće poslovne tablice s tvrtkom i primarnim ključem. Kod novih tablica ili novih veza treba proširiti podršku/opis modula prije omogućavanja njihova povrata; nezaštićena FK tablica zaustavlja brisanje. Service-role/administratorsko održavanje bez korisničkog identiteta može zaobići klijentski način brisanja i **nije** automatski obnovljivo ovim paketima.

Rok povrata je 30 dana. Cron posao `prune-resource-deletions` čisti istekle pakete svakog sata u 23. minuti; provjeriti izvršavanje u Supabase Cron prikazu. Brojevi revizija i ključevi redova ostaju kao privatni metapodaci bez poslovnih snapshotova; prilozi se i dalje fizički čuvaju prema pravilima prethodne faze. Nema obnove brisanja prije ove migracije. Sigurnosne kopije i dalje su potrebne.

Provjera na **testnoj bazi**, s testnim podacima i administratorom:

1. Djelatniku dodati atest s PDF-om, odsustvo, raspored i nalog s vremenom; postaviti ga za vozača. Zabilježiti izvorne vrijednosti, obrisati ga pa vratiti iz novog panela. Provjeriti sve veze, sate, datume i PDF.
2. Na testnom vozilu dodati gorivo, servisni PDF i raspored. Obrisati i vratiti vozilo; provjeriti registraciju, kilometre, sva točenja, provjere goriva i raspored.
3. Na testnom stroju evidentirati korištenje s jednom cijenom, zatim promijeniti trenutačnu cijenu. Nakon brisanja/povrata stavka naloga mora imati izvornu povijesnu cijenu i vrijeme korištenja, ne novu cijenu.
4. Nakon brisanja djelatnika u drugoj sesiji izmijeniti povezani nalog. Povrat mora biti odbijen bez djelomične obnove. Ponovni upis stare vrijednosti ne smije zaobići zaštitu.
5. Obrisati prvo djelatnika pa povezano vozilo. Vratiti prvo vozilo, zatim djelatnika. Provjeriti zajedničke dodjele i osobu koja je točila gorivo.
6. Provjeriti drugu tvrtku, korisnika bez potrebnih prava, administratora kojem su prava oduzeta, nedostajući PDF i dvostruki klik na istu radnju povrata. Ništa se ne smije djelomično vratiti.

Lokalni PostgreSQL test u `tests/fuel-history-sql.test.mjs` provjerava cijeli povezani graf, složene primarne ključeve, stvarni validator vozača, mobilni audit, povijesne podatke, preklapajuća brisanja, nedostajući prilog, revizijske konflikte, prava, tvrtke, istek i čišćenje. To nije provjera stvarnih produkcijskih podataka ni prijenosa PDF datoteka kroz Supabase Storage.

### Vraćanje osnovnih podataka gradilišta

Nakon prethodnih migracija primijeniti `supabase/migrations/20261109233000_gradilista_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Gradilišta → Uredi gradilište → Povijest promjena i vraćanje (30 dana)** dostupne su izmjene naziva, adrese, regije, veze postojećeg objekta, voditelja, statusa, početnog/završnog datuma, opisa i OneDrive poveznice. Bilježe se i izmjene iz drugih ekrana/API-ja nakon aktivacije zaštite. Redoslijed stupaca na ploči nije dio povrata.

Koristi se zajednički privatni dnevnik, postojeći rok/cron čišćenja i provjera trenutačnog prava **Gradilišta / uređivanje** u istoj tvrtki. Vraćati od najnovije promjene prema starijoj. Novija izmjena (čak i ako poslije ponovno upiše iste vrijednosti), obrisani zapis, istek ili postojeći validator mogu odbiti povrat. Kod vraćanja veze objekta postojeća pravila provjeravaju pripadnost istoj tvrtki i FK. Novi investitori/objekti nastali prilikom spremanja nisu obrisani povratom veze.

**Ova faza ne vraća dodavanje/brisanje gradilišta, ugovorenu vrijednost, maržu, datoteke ni povezane zadatke, rokove, troškove i naloge.** Događaj koji uključuje nepodržano polje u cijelosti je blokiran, ne vraća se samo njegov naziv. Ne brišu se niti ponovno računaju povezani poslovni zapisi. Tijekom povrata spremanje i uređivanje obrasca blokirani su; nakon uspjeha nacrt i odabrani detalji čiste se, obrazac se zatvara i popis ponovno učitava.

Ručna provjera:

1. Na testnom gradilištu dvaput promijeniti naziv, status i datum početka. U uređivanju otvoriti povijest i vratiti najprije noviju, pa stariju promjenu. Provjeriti stvarne vrijednosti nakon ponovnog otvaranja (gradilište može prijeći u drugu kategoriju zbog statusa).
2. Promijeniti objekt pa vratiti vezu: izvorni objekt mora biti ponovno odabran, novi objekt/investitor ostaje u šifrarniku.
3. Promijeniti ugovorenu vrijednost u financijama gradilišta. Povijest mora prikazati blokiranu radnju s razlogom; iznos ostaje nepromijenjen.
4. U drugoj sesiji promijeniti isto gradilište dok je prva povijest otvorena. Pokušaj vraćanja zastarjele radnje mora biti odbijen, bez prepisivanja novijih podataka.
5. Korisnik bez prava uređivanja ne smije vidjeti panel ni pozvati RPC; korisnik druge tvrtke ne smije čitati ni vraćati povijest. Tijekom povrata gumb **Spremi** mora biti onemogućen.

Lokalni PostgreSQL testovi izvršavaju novu migraciju i provjeravaju višekoračni povrat, paginaciju, rok, dozvole, izolaciju tvrtki, postojeći tenant validator veze, nepodržana financijska polja i rollback kad validator preskoči vraćanje. UI/API testovi provjeravaju hrvatske vrijednosti, zaključavanje spremanja i čišćenje nacrta. Istodobne stvarne sesije i punu produkcijsku shemu dodatno provjeriti na testnom Supabaseu.

### Povrat brisanja cijelog gradilišta

Nakon prethodnih migracija povijesti primijeniti `supabase/migrations/20261109235000_gradilista_povrat_brisanja.sql`, prvo na testnoj bazi, te objaviti novi build. U **Gradilišta** dostupan je panel **Obrisana gradilišta i povezani podaci (30 dana)**. Brisanje sada koristi postojeći zaštićeni RPC, a izravni korisnički DELETE (uključujući stare klijente) odbija se. Povrat nije dostupan za brisanja prije ove migracije niti za privilegirano održavanje bez korisničkog identiteta.

Vraća se stvarni paket obrisanih redova i izmijenjenih veza: gradilište, nalozi i njihove ekipe/vozač, materijal i alat, povijesno korištenje stroja, rasporedi, radno vrijeme, zadaci i rokovi, fakture, troškovi, ugovoreni/VTR radovi, troškovničke stavke, angažmani kooperanata, veze ponuda/opreme, dokumenti, fotografije, minijature i izvorni dnevnik aktivnosti naloga. Uklanjanje ID-a gradilišta iz spremljenih stupaca ploče također je dio iste transakcije; povrat vraća izvorni položaj i redoslijed. Ako netko poslije promijeni tu ploču, stari povrat je blokiran kao i kod druge zahvaćene veze. Zadržavaju se izvorni identiteti, statusi i iznosi; ne pokreće se ponovni klijentski obračun ili ponovno izdavanje faktura.

Za brisanje **i** povrat trebaju trenutačna prava uređivanja svih stvarno zahvaćenih modula, npr. Fakture, Troškovi, Ponude, Raspored, Radni nalozi, Radno vrijeme, Kooperanti ili Alat/Strojevi. Samo pravo Gradilišta nije dovoljno kada paket sadrži podatke tih modula. Baza odvojeno provjerava tvrtku, revizije, postojeće veze, jedinstvene ključeve i završno točno stanje svih zapisa. Nedostajući vanjski roditelj, kružna veza bez sigurnog redoslijeda, novija promjena ili konflikt odbijaju cijelu transakciju. Ovo ne omogućuje samostalno vraćanje bilo koje izmjene fakture, naloga ili zadatka.

Obnova čeka da roditelji svakog reda postoje, uključujući izvorne/kopirane stavke iste tablice. Izvorni identity ID-evi audita vraćaju se bez promjene redovnog generatora. Validator vozača samo u privatnom kontekstu obnove prihvaća dokaz o ekipi iz istog paketa dok se nalog umeće prije ekipe; prije završetka provjerava se da je vozač zaista obnovljen u ekipi iste tvrtke. U običnom unosu validator i dalje traži postojeću dodjelu. Novi audit zapisi obnove ostaju uz izvornu povijest.

Za gradilište i njegove dokumente, dokumente/fotografije naloga te VTR priloge migracija bilježi postojeće i buduće putanje u postojećoj evidenciji zadržanih datoteka. **Brisanje zapisa više fizički ne briše te priloge i minijature.** Restriktivne Storage politike onemogućuju korisničko brisanje/prepisivanje evidentiranih datoteka; ako nema nijedne aktivne reference iste tvrtke, ne može se zatražiti nova Storage poveznica. Već izdane potpisane poveznice vrijede do isteka. Neuspjeli novi upload i dalje se čisti ako datoteka nikad nije bila povezana s poslovnim zapisom. Vanjska OneDrive poveznica nije sigurnosna kopija sadržaja na vanjskom servisu.

Nedostajući lokalni prilog blokira već samo zaštićeno brisanje gradilišta. Ako administrator naknadno ukloni datoteku servisnim pristupom, povrat se odbija bez djelomične obnove. Dostupnost povrata ostaje 30 dana, uz postojeći satni cron. Evidentirane putanje, sačuvane datoteke i revizijski metapodaci nisu automatski fizički očišćeni po isteku; planirati kapacitet i sigurnosne kopije. Nove poslovne tablice/FK veze i dalje trebaju registrirane okidače i podršku modula prije omogućavanja povrata.

Provjera na **testnom Supabaseu**, nakon migracije i novog builda:

1. Napraviti testno gradilište u drugom stupcu ploče, s nalogom, ekipom i vozačem, zadatkom/rokom, rasporedom i satima rada. Dodati testnu fakturu/trošak, VTR PDF, dokument, fotografiju s minijaturom i stroj s povijesnom cijenom korištenja.
2. Zabilježiti vrijednosti i položaj na ploči, obrisati gradilište te ga vratiti iz novog panela. Provjeriti sve veze, status plaćanja i točne iznose, povijesnu cijenu stroja, originalnu fotografiju i PDF. Gradilište mora biti na izvornom mjestu; izvorni audit ostaje.
3. Nakon brisanja u drugoj sesiji izmijeniti povezanu ponudu, opremu ili raspored ploče. Povrat mora biti odbijen, bez vraćenog gradilišta ili djelomično vraćenih financijskih redova. Ponovno upisivanje starih vrijednosti ne smije zaobići provjeru revizija.
4. Korisniku ostaviti samo uređivanje Gradilišta: brisanje gradilišta s fakturom mora biti odbijeno i sve mora ostati na mjestu. Provjeriti i oduzimanje potrebnih prava nakon brisanja te drugu tvrtku.
5. Na jednokratnim testnim podacima provjeriti zauzet jedinstveni broj/ID i nedostajući PDF/minijaturu. Povrat mora biti odbijen u cijelosti. Ne uklanjati produkcijske datoteke radi ove provjere.

Lokalni PostgreSQL testovi izvršavaju novu migraciju, stvarni tenant validator i pisanje audita te provjeravaju puni graf, složene ključeve, identity audit, izvorne/kopirane stavke, položaj na ploči, iznose i sve putanje. Pokriveni su nedostajući prilog pri brisanju/povratu, potpuni rollback, jedinstveni konflikt, novija i ABA izmjena, prava, druga tvrtka, neinstrumentirana FK tablica te regresija povrata djelatnika/vozila/opreme. UI/API testovi provjeravaju zaštićeni RPC, potvrdu paketa i zadržavanje datoteka. Stvarno otvaranje PDF-a i istodobne produkcijske sesije nisu simulirani lokalnim Storage metapodacima; provjeriti ih na testnoj instanci.

### Povrat samostalno obrisanih radnih naloga

Nakon migracija povijesti i povrata gradilišta primijeniti `supabase/migrations/20261110000000_nalozi_povrat_brisanja.sql`, prvo na testnoj bazi, te objaviti novi build. U **Radni nalozi** dostupan je panel **Obrisani radni nalozi i povezani podaci (30 dana)**. Nalozi obrisani iz tog ekrana ili odustajanjem od naloga/nacrta u **Dnevnom rasporedu** koriste isti zaštićeni RPC. Povrat tih brisanja pokreće se iz Radnih naloga. Izravno korisničko brisanje naloga iz starih klijenata sada se odbija. Kaskadno brisanje naloga unutar zaštićenog brisanja gradilišta i dalje radi i pripada povratu cijelog gradilišta, ne zasebnom paketu naloga.

Vraćaju se izvorni ID, broj, status i zaključavanje naloga, vozač/poslovođa i ekipa s upisanim vremenima, obrisani sati i troškovi, rokovi, zadaci bez gradilišta, obrisane stavke, povijesna cijena/vrijeme korištenja stroja, audit, veze rasporeda i dokumenata te sačuvani prilozi/fotografije/minijature. Zadaci gradilišta koji ostaju nakon brisanja ponovno dobivaju vezu s nalogom. Dokumenti gradilišta ostaju ako brisanje naloga nije uklonilo njihove zapise; zajednički PDF i dalje je dostupan preko postojeće aktivne reference uz dosadašnja prava. Obnova ne šalje nove push obavijesti, ne zaključava nalog iznova i ne pokreće klijentski preračun povijesnih troškova. Ne mijenja se izvanjski kilometarski podatak vozila koji brisanje nije zahvatilo.

Dosadašnje ponašanje stavki ostaje: neriješena izvorna stavka vezana uz gradilište oslobađa se s naloga i ostaje na gradilištu; izvori kopiranih stavki ponovno postaju nepreneseni. Te pripremne izmjene sada su **u istoj transakciji** kao brisanje, provjera prava i evidencija paketa. Povrat vraća i izvorne veze/oznake, a ne samo obrisanu kopiju. Novija uporaba ili izmjena oslobođene stavke/izvora blokira cijeli povrat, čak i nakon ponovnog upisa iste vrijednosti. Kod brisanja cijelog gradilišta ne pokreće se oslobađanje stavki izvan njegova paketa.

Svaki zahvaćeni modul ponovno se autorizira pri brisanju i povratu. Za nalog s troškovima, radnim vremenom, rasporedom i zadacima gradilišta trebaju prava uređivanja **Radni nalozi, Troškovi, Radno vrijeme, Raspored i Gradilišta**, ovisno o stvarno zahvaćenim redovima. Nedostatak prava ili priloga odbija već samo brisanje i poništava pripremne izmjene. Pri povratu vrijede prethodne zaštite tvrtke, novijih revizija, jedinstvenih ključeva, nestalih povezanih resursa i točnog završnog stanja; ništa se ne obnavlja djelomično.

Ako povezivanje novog naloga s rasporedom ne uspije, čišćenje koristi isti zaštićeni povratni način brisanja, bez izravnog DELETE-a. Ako ni čišćenje nije dopušteno, poruka navodi broj/ID naloga koji je ostao u Radnim nalozima i obje pogreške; nema tvrdnje da je nalog uklonjen. Samo stvaranje naloga i dalje koristi postojeći slijed unosa i povezivanja — ova faza ne pretvara sve njegove izmjene/kreiranje u jedan obnovljiv poslovni proces.

Rok je 30 dana, uz postojeći satni cron. Stara nezaštićena brisanja i privilegirano održavanje bez korisničkog identiteta ne postaju naknadno obnovljivi. Datoteke i revizijski metapodaci zadržavaju se prema prethodnoj fazi, bez automatskog fizičkog čišćenja po isteku. Samostalne izmjene statusa/izvršenja naloga, promjene dodjela, samostalna brisanja rokova/stavki/priloga i uređivanje rasporeda još nisu zasebno obnovljivi ovim panelom.

Provjera na **testnoj bazi**, nakon migracije i novog builda:

1. Na testnom gradilištu napraviti nalog s ekipom i vozačem, satima, troškom, rokom, PDF-om i fotografijom. Dodati neriješenu izvornu stavku te kopiranu stavku s ranijeg naloga. Zabilježiti status, sate, iznose i oznake prijenosa.
2. Obrisati nalog iz Radnih naloga. Izvorna neriješena stavka mora ostati na gradilištu bez naloga, izvor kopije mora postati neprenesen. Vratiti cijelu radnju iz novog panela pa provjeriti sve prethodne veze, iznose, ekipu/vozača, rokove i otvaranje PDF-a/fotografije. Povrat otvara pregled svih statusa/datuma kako ga početni filtri ne bi skrivali.
3. Ponoviti s odustajanjem od naloga/nacrta iz Dnevnog rasporeda: red rasporeda ostaje, a njegova veza s nalogom mora se vratiti. Testirati i nalog **Ostalo** bez gradilišta i njegov zadatak.
4. Nakon brisanja u drugoj sesiji promijeniti ili dodijeliti oslobođenu stavku drugom nalogu. Povrat mora biti odbijen bez djelomično vraćenog naloga. Samo pravo Radni nalozi ne smije dopustiti brisanje/povrat tuđih modula.
5. Provjeriti da zaštićeno brisanje/povrat cijelog gradilišta i dalje vraća i njegove naloge s vozačem; zasebni panel naloga ne smije nuditi isto kaskadno brisanje kao novu samostalnu radnju.

Lokalni PostgreSQL testovi izvršavaju novu migraciju i stvarni trigger brisanja zadataka bez gradilišta; provjeravaju puni graf naloga, oslobađanje/prijenos stavki, povijesnu cijenu stroja, sate/troškove, audit, raspored i priloge, poništavanje pripremnih izmjena pri nedostatku prava/datoteke, nedostajuću minijaturu pri povratu, novije/ABA promjene, drugu tvrtku i regresiju kaskadnog povrata gradilišta. API/UI testovi pokrivaju oba puta brisanja, nedostajuću migraciju, čišćenje nakon neuspjelog povezivanja, potvrdu s brojem/naslovom naloga i čišćenje otvorenog nacrta/filtera. Stvarno otvaranje priloga, puna produkcijska shema i istodobne sesije zahtijevaju dodatnu staging provjeru.

### Povrat pojedinačno obrisanih zadataka i dodatnih radova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110010000_zadaci_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U **Gradilišta** i **Radni nalozi** dostupan je odvojeni panel **Obrisani zadaci i dodatni radovi (30 dana)**. Popis je zajednički tvrtki i uključuje zadatke bez gradilišta koji pripadaju samo nalogu. Potrebno je aktualno pravo uređivanja **Gradilišta**, prema postojećem mapiranju prava za zadatke i rokove; samo pravo uređivanja Radnih naloga ili Rasporeda nije dovoljno.

Pojedinačno brisanje iz detalja gradilišta, izvršenja naloga i uklanjanje odznačenih zadataka bez gradilišta pri spremanju rasporeda sada koristi zaštićeni RPC. Jedan paket obuhvaća izvorni zadatak i sve njegove kaskadno obrisane rokove. Povrat čuva ID, naziv, vrstu zadatka/dodatnog rada, oznaku i vrijeme dovršetka, rok, kooperanta, vezu gradilišta/naloga te izvorne raspone datuma, statuse i opise povezanih rokova. Ne radi se klijentska ponovna sinkronizacija ni preračunavanje naloga. Povrat zatvara otvorene obrasce, odbacuje nacrte i osvježava prikaz. Popis ima ručno osvježavanje i paginaciju.

Vrijede zajednički rok od 30 dana, izolacija tvrtke, autorizacija svih stvarno zahvaćenih modula, zaštita novijih/ABA revizija i završna provjera cijelog paketa. Nedostaje li gradilište, nalog ili kooperant nekog roka, povrat se odbija **u cijelosti**. Najprije je potrebno vratiti obrisani roditeljski paket. Izravni korisnički DELETE zadatka iz starog klijenta odbija se, dok kaskade unutar zaštićenog brisanja gradilišta/naloga ostaju dio roditeljskog paketa i nisu duplirane u ovom popisu. Ranija nezaštićena brisanja nisu naknadno obnovljiva.

Ova faza **ne pokriva** pojedinačne izmjene naziva, dovršenosti, dodjela i rokova zadataka, samostalno brisanje ili uređivanje reda roka ni automatsko uklanjanje roka pri izmjeni zadatka. Kasnije faze ispod dodaju samostalne rokove, atomarno spremanje zadatka/rokova i zajednički povrat podržanih izmjena.

Staging provjera:

1. Napraviti dodatni rad s kooperantom i rokom, dodijeliti ga nalogu, označiti dovršenim i zabilježiti podatke. Obrisati samo zadatak i vratiti ga iz novog panela. Provjeriti da se vraćaju svi podaci zadatka i njegovih rokova, bez promjene naloga ili financija.
2. Ponoviti za zadatak naloga **Ostalo** bez gradilišta, uključujući uklanjanje odabirom u Dnevnom rasporedu. Povrat se pokreće iz Gradilišta ili Radnih naloga, ne iz samog rasporeda.
3. Obrisati zadatak, zatim njegovo gradilište/nalog. Povrat zadatka mora biti odbijen dok roditeljski paket nije vraćen. Ponoviti s nedostajućim kooperantom jednog od rokova; niti jedan red ne smije ostati djelomično vraćen.
4. Korisnik bez prava uređivanja Gradilišta ne smije vidjeti popis ni brisati/vraćati zadatke; korisnik druge tvrtke ne smije vidjeti tuđe pakete. Ponoviti provjeru uz dvije istodobne sesije.

Lokalni PostgreSQL test izvršava novu migraciju nad prethodnim fazama te provjerava puni zadatak s više rokova, raspone datuma i kooperante, zadatak bez gradilišta, odbijanje izravnog DELETE-a, povrat roditeljskog paketa, potpuni rollback pri nestalom kooperantu roka, aktualna prava, istek, ABA sukob, izolaciju tvrtki i paginaciju s jednakim vremenom. API/UI testovi provjeravaju zaštićeni poziv, odvojeni popis, potvrdu povezanih rokova i osvježavanje bez povrata klijentski zadanih snimki.

### Povrat pojedinačno obrisanih rokova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110020000_rokovi_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. Panel **Pojedinačno obrisani rokovi (30 dana)** dostupan je u **Gradilištima**, **Radnim nalozima** i **Terminskom planu**. Potrebno je aktualno pravo uređivanja **Gradilišta**, prema postojećim pravima tablice rokova. Pojedinačno brisanje iz detalja gradilišta i Radnih naloga koristi zaštićeni RPC. Rokovi obrisani kaskadno zajedno sa zadatkom, nalogom ili gradilištem ostaju u njihovu paketu, bez dupliranja u novom panelu.

Vraćaju se izvorni ID, naziv, datum i raspon datuma, status, opis, vrijeme stvaranja te veze s gradilištem, nalogom, zadatkom i kooperantom. Vrijede postojeće zaštite tvrtke, aktualnih prava, roka od 30 dana, novijih revizija i nedostajućih roditelja; ne vraća se djelomično. Stara nezaštićena brisanja nisu obnovljiva. Povrat zatvara otvorene obrasce i odbacuje nacrte. Terminski plan osvježava sve izvore, uklanja filter gradilišta/statusa, ali zadržava trenutačno razdoblje i odabir kooperanata; za stariji rok potrebno je pomaknuti razdoblje ili prilagoditi filter.

Za rok vezan uz zadatak privatno se čuvaju snimka/revizija zadatka i revizija promjena svih njegovih rokova. Svaka kasnija izmjena zadatka ili unos, izmjena i brisanje nekog njegova roka blokira samostalni povrat starog roka, čak i ako su vrijednosti ponovno iste ili je novi rok kasnije obrisan. Time se ne umeće stari rok uz automatski regenerirani rok. Provjera je namjerno konzervativna: i ponovno izvršena sinkronizacija ili obnova roditeljskog paketa može promijeniti reviziju i blokirati stariji samostalni povrat. Za rok koji nije vezan uz zadatak i dalje je moguće prvo obnoviti obrisano gradilište/nalog pa zatim rok. Povrat ne mijenja podatke samog zadatka.

Sinkronizacija roka iz zadatka sada koristi jedan serverski poziv `sync_task_deadline`, s aktualnim pravom uređivanja Gradilišta i provjerom tvrtke. Poziv zaključava zadatak, čita njegovo **trenutačno** stanje i u istoj transakciji ažurira postojeće rokove, stvara rok ako ga nema ili ih uklanja kad zadatak nema datum/gradilište. Sinkronizacija i povrat zaključavaju isti zadatak; nema klijentskog međukoraka provjere pa unosa koji bi nakon povrata stvorio novi duplikat. Povijesni višestruki rokovi ne spajaju se niti se uvodi novo jedinstveno ograničenje.

Automatsko uklanjanje rokova pri izmjeni zadatka **nije** pojedinačno zaštićeno brisanje i nije ponuđeno u ovom panelu. Kasnija faza zajedničkog povrata zadatka/rokova ispod obuhvaća i to uklanjanje. U ovoj migraciji spremanje zadatka i sinkronizacija bili su dva poziva; kasnija migracija `20261110130000_zadaci_atomarna_sinkronizacija_rokova.sql` ispod zamjenjuje to atomarnim triggerom. Interni marker sinkronizacije je privatan, transakcijski i nije dostupan klijentu. Stari klijenti koji izravno brišu rokove, uključujući staru klijentsku sinkronizaciju uklanjanjem, nakon migracije dobivaju grešku i trebaju novi build. Privilegirano održavanje bez korisničkog identiteta ne postaje obnovljivo.

Privatne ovisnosti roka brišu se s isteklim paketom postojećim cron poslom. Mali revizijski metapodaci zadataka/rokova ostaju radi zaštite od ABA promjena; nema dodatnog cron posla ni promjene zadržavanja datoteka.

Staging provjera:

1. Napraviti ručni rok s rasponom datuma i kooperantom, vezati ga uz nalog, obrisati pa vratiti iz novog panela. Provjeriti izvorni raspon, status, opis i sve veze, kao i osvježavanje Terminskog plana.
2. Obrisati samo rok zadatka i odmah ga vratiti: mora se vratiti izvorni raspon, bez ponovne projekcije iz zadatka. Zatim ponoviti brisanje, promijeniti zadatak kako bi nastao novi rok i pokušati povrat starog: povrat mora biti odbijen, bez duplikata.
3. Ponoviti uz dvije sesije: sinkronizacija prije povrata mora blokirati stari rok; sinkronizacija nakon uspješnog povrata mora ažurirati postojeći rok, ne umetnuti drugi. Provjeriti i ponovno upisivanje istog naziva zadatka nakon njegove izmjene te brisanje novog roka.
4. Provjeriti povrat cijelog zadatka/gradilišta/naloga s rokovima te korisnike bez prava i drugu tvrtku. Za samostalni ručni rok provjeriti da nestali nalog blokira povrat dok nalog nije obnovljen.

Lokalni PostgreSQL testovi izvršavaju novu migraciju te provjeravaju točan povrat ručnog i task-povezanog roka, regeneraciju bez duplikata, ABA zadatka i zamjenskog roka, atomarnost same sinkronizacije pri grešci triggera, uklanjanje internog markera, roditeljske kaskade, prava, istek, izolaciju tvrtki i paginaciju. API/UI testovi pokrivaju zaštićeno brisanje, zasebni popis, serversku sinkronizaciju samo prema ID-u, propagaciju grešaka i odbacivanje nacrta. Istodobne sesije i puna Supabase shema zahtijevaju staging provjeru.

### Povrat izmjena ručnih rokova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110030000_rokovi_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. **Povijest promjena i vraćanje (30 dana)** dostupna je u obrascu **Uredi rok** u detaljima gradilišta, u **Uredi termin** u Terminskom planu te uz pojedini rok u Radnim nalozima. Za povijest i povrat potrebno je aktualno pravo uređivanja **Gradilišta**. Zasebni paneli povrata obrisanih rokova ostaju nepromijenjeni.

Privatni dnevnik od aktivacije migracije evidentira dodavanja, izmjene i brisanja svih rokova. Ovaj panel nudi samo povrat **izmjena ručnih rokova**: naziv, datum, početak/završetak, status, opis, kooperant i veze s gradilištem/nalogom. Identitet, tvrtka, vrijeme stvaranja, veza zadatka i sva druga nepodržana polja blokiraju cijelu radnju ako su izmijenjeni; ne vraća se samo podržani dio promjene. Rok mora postojati. Za obrisani rok prvo vratiti cijelu radnju brisanja iz pripadajućeg panela, zatim njegove ranije izmjene.

Povrat se izvodi od najnovije promjene prema starijoj. Aktualno stanje i noviji događaji provjeravaju se pod zaključavanjem reda; naknadna izmjena, čak i povratak na iste vrijednosti običnim uređivanjem, ne smije biti prepisana. Povrat stvara novi audit događaj i označava izvornu radnju; ponovni povrat iste radnje i vraćanje audit-događaja samog povrata nisu dopušteni. Ako nedostaje izvorno gradilište, nalog ili kooperant, ili pravilo baze onemogući točan povrat, cijela radnja se poništava. Nema financijskog preračuna, promjene zadataka ni novog slanja obavijesti. Rok od 30 dana i postojeći cron dnevnika ostaju isti.

Rok koji je prije ili poslije promjene povezan sa zadatkom **nije obnovljiv ovim panelom**, čak ni nakon kasnijeg odvajanja zadatka. Prikazuje se objašnjenje umjesto omogućavanja djelomične obnove. Automatska sinkronizacija roka iz zadatka također se evidentira, ali nije zaseban undo. Zajednički višekoračni povrat podržanih izmjena zadatka i njegovih rokova dodaje kasnija faza ispod. Kreiranje novih rokova nije poništavanje unosa ovim panelom; novoobrisani rok vraća se zasebnim panelom za brisanja.

Spremanje i povrat u oba uređivačka obrasca međusobno su blokirani; dok traje radnja ne može se zatvoriti obrazac. Uspješan povrat zatvara obrazac, čisti odabrani rok/nacrt i učitava podatke iz baze. U Radnim nalozima povrat uz red roka čisti nacrt novog roka i osvježava popis; tijekom pisanja/povrata blokirane su kontrole rokova. Ostali obrasci naloga nisu izmijenjeni. Terminski plan zadržava postojeće filtre/razdoblje pa ih po potrebi treba promijeniti ako je vraćen rok izvan prikaza.

Staging provjera:

1. Na ručnom roku promijeniti naziv, raspon datuma, opis, kooperanta i status kroz detalje gradilišta ili Terminski plan. Napraviti još jednu izmjenu, zatim vratiti obje obrnutim redom; provjeriti sve izvorne vrijednosti i da se nespremljeni nacrt ne može naknadno spremiti preko povrata.
2. Na roku naloga promijeniti kvačicu dovršenosti, vratiti je poviješću uz rok i provjeriti status u sva tri prikaza. Ponoviti brisanje/povrat roka pa povrat njegove ranije izmjene.
3. Na roku povezanom sa zadatkom napraviti izmjenu ili pokrenuti sinkronizaciju zadatka. Povijest mora objasniti da treba zajednički povrat zadatka/rokova i ne dopustiti samostalni undo.
4. U drugoj sesiji izmijeniti isti rok prije povrata te provjeriti odbijanje starog stanja. Provjeriti istek, korisnika bez prava uređivanja i drugu tvrtku. Nestali izvorni kooperant mora blokirati cijelu radnju, bez djelomično vraćenih datuma ili statusa.

Lokalni PostgreSQL testovi izvršavaju novu migraciju i provjeravaju višekoračni povrat svih podržanih polja, novije promjene, istek, odbijanje nepodržanih polja i task-povezanih rokova, nestale roditelje, trigger koji preskoči UPDATE, točnu završnu sliku i nastavak povrata izmjena nakon obnove brisanja. API/UI testovi pokrivaju neokrnjene sekvencijske pokazivače, UUID-only povrat, hrvatske prikaze vrijednosti, prava i blokiranje/reset uređivača. Stvarne paralelne sesije i puna Supabase shema ostaju za staging provjeru.

### Povrat pojedinačno obrisanog radnog vremena

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110040000_radno_vrijeme_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U kartici **Radno vrijeme → Evidencija** dostupan je panel **Pojedinačno obrisano radno vrijeme (30 dana)**. Za brisanje, čitanje povijesti i povrat potrebno je aktualno pravo uređivanja **Radnog vremena**, uz prava svih eventualno povezanih zahvaćenih modula. Podaci drugih tvrtki nisu dostupni. Ranija nezaštićena brisanja nisu obnovljiva.

Pojedinačno brisanje iz evidencije poziva `delete_work_time_with_history`; povrat koristi postojeći atomarni mehanizam paketa. Vraćaju se izvorni identitet zapisa, djelatnik, gradilište/nalog, datum, ukupni/noćni sati, napomena i ostala izvorna polja, bez preračunavanja povijesnog zapisa. Nedostaje li roditeljski zapis, postoji sukob ili trigger onemogući točnu obnovu, ne vraća se ništa. Povijest ima stranice od 50 zapisa i postojeće 30-dnevno čišćenje paketa. Uspješan povrat zatvara obrazac, odbacuje nacrt i odabir brisanja, uklanja filtar datuma te ponovno učitava evidenciju. Spremanje/brisanje i povrat međusobno su blokirani u ovom prikazu.

**Sati vezani uz nalog imaju dodatnu zaštitu od dvostrukog obračuna.** Privatna monotona revizija prati svako dodavanje, izmjenu i brisanje naloga, njegove ekipe i njegovih sati. Pri brisanju se sačuva revizija; povrat zaključava nalog i odbija radnju ako je revizija drukčija, čak i nakon povratka na iste vrijednosti ili brisanja ponovno generiranih sati. Zaštita je namjerno konzervativna: i nepovezana izmjena naloga ili nova radnja s drugim satima istog naloga blokira stari samostalni povrat. Već vraćena radnja ne može se ponovno vratiti. Povrat cijelog naloga, gradilišta ili djelatnika ostaje zasebna potpuna radnja, bez ovog ograničenja samostalnih sati.

`syncNalogTroskovi` za čišćenje i završnu zamjenu sati sada koristi `replace_work_order_hours`: brisanje i upis jedne grupe sati jedna su transakcija, pod istom bravom naloga kao povrat. I prazan obračun povećava reviziju. Ako povrat prethodi zamjeni, zamjena uklanja i obnovljeni zapis prije novog upisa; ako zamjena prethodi povratu, revizija blokira stari povrat. Zato stari i novi sati ne ostaju zajedno. RPC provjerava tvrtku naloga/djelatnika/gradilišta, oblik podataka, dvostrukog djelatnika i točan završni skup sati. Nedostaje li migracija, obračun eksplicitno prijavljuje grešku bez starog izravnog DELETE/INSERT fallbacka.

**Cijeli obračun troškova i dalje je postojeći višepozivni postupak**: računa podatke na klijentu i poziva druge operacije odvojeno; nova transakcija obuhvaća samo zamjenu sati, ne financije i kilometre. Automatski obračun nije zaseban undo-paket. Izravni DELETE sati vezanih uz nalog ostaje dopušten postojećim RLS pravima radi kompatibilnosti sa starijim klijentima, ali stari klijenti nemaju jamstvo atomarne zamjene i treba ih ažurirati zajedno s migracijom. Izravno korisničko brisanje ručnih sati bez paketa odbija se. Ova faza ne daje povrat pojedinačnih **izmjena/dodavanja** sati, mjesečnog obračuna, odsustava, satnica ili povezanih troškova; ne mijenja pravila portala djelatnika.

Staging provjera:

1. Obrisati ručno unesene sate s napomenom/noćnim satima, vratiti ih iz panela i provjeriti sva izvorna polja. Ponoviti za sate završenog naloga bez njegove daljnje izmjene.
2. Obrisati sate naloga, zatim promijeniti vremena ekipe ili ponovno pokrenuti obračun. Stari povrat mora biti odbijen, bez dvostrukih sati, čak i ako se novoobračunati sati poslije obrišu. Provjeriti da automatski obračun i dalje radi.
3. Obrisati i vratiti cijeli nalog, gradilište i djelatnika; povezani sati moraju se vratiti kao i prije. Nedostali roditelj, istek i nedovoljna prava moraju odbiti cijeli samostalni povrat.
4. U drugoj sesiji istodobno mijenjati ekipu/obračun ili pokušati povrat. Provjeriti zaključavanje/odbijanje konflikta; lokalni PGlite testovi ne zamjenjuju stvarnu provjeru paralelnih Supabase sesija.

Lokalni PostgreSQL testovi izvršavaju migraciju te provjeravaju točan povrat, zabranu ponavljanja, ABA/regeneraciju naloga/ekipe/sati, povrat roditeljskih paketa, nedostalog roditelja, prava, izolaciju tvrtki, istek i paginaciju. API/UI testovi pokrivaju zaštićene RPC pozive, poruke nedostajuće migracije, prikaz djelatnika/datuma/sati, blokiranje konkurentnog pisanja i odbacivanje starih obrazaca.

### Povrat izmjena ručno unesenih sati

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110050000_radno_vrijeme_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Radno vrijeme → Evidencija → Uredi radno vrijeme** dostupan je panel **Povijest promjena i vraćanje (30 dana)**. Potrebno je aktualno pravo uređivanja **Radnog vremena**, uz izolaciju tvrtki. Zaseban panel obrisanih sati ostaje dostupan.

Privatni dnevnik od aktivacije migracije prati dodavanja, izmjene i brisanja evidencije sati. Novi panel nudi samo povrat **izmjena ručnih zapisa bez naloga**: djelatnik, gradilište (i prazna veza), datum, ukupni sati, noćni sati i napomena. Svaka promjena identiteta, tvrtke, vremena stvaranja, veze naloga ili drugih nepodržanih polja blokira cijelu radnju; nema djelomične obnove. Zapisi koji su prije ili poslije promjene vezani uz nalog, kao i oni trenutačno vezani uz nalog, imaju objašnjenje zašto samostalni povrat nije siguran. Kasnije odvajanje naloga ne omogućuje povrat njegovih starih promjena.

Vraćanje ide od najnovije izmjene prema starijoj. Red i događaj zaključavaju se; puni aktualni sadržaj i noviji aktivni događaji provjeravaju se prije upisa. Obično uređivanje kojim se vrijednosti vrate na iste podatke ne briše povijest i ne zaobilazi provjeru novijih promjena. Povrat stvara povezan audit događaj i označava izvornu radnju; sam povrat i već vraćena radnja ne mogu se ponovno vraćati. Izvorni djelatnik/gradilište moraju postojati u istoj tvrtki. Nepostojeći roditelj, konflikt ili pravilo baze koje promijeni/preskoči upis poništava cijeli povrat.

Za obrisani zapis najprije vratiti brisanje; nakon toga mogu se vraćati njegove ranije izmjene. Otvoreni obrazac se nakon uspjeha zatvara, nacrt i odabir brisanja se odbacuju, filtar datuma uklanja i evidencija ponovno učitava. Spremanje/brisanje i oba oblika povrata međusobno su blokirani u ovom prikazu. Prikaz navodi točne stare/nove vrijednosti sati i datum u hrvatskom formatu. Obnova evidencije mijenja preglede koji računaju iz tih sati, ali ne mijenja satnice, odsustva ni zasebne zapise troškova.

Ova faza **nije** povrat unosa novih sati, promjena ekipe/vremena naloga, ponovnog obračuna naloga, mjesečnog obračuna, satnica ili odsustava. Automatski sati i dalje koriste atomarnu zamjenu iz prethodne faze; njihove izmjene se evidentiraju, ali ne nude kao samostalni undo.

Staging provjera:

1. Na ručnom zapisu promijeniti svih šest podržanih polja, napraviti drugu izmjenu pa vratiti obje obrnutim redom. Provjeriti izvorne vrijednosti i zabranu spremanja starog nacrta preko povrata.
2. Obrisati izmijenjene sate, vratiti brisanje pa raniju izmjenu. Provjeriti istek, drugu tvrtku, korisnika bez prava uređivanja i nestalog izvornog djelatnika/gradilište: nema djelomičnog povrata.
3. Izmijeniti sate povezane s nalogom ili ponovno pokrenuti obračun; povijest mora objasniti da samostalni povrat nije obuhvaćen. Provjeriti da automatski obračun te povrat cijelog naloga/gradilišta/djelatnika i dalje rade.
4. U drugoj sesiji izmijeniti iste sate prije ili tijekom povrata: staro stanje ne smije prepisati noviju promjenu. Lokalni PGlite testovi ne zamjenjuju provjeru stvarnih paralelnih Supabase sesija.

Lokalni PostgreSQL testovi izvršavaju migraciju, točan višekoračni povrat svih podržanih polja, ABA i novije događaje, blokiranje nepodržanih/nalog-povezanih promjena, roditelje i izolaciju tvrtki, preskočeni upis, nastavak nakon obnove brisanja, istek, prava i paginaciju. API/UI testovi pokrivaju tekstualne bigint pokazivače, UUID-only povrat, hrvatske razlike te zajedničko blokiranje/reset uređivača.

### Povrat pojedinačno obrisanih odsustava

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110060000_odsustva_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U **Radno vrijeme → Obračun sati** dodan je panel **Obrisana odsustva (30 dana)**. Pristup, brisanje i povrat zahtijevaju aktualno pravo uređivanja **Djelatnika** (isto kao postojeći unos odsustava), ne pravo uređivanja Gradilišta ili samo Radnog vremena.

Brisanje godišnjeg odmora, bolovanja i upisanog praznika koristi `delete_absence_with_history`. Postojeći mehanizam paketa čuva izvorni identitet, djelatnika, vrstu, datume, napomenu i vrijeme stvaranja te eventualne povezane promjene. Vraća se cijela radnja ili ništa; nedostali roditelj, noviji zapis istog identiteta, konflikt ili pravilo baze koje preskoči/promijeni obnovu odbijaju povrat. Ranija nezaštićena brisanja nisu obnovljiva. Ugrađeni državni praznici nisu redovi odsustava i ovaj panel ih ne mijenja.

Privatna monotona revizija prati sve unose, izmjene i brisanja odsustava po djelatniku; operacije zaključavaju istog djelatnika. **Bilo koja kasnija promjena odsustava istog djelatnika blokira stari samostalni povrat**, čak i ako su novo unesena odsustva poslije obrisana ili se vrijednosti vrate na iste podatke. To je namjerno konzervativno radi sprječavanja obnove starog zapisa nakon ponovnog unosa/ispravka: blokira i drugo razdoblje istog djelatnika, a ne samo preklapanje datuma. Drugi djelatnici ne blokiraju povrat. Kod više samostalnih brisanja istog djelatnika nije zajamčen višekoračni povrat svih starih brisanja; ova faza ne premata njegove novije radnje.

Povrat cijelog djelatnika i dalje vraća sva tada obrisana odsustva kao jedan paket, bez ove zabrane pojedinačnog povrata. Ako je nakon samostalnog brisanja djelatnik obrisan i vraćen sa svojim drugim odsustvima, njihove revizije mogu blokirati staru samostalnu obnovu; povrat roditelja ne briše kasnije promjene. Djelatnik pri samostalnom povratu mora postojati u istoj tvrtki.

Panel prikazuje djelatnika, vrstu i cijelo razdoblje odsustva, ima stranice po 50 radnji i postojeći rok/purge paketa od 30 dana. Nakon povrata zatvaraju se obrazac unosa, potvrda brisanja i detalji djelatnika; ponovno se učitavaju djelatnici, sati i odsustva. Odabrani mjesec ostaje isti; za vraćeno odsustvo izvan njega treba promijeniti mjesec. Pogreška osvježavanja prikazuje se odvojeno od uspjeha obnove. Upisi odsustava i promjene prava/vidljivosti portala blokirani su tijekom povrata, a povrat je blokiran tijekom njihova spremanja i učitavanja.

Ova faza ne dodaje uređivanje odsustava (postojeći ekran ima unos i brisanje), povrat novog unosa, satnica, odobrenja obračunskih kategorija ni zasebnih financijskih zapisa. Prikaz obračuna izračunava se ponovno iz obnovljenih odsustava i aktualnih prava/cijena; ne vraćaju se povijesni iznosi plaće.

Staging provjera:

1. Za godišnji, bolovanje i upisani praznik obrisati pa vratiti zapis; usporediti sva izvorna polja i obračun odabranog mjeseca. Provjeriti reset otvorenih obrazaca.
2. Obrisati odsustvo pa istom djelatniku upisati novo ili promijeniti/obrisati drugo. Stari povrat mora biti odbijen, čak i nakon brisanja novog unosa ili vraćanja istih vrijednosti. Unos drugom djelatniku ne smije blokirati povrat.
3. Obrisati i vratiti cijelog djelatnika s više odsustava: mora se vratiti cijeli povezani skup. Provjeriti istek, drugu tvrtku, nedostalog djelatnika i korisnika bez prava uređivanja.
4. U dvije stvarne Supabase sesije istodobno unositi odsustvo i pokušati povrat istom djelatniku; provjeriti zaključavanje/odbijanje konflikta. Lokalni PGlite testovi ne zamjenjuju tu provjeru.

Lokalni PostgreSQL testovi izvršavaju migraciju, točan povrat svih kategorija, ABA/regeneraciju/promjenu djelatnika, povrat roditeljskog paketa, rollback preskočenog upisa, prava, izolaciju tvrtki, istek, paginaciju i čišćenje privatne ovisnosti. API/UI testovi pokrivaju zaštićene pozive, poruke migracije, razdoblje i vrstu, aktualna prava, blokiranje radnji, reset obrazaca i eksplicitnu pogrešku naknadnog učitavanja.

### Povrat pojedinačno obrisanih ručnih troškova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110070000_troskovi_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U **Troškovi → Pojedinačno obrisani troškovi (30 dana)** dostupan je povrat uz aktualno pravo uređivanja **Troškova** i svih modula zahvaćenih paketom. Isti panel služi i za pojedinačne troškove obrisane iz detalja Gradilišta ili Kooperanata; potvrde brisanja navode tu lokaciju.

`delete_cost_with_history` čuva cijeli izvorni red i povezane promjene. Samostalni povrat podržan je samo za **ručne troškove bez `nalog_id` i `kooperant_racun_id`**. Vraćaju se izvorni identitet, datum, kategorija, opis, iznos, status i datum plaćanja, gradilište, kooperant te ostala pohranjena polja, uključujući količinu i jediničnu cijenu. Izvorno gradilište i kooperant, ako su zadani, moraju postojati u istoj tvrtki. Novija promjena istog identiteta, konflikt ili nepotpuna obnova odbijaju cijelu radnju. Nema automatskog prepoznavanja istovjetnog troška ponovno unesenog s drugim ID-om; prije povrata provjeriti zamjenske unose.

Pojedinačno obrisane stavke naloga i računa također se evidentiraju, ali imaju onemogućen samostalni povrat i poslužiteljski blokiranu obnovu, jer zahtijevaju zajednički povrat obračuna. Postojeće automatsko čišćenje i ponovno stvaranje troškova naloga ostaje funkcionalno, ali nije zasebna obnovljiva radnja. Brisanje cijelog računa kooperanta i njegova izvornog dokumenta još nije pokriveno ovim panelom. Povrat kompletnog gradilišta ili naloga i dalje obnavlja njihove povezane troškove unutar cijelog paketa. Izračunate plaće prikazane iz radnih sati nisu redovi troškova i ne obnavljaju se ovim panelom.

Povijest ima stranice po 50 radnji i postojeći rok/purge paketa od 30 dana. Ranija nezaštićena brisanja nisu obnovljiva. Izravno brisanje ručnog troška iz starog klijenta odbija se jasnom pogreškom bez nezaštićenog fallbacka. Nakon povrata zatvaraju se obrazac i potvrda brisanja, čiste nacrt i filtri gradilišta/kategorije/pretrage/datuma te ponovno učitavaju troškovi, sati, gradilišta i kooperanti. Spremanje, brisanje i povrat međusobno su zaključani. Neuspješno osvježavanje razlikuje se od uspjele obnove.

Lokalni SQL/API/UI testovi pokrivaju točne iznose i stanje plaćanja, nullable veze, odbijanje samostalne obnove stavki naloga/računa, kompatibilnost cijelih roditeljskih paketa, revizijski ABA, nestale i tuđe roditelje, preskočeno brisanje/promijenjeni upis, prava, tvrtku, anon, rok i paginaciju te zaključavanje i reset sučelja. Prije produkcije na stagingu provjeriti dodatne stvarne triggere, RLS i istodobne zahtjeve; lokalni testovi ne zamjenjuju tu provjeru.

### Povrat izmjena ručnih troškova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110080000_troskovi_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Troškovi → Uredi trošak** dodan je panel **Povijest promjena i vraćanje (30 dana)**. Pristup i povrat zahtijevaju aktualno pravo uređivanja **Troškova**. Bilježe se i promjene napravljene iz drugih ekrana; za njihov povrat otvoriti isti trošak u modulu Troškovi.

Privatni audit bilježi unose, izmjene i brisanja nakon aktivacije, ali ovaj panel nudi samo povrat **izmjena ručnih troškova**: gradilišta, kooperanta, kategorije, opisa, iznosa, datuma te statusa i datuma plaćanja. Identitet, vrijeme stvaranja, broj računa, količine i jedinične cijene nisu podržane izmjene; ako ista radnja mijenja i takvo polje, odbija se cijeli povrat. Ta se polja ne brišu niti prepisuju dopuštenim povratom.

Trošak koji je prije, poslije ili trenutno povezan s nalogom ili grupnim računom nije samostalno obnovljiv tom radnjom, čak ni nakon odvajanja veze. Potreban je zajednički povrat obračuna. Povezani nalozi, obračuni, dokumenti i drugi troškovi ne mijenjaju se. Povrat cijelog računa i poništavanje novog unosa nisu dio ove faze.

Vraćati od najnovije izmjene prema starijoj. Poslužitelj zaključava trenutni red i događaj, provjerava izvorne roditelje u istoj tvrtki te točno trenutno stanje i novije aktivne događaje, uključujući ABA izmjene. Povrat se evidentira i nije nova samostalno obnovljiva radnja. Za obrisani trošak prvo vratiti paket brisanja; potpuni povrat brisanja zadržava raniju liniju izmjena. Nestali ili tuđi roditelj, istek roka ili trigger koji preskoči/promijeni obnovu odbijaju cijelu radnju bez označavanja izvornog događaja kao vraćenog.

Vrijede postojeće 30-dnevno zadržavanje/purge privatnog audita i stranice po 50 događaja s tekstualnim bigint pokazivačem. Ranije neevidentirane izmjene nisu obnovljive. Povrat koristi isti reset nacrta, zatvaranje obrazaca, čišćenje filtara, osvježavanje i zaključavanje spremanja/brisanja kao panel brisanja troškova; neuspjeh osvježavanja ne predstavlja se kao neuspjeh uspješno provedene obnove.

Lokalni SQL/API/UI testovi pokrivaju točne financijske vrijednosti, višekoračni povrat, vezu izvornog i povratnog audita, povrat nakon brisanja troška/gradilišta, povezane i nepodržane izmjene, ABA, nestale i tuđe roditelje, preskočen/promijenjen UPDATE, aktualna prava, tvrtku, anon, rok i paginaciju te prikaz plaćanja i zajedničko zaključavanje/reset editora. Prije produkcije potrebna je staging provjera stvarnih RLS pravila, triggera i istodobnih zahtjeva.

### Povrat pojedinačno obrisanih faktura

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110090000_fakture_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U **Fakture → Pojedinačno obrisane fakture (30 dana)** dostupan je povrat uz aktualno pravo uređivanja **Faktura** i svih modula zahvaćenih paketom. `delete_invoice_with_history` zamjenjuje izravno brisanje; stari klijent dobiva jasnu pogrešku, bez nezaštićenog fallbacka.

Paket čuva cijeli izvorni red i povezane promjene. Vraćaju se isti identitet i broj fakture, kupac, osnovni iznos, rabat i njegov pohranjeni smjer, status, datumi izdavanja/dospijeća/naplate, opis, vrijeme stvaranja te veze s gradilištem i investitorom. Ne koristi se aktualna postavka smjera rabata tvrtke. Nullable veze ostaju prazne; zadano izvorno gradilište i investitor moraju postojati u istoj tvrtki. Roditelje se ne stvara automatski i njihovi podaci/prava ne mijenjaju se.

Obnova je cijela ili nikakva. Noviji zapis istog identiteta, revizijski ABA, konflikt ili trigger koji preskoči/promijeni obnovu odbijaju povrat bez označavanja paketa kao vraćenog. Nepoznata povezana kaskadna tablica blokira zaštićeno brisanje prije gubitka podataka. Povrat kompletnog gradilišta i dalje vraća i njegove fakture. Nema automatskog prepoznavanja zamjenske fakture s drugim ID-om; prije povrata provjeriti ponovno unesene račune. Postojeće ograničenje baze za broj fakture, ako postoji, i dalje vrijedi.

Ovo je **povrat ERP zapisa, ne storno niti fiskalni/ispravni dokument**. Ne šalje se novi račun i ne provodi se bankovna naplata. Povijest izmjena fakture, poništavanje novog unosa te računi kooperanata nisu dio ove faze. Ranija nezaštićena brisanja nisu obnovljiva.

Vrijede postojeće zadržavanje/purge paketa od 30 dana i stranice po 50 radnji. Panel prikazuje broj i kupca, izvorni osnovni iznos i rabat sa smjerom, datum izdavanja te status i zadani datum naplate. Nakon povrata zatvaraju se obrazac fakture i potvrda brisanja, resetira nacrt i inline unos investitora, čiste svi filtri te ponovno učitavaju fakture, gradilišta i investitori. Spremanje fakture, brisanje i dodavanje investitora međusobno su zaključani s povratom. Pogreška osvježavanja prikazuje se odvojeno od uspjeha obnove.

Lokalni SQL/API/UI testovi pokrivaju točne financijske vrijednosti i datume, oba smjera rabata, statuse, nullable/nestale/tuđe roditelje, preskočeno brisanje i preskočenu/promijenjenu obnovu, revizijski ABA, nepoznatu kaskadu, cijeli paket gradilišta, aktualna prava, tvrtku, anon, rok i paginaciju, pregled potvrde te zaključavanje i reset editora. Prije produkcije potrebna je staging provjera stvarnih RLS pravila, triggera i istodobnih zahtjeva.

### Povijest dodjele ekipe radnog naloga

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110290000_nalozi_ekipa_povijest_vracanje.sql`, prvo na testnoj bazi, i objaviti novi build. Panel **Povijest dodjele ekipe naloga (30 dana)** dostupan je u Radnim nalozima uz pravo uređivanja **Radnih naloga**. Bilježe se pojedinačna dodavanja i uklanjanja djelatnika; povrat jedne radnje ne mijenja osnovne podatke naloga, rasporede, poslovođu, vozača, sate ni obračune.

Povrat je dopušten samo dok je nalog otvoren i prije početka mobilnog izvršenja, bez evidentiranih sati. Djeluje po djelatniku i vraća se od najnovije promjene iste dodjele prema starijoj; novija radnja, promijenjeno trenutno stanje, istek od 30 dana, nedostupan nalog ili nedostatak aktualnog prava odbijaju povrat bez djelomične izmjene. Povrat stvara audit događaj i ne može se ponovno vratiti. Brisanje naloga kaskadno ne stvara lažne korisničke događaje. Zaštita baze odbija izmjene ekipe nakon početka ili evidentiranja sati, neovisno o klijentskom sučelju.

Lokalni PostgreSQL testovi pokrivaju povrat dodavanja/uklanjanja, povezivanje izvornog i povratnog događaja, noviju promjenu iste dodjele, aktivni nalog i ponovnu primjenu migracije. Staging dodatno mora provjeriti dvije sesije, aktualna RLS pravila, prava i postojeće triggere prije produkcije.

### Povrat izmjena faktura

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110100000_fakture_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Fakture → Uredi fakturu** dodan je panel **Povijest promjena i vraćanje (30 dana)**. Pristup i povrat zahtijevaju aktualno pravo uređivanja **Faktura**; prava na gradilište/investitora ne mijenjaju se.

Privatni audit bilježi unose, izmjene i brisanja nakon aktivacije, ali ovaj panel nudi samo povrat **izmjena**: broja, kupca, osnovnog iznosa, rabata i njegovog pohranjenog smjera, datuma izdavanja/dospijeća/naplate, statusa, opisa te veza s gradilištem i investitorom. Vraća se pohranjeni smjer rabata, ne aktualna postavka tvrtke. Identitet, tvrtka, vrijeme stvaranja i druga polja nisu podržane izmjene; miješana radnja koja mijenja i takvo polje odbija se u cijelosti. Nema poništavanja novih unosa ovim panelom.

Vraćati od najnovije izmjene prema starijoj. Poslužitelj zaključava trenutnu fakturu i događaj, provjerava puni trenutni sadržaj i novije aktivne događaje, uključujući ABA izmjene, te izvorne roditelje u istoj tvrtki. Nestali ili tuđi roditelj, konflikt postojećeg broja prema ograničenju baze, istek roka ili trigger koji preskoči/promijeni obnovu odbijaju cijelu radnju bez označavanja izvornog događaja kao vraćenog. Povrat ima vlastiti povezani audit i nije nova samostalno obnovljiva radnja. Za obrisanu fakturu prvo vratiti paket brisanja; potpuni povrat fakture ili gradilišta zadržava raniju liniju izmjena.

Ovo je **povrat ERP podataka, ne storno ni ispravak već poslanog računa**. Ne šalje se novi račun i ne provodi se bankovna naplata. Povezani dokumenti, obračuni i drugi zapisi ostaju nepromijenjeni. Ograničenja baze za broj i ostala polja ostaju aktivna; nova ograničenja ne uvode se ovom migracijom.

Vrijede postojeće 30-dnevno zadržavanje/purge privatnog audita i stranice po 50 događaja s tekstualnim bigint pokazivačem. Ranije neevidentirane izmjene nisu obnovljive. Panel koristi isto zaključavanje spremanja/brisanja/dodavanja investitora, reset nacrta i inline investitora, zatvaranje obrazaca, čišćenje svih filtara i strogo osvježavanje kao panel brisanja faktura. Neuspješno osvježavanje razlikuje se od uspjele obnove.

Lokalni SQL/API/UI testovi pokrivaju točne iznose, oba smjera rabata, statuse i datume naplate, višekoračni povrat i audit veze, povrat nakon brisanja fakture/gradilišta, nestale i tuđe roditelje, nepodržane miješane izmjene, konflikt broja, ABA i nesklad trenutnog sadržaja, preskočen/promijenjen UPDATE, aktualna prava, tvrtku, anon, rok i paginaciju, hrvatske prikaze iznosa/smjera/statusa te zajedničko zaključavanje i reset editora. Prije produkcije potrebna je staging provjera stvarnih RLS pravila, triggera i istodobnih zahtjeva.

### Povrat pojedinačno obrisanih ugovorenih i VTR radova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110110000_ugovoreni_radovi_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U **Gradilišta → Pojedinačno obrisani ugovoreni i VTR radovi (30 dana)** dostupan je povrat uz aktualno pravo uređivanja **Gradilišta** i svih modula zahvaćenih paketom. Panel obuhvaća radove obrisane iz detalja gradilišta i postojećeg zasebnog prikaza Ugovorenih radova; isti panel postoji i u tom zasebnom prikazu.

`delete_contracted_work_with_history` zamjenjuje izravno brisanje. Paket čuva cijeli izvorni red i povezane promjene: identitet, vrstu rada, naziv, opis, ugovoreni i ostvareni iznos, status, vrijeme stvaranja, gradilište, vezu s ponudom te naziv i putanju sačuvanog priloga. To nije povijest izmjena ni poništavanje novog unosa. Izvorno gradilište i ponuda, ako su zadani, moraju postojati u istoj tvrtki. Njihovi podaci i statusi ne premataju se; vrijednost rada vraća se iz snimke, ne preračunava prema sadašnjoj ponudi. Za samo ponovno povezivanje postojeće ponude ne traži se njezino uređivanje.

Postojeći mehanizam zadržavanja datoteka čuva prilog i nakon brisanja rada. Dok nema živog zapisa koji ga referencira, prilog se ne može ponovno čitati kroz Storage; već izdana poveznica vrijedi do svojeg isteka. Povrat ponovno uspostavlja referencu i pristup. Ako izvorna datoteka nedostaje, odbija se cijeli povrat, a ne vraća se prazna poveznica. Brisanje rada ne poziva Storage remove; čišćenje neuspjelog, još nespremljenog uploada ostaje odvojeno.

Obnova je cijela ili nikakva. Noviji zapis istog identiteta, revizijski ABA, nestali/tuđi roditelj, konflikt jedinstvene ponude ili trigger koji preskoči/promijeni obnovu odbijaju povrat bez označavanja paketa kao vraćenog. Nepoznata povezana kaskadna tablica blokira zaštićeno brisanje prije gubitka podataka. Povrat kompletnog gradilišta i dalje vraća i njegove radove/priloge. Nema automatskog prepoznavanja istovjetnog ručno ponovno unesenog rada s drugim ID-om; prije povrata provjeriti zamjenske unose. Postojeće ograničenje jedne veze po ponudi ostaje aktivno.

Vrijede postojeće zadržavanje/purge paketa od 30 dana i stranice po 50 radnji; ranija nezaštićena brisanja nisu obnovljiva. Izravno brisanje iz starog klijenta odbija se jasnom pogreškom bez nezaštićenog fallbacka. U Gradilištima prije povrata zatvoriti obrazac i detalje kako se povrat ne bi preklapao s njihovim zasebnim spremanjem. Tijekom povrata blokirani su odabir/uređivanje/brisanje gradilišta i druge obnove. Ponovno učitavanje gradilišta, investitora, rasporeda ploče i rokova strogo prijavljuje pogreške bez demontaže panela obnove. Zasebni prikaz Ugovorenih radova zatvara obrazac/potvrdu, čisti nacrt i filtar gradilišta te strogo osvježava radove i gradilišta. Pogreška osvježavanja razlikuje se od uspjele obnove.

Lokalni SQL/API/UI testovi pokrivaju izvorne iznose i veze, ručni rad bez roditelja/priloga, zadržavanje i vidljivost Storage datoteke, nedostali prilog i roditelje druge tvrtke, konflikt zamjenskog rada iste ponude, nepoznatu kaskadu, preskočeno brisanje i preskočenu/promijenjenu obnovu, revizijski ABA, cijeli paket gradilišta, aktualna prava, tvrtku, anon, rok i paginaciju, pregled potvrde i zaključavanje/reset prikaza. Prije produkcije potrebna je staging provjera stvarnih RLS pravila, triggera i istodobnih zahtjeva.

### Povrat izmjena ugovorenih i VTR radova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110120000_ugovoreni_radovi_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Gradilišta → Povijest izmjena ugovorenih i VTR radova (30 dana)** odabire se postojeći rad; popis se učitava tek nakon otvaranja panela. Potrebno je aktualno pravo uređivanja **Gradilišta**. Prije povrata zatvoriti obrazac i detalje gradilišta. Povijest je dostupna i u obrascu postojećeg zasebnog prikaza Ugovorenih radova.

Vraćaju se naziv, opis, ugovoreni i ostvareni iznos, status te veza gradilišta, uz pregled starih i novih vrijednosti. Promjene vrste rada, veze s ponudom, priloga, identiteta ili drugih nepodržanih polja blokiraju cijelu radnju, čak i ako istodobno mijenja iznos. Ne vraćaju se novi unosi niti promjene same ponude, njezinih stavki ili statusa; nema ponovnog obračuna prema današnjoj ponudi ni promjene ugovorene vrijednosti gradilišta.

Povrat ide od najnovije promjene prema starijima i zahtijeva točno aktualno stanje. Novije izmjene, uključujući promjenu pa vraćanje iste vrijednosti, blokiraju staru radnju. Izvorno gradilište i nepromijenjena povezana ponuda moraju postojati u istoj tvrtki; za samo provjeravanje postojeće veze ne traži se uređivanje ponude. Ako rad ima prilog, njegova izvorna datoteka mora i dalje postojati. Sukob, nedostajući roditelj/datoteka ili trigger koji preskoči/promijeni obnovu odbijaju cijeli povrat bez djelomične promjene iznosa ili označavanja radnje kao vraćene.

Za obrisani rad najprije vratiti brisanje. Nakon valjanog povrata pojedinačnog rada ili cijelog gradilišta nastavlja se njegova ranija povijest izmjena; sam povrat nije nova radnja koju je moguće ponovno poništavati. Audit i prikaz imaju postojeći rok od 30 dana, stranice po 50 radnji i tekstualne bigint pokazivače. Izmjene prije primjene migracije nemaju retroaktivne snimke.

Tijekom povrata blokirani su odabir rada, spremanje i druge obnove. Popis i aktivna povijest ostaju montirani tijekom osvježavanja kako se ne bi izgubile poruke o uspjehu ili pogrešci; neuspjelo osvježavanje jasno se razlikuje od neuspjelog povrata. Lokalni SQL/API/UI testovi pokrivaju podržana i miješana nepodržana polja, točne iznose, roditelje i priloge, novije promjene i ABA, povrat nakon brisanja, atomski rollback, prava/tvrtku/rok/paginaciju te lijeno učitavanje, otkazivanje zastarjelih zahtjeva i zaključavanje prikaza. Prije produkcije provjeriti stvarna RLS pravila, triggere i istodobne zahtjeve na staging bazi.

### Atomarno spremanje zadataka i povezanih rokova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110130000_zadaci_atomarna_sinkronizacija_rokova.sql`, **prije objave novog builda**. Novi klijent više ne šalje zaseban zahtjev sinkronizacije nakon unosa/izmjene zadatka. Bez ove migracije taj build ne bi ažurirao rokove. Migracija ne mijenja postojeće zapise retroaktivno.

Trigger u istoj transakciji s unosom ili stvarnom promjenom naziva, datuma, dovršenosti, kooperanta ili gradilišta zadatka ažurira povezane rokove. To obuhvaća detalje gradilišta, izvršenje naloga i izravno označavanje zadatka na portalu djelatnika. Zadatak s datumom i gradilištem dobiva rok ako ga nema; bez datuma ili gradilišta povezani rokovi se uklanjaju. Status prati dovršenost, sva tri datuma slijede datum zadatka, a naziv, kooperant i gradilište prate trenutačni zadatak. ID-evi postojećih rokova, njihove napomene i eventualne višestruke veze čuvaju se; ne uvodi se jedinstveno ograničenje niti čišćenje povijesnih duplikata.

Ako rok nije moguće točno umetnuti, ažurirati ili ukloniti, poništava se i unos/izmjena zadatka, zajedno s auditom i revizijama. Nema situacije da obrazac prijavi neuspjeh sinkronizacije nakon već uspjelog spremanja zadatka. Provjerava se pripadnost roditelja i povezanih rokova istoj tvrtki. Prava pisanja zadatka i dalje određuju postojeća RLS pravila; djelatniku se ne dodjeljuje uređivanje Gradilišta ni izravan pristup rokovima. Privatna funkcija projekcije nije dostupna klijentu.

`sync_task_deadline` ostaje dostupan uz dosadašnju provjeru prava/tvrtke radi kompatibilnosti i eksplicitnog usklađivanja. Ponavljanje nad već usklađenim rokovima ne radi nepotrebni UPDATE, ne dodaje audit niti povećava njihovu reviziju. Promjene samo vremena dovršetka ili veze naloga ne resetiraju povijesni raspon datuma roka.

Tijekom zaštićenog brisanja i obnove roditeljskog paketa trigger ne generira izvedene rokove: postojeći mehanizam vraća izvorne redove, ID-eve, raspone i opise. Obično naknadno uređivanje zadatka ponovno primjenjuje njegovu projekciju. Ova migracija priprema zajednički povrat izmjena zadatka/rokova, ali sama ne dodaje undo-panel; automatski uklonjeni rokovi i dalje nisu ponuđeni kao samostalno obrisani rokovi.

Lokalni PostgreSQL/API testovi pokrivaju projekciju pri unosu i izmjeni, promjenu gradilišta, uklanjanje/regeneriranje, identične zahtjeve, neuspjeli prvi unos i preskočene/promijenjene operacije triggera bez djelomičnog spremanja, roditelje, pisanje zadatka s ograničenim RLS pravima bez uređivanja Gradilišta te točan povrat paketa zadatka/gradilišta. Na stagingu provjeriti stvarne mobilne politike/dodjele i istodobne zahtjeve: promjenu zadatka nasuprot uređivanju/brisanjima rokova i obnovi paketa. Konflikt ili deadlock mora jasno odbiti cijelu transakciju, ne ostaviti djelomične podatke.

### Zajednički povrat izmjena zadataka i povezanih rokova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110140000_zadaci_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Gradilišta → Povijest izmjena zadataka i povezanih rokova (30 dana)** odabrati postojeći zadatak ili dodatni rad. Popis se učitava tek nakon otvaranja i obuhvaća i zadatke bez datuma/gradilišta. Za čitanje i povrat potrebno je aktualno pravo uređivanja **Gradilišta**; time se djelatnicima ne dodjeljuju nova ERP prava.

Vraćaju se naziv, datum, dovršenost/vrijeme dovršetka i kooperant zadatka **zajedno s izvornim povezanim rokovima**. Paket koristi postojeći atomarni mehanizam obnove: čuva izvorne ID-eve, raspone datuma, statuse, opise i veze rokova, uključujući povijesne višestruke rokove. Ako je izmjena zadatka uklonila rokove, povrat ih ponovno umeće; ako ih je stvorila, povrat ih uklanja. Prikaz i potvrda pokazuju stanje zadatka i rokova prije/poslije. Nema ponovnog generiranja prema današnjem zadatku, promjene samog naloga, ekipe ili financijskog obračuna.

Promjene vrste zadatka, veze gradilišta/naloga i drugih nepodržanih polja blokiraju cijelu radnju, čak i uz istodobnu promjenu naziva/datuma. Dodatni povezani redovi izvan zadatka i njegovih rokova također onemogućuju ovaj uži povrat. Dodavanje novog zadatka nije ponuđeno kao undo. Ranije izmjene prije migracije nemaju retroaktivne pakete.

Povrat ide od najnovije izmjene prema starijima. Uz pune snimke provjeravaju se monotone revizije zadatka i cijele grupe rokova. Zasebna izmjena, dodavanje, brisanje ili obnova roka blokira staru radnju, čak i kad podaci ponovno izgledaju jednako. Zaštita je namjerno konzervativna: nakon brisanja i obnove zadatka/gradilišta raniji povrat izmjena s promijenjenom revizijom rokova ostaje blokiran, premda se sami podaci uredno obnove. Povrat zadnje podržane izmjene ponovno omogućuje prethodnu samo ako postoji neprekinuti revizijski lanac i točno prethodno stanje. Nedostali roditelj, konflikt, nepoznata kaskadna tablica ili trigger koji preskoči/promijeni obnovu odbijaju cijelu transakciju.

Paket izmjene privatno je označen kao `task_changes`, ne prikazuje se među obrisanim zadacima/gradilištima i koristi postojeće 30-dnevno čišćenje paketa. Ni izravan poziv generičkog RPC-a obnove ne zaobilazi provjere podržanih polja i grupe rokova. Postojeće RLS politike pisanja zadataka, uključujući mobilne dodjele, ostaju nepromijenjene; povrat zahtijeva ERP pravo uređivanja.

Prije globalnog povrata zatvoriti obrazac i detalje gradilišta. Svi globalni paneli obnove dijele zaključavanje; tijekom povrata blokirani su ostali povrati i uređivanje gradilišta. Nakon uspjeha odbacuju se nacrti/odabir i strogo osvježavaju gradilišta i rokovi. Aktivna povijest ostaje montirana tijekom osvježavanja i jasno razlikuje uspješan povrat od naknadne greške osvježavanja.

Lokalni SQL/API/UI testovi pokrivaju uzastopni povrat svih podržanih polja i više izvornih rokova, uklanjanje/regeneriranje, točne ID-eve/raspone/opise, ABA i nove rokove, nepodržane veze i izravan generički RPC, nestale roditelje, nepoznate kaskade, preskočene/promijenjene triggere bez djelomične obnove, prava/tvrtku/rok/paginaciju, hrvatski pregled i lijeno učitavanje/zaključavanje. Na stagingu provjeriti punu Supabase shemu, mobilne RLS politike i paralelne sesije prije produkcije.

### Povrat osnovnih podataka radnih naloga

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110150000_nalozi_osnovni_podaci_povijest.sql`, a zatim `supabase/migrations/20261110270000_nalog_rok_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Radni nalozi → Povijest osnovnih podataka naloga (30 dana)** odabrati postojeći nalog. Popis se učitava tek nakon otvaranja i ne ovisi o filtru dana/statusa u glavnom prikazu; koristi stranice pri dohvaćanju svih naloga. Za čitanje i povrat potrebno je aktualno pravo uređivanja **Radnih naloga**, ne Gradilišta.

Ova faza vraća **naslov, opis, prioritet i rok**. Privatni audit bilježi unos/izmjene/brisanje reda naloga od aktivacije migracije, ali povrat nudi samo podržane izmjene. Promjena koja uz ta polja uključuje status, gradilište, vozača/poslovođu, zaključavanje, mobilni tijek ili druga polja blokirana je u cijelosti. Nema djelomičnog povrata samo naslova. Vraćanje roka može utjecati na raspored i vidljivost naloga u portalu djelatnika. Dodavanje novog naloga, ekipa, rasporedi, izvršenje, zadaci, dokumenti, fotografije, sati, kilometri i financije nisu obuhvaćeni ovim panelom. Povrat tih osnovnih podataka ne poziva klijentski obračun niti šalje push obavijesti.

Povrat ide od najnovije promjene prema starijima, pod zaključavanjem reda naloga i događaja. Točno aktualno stanje i noviji aktivni audit događaji blokiraju prepisivanje tuđe izmjene, uključujući promjenu pa vraćanje iste vrijednosti običnim uređivanjem. Sam audit događaj povrata ne može se ponovno poništavati. Trigger koji preskoči ili promijeni povrat odbija cijelu transakciju bez označavanja izvornog događaja kao vraćenog. Za obrisani nalog prvo vratiti cijelo brisanje; nakon valjane obnove nastavlja se ranija povijest osnovnih podataka. Prava pisanja i postojeća RLS pravila ostaju nepromijenjeni.

Ovaj uži povrat ne tvrdi da obnavlja stanje povezane ekipe ili financija. Njihove zasebne promjene nisu vraćene niti se automatski premataju; svaka novija promjena samog reda naloga blokira stari povrat. Audit koristi postojeći rok i čišćenje od 30 dana, stranice po 50 događaja i tekstualne bigint pokazivače. Podaci prije aktivacije migracije nisu retroaktivno obnovljivi.

Prije globalnog povrata zatvoriti obrazac naloga. Povrat je blokiran tijekom spremanja/brisanja naloga, pisanja/povrata rokova i slanja obavijesti. Svi globalni paneli povrata u Radnim nalozima dijele zaključavanje; tijekom povrata kontrole prikaza i obrasci su onemogućeni. Nakon uspjeha odbacuju se nacrti/odabir i filtri te strogo osvježavaju nalozi, gradilišta, djelatnici i rokovi bez demontaže aktivne povijesti. Pogreška osvježavanja prikazuje se odvojeno od već uspjelog povrata.

Lokalni PostgreSQL/API/UI testovi pokrivaju uzastopni povrat svih triju polja i null opisa, miješane nepodržane promjene, novije događaje i ABA, točno aktualno stanje, preskočene/promijenjene triggere, nastavak nakon obnove naloga, prava/tvrtku/rok/paginaciju, hrvatske prioritete, lijeno učitavanje popisa te zaključavanje i stroge greške osvježavanja. Prije produkcije potrebna je staging provjera stvarnih RLS pravila, triggera, mobilnog audita i paralelnih zahtjeva. Zajednički povrat statusa/izvršenja/ekipe i financijskog obračuna ostaje zasebna sljedeća faza, ne dio ovog užeg povrata.

### Potpuna povijest aktivnosti radnog naloga

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110300000_nalog_povijest_aktivnosti_paginacija.sql`, prvo na testnoj bazi, i objaviti novi build. Panel **Povijest aktivnosti** u izvršenju naloga prikazuje najnovije promjene, a gumb **Učitaj starije aktivnosti** dohvaća ostatak u stabilnim stranicama po 50 događaja. Novi događaji se periodički osvježavaju bez gubitka već učitanih starijih zapisa; za broj iznad trenutačno učitanih redova prikazuje se oznaka `+`.

Čitanje zahtijeva pravo pregleda Radnih naloga i provjerava pripadnost naloga aktivnoj tvrtki na poslužitelju. Povijest je audit za pregled, ne univerzalni undo: zasebni paneli vraćaju samo svoja podržana polja ili pakete. Status, mobilno izvršenje i pripadajući obračun ne smiju se vraćati odvojeno; potreban je poseban atomski povrat koji usklađuje status, sate, troškove, kilometre i prenesene zadatke. Ova migracija uklanja ranije ograničenje prikaza na posljednjih 200 događaja, ne briše audit zapise i ne mijenja pravila povrata.

Lokalni PostgreSQL/API testovi provjeravaju stranice s jednakim vremenom, pokazivač bez gubitka bigint ID-a, neispravan pokazivač, nepostojeći/tuđi nalog, prava i poruku za nedostajuću migraciju. Na stagingu provjeriti da korisnik druge tvrtke ne može čitati audit niti pozivom RPC-a.

### Povijest materijala i alata na radnim nalozima

Nakon migracije povijesti izmjena ponuda primijeniti `supabase/migrations/20261110260000_nalog_stavke_povijest_izmjena.sql`, prvo na testnoj bazi, pa objaviti novi build. U izvršenju radnog naloga dodan je panel **Povijest materijala i alata (30 dana)**. Audit bilježi izmjene stavki povezanih s nalogom, uključujući promjene napravljene s dodijeljenog mobilnog naloga; čitanje i povrat zahtijevaju aktualno pravo uređivanja **Radnih naloga**.

Samostalni povrat je ograničen na **naziv i oznaku riješeno** materijala/alata na aktivnom nalogu. Red vraća samo ako nema novijih nepovrnutih promjena i cijeli trenutačni zapis odgovara snimci. Zaključeni/otkazani nalozi, strojevi i njihovi radni sati, dodavanje/brisanje stavke, prijenos ili druga promjena veze nisu obuhvaćeni. Promjena koja uz podržana polja zahvati i nepodržano polje blokira se u cijelosti. Ovaj panel ne mijenja troškove ni obračun naloga. Povrat se izvodi najnoviji-prvi; privatnu povijest satno čisti cron `prune-work-order-item-change-history`.

Lokalni SQL/API/UI testovi pokrivaju točan povrat, višekoračni redoslijed, zastarjele i nepodržane promjene, završene naloge, prava, paginaciju i grešku nedostajuće migracije. Povrat statusa/izvršenja naloga, dodjela ekipe, kilometara, strojeva, fotografija/dokumenata i povezanih obračuna ostaje zaseban opseg. Na stagingu dodatno provjeriti Supabase triggere, mobilne RLS politike i paralelne sesije.

### Zaštita ekipe nakon početka rada

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110280000_zastita_ekipe_naloga_u_radu.sql`. Dodavanje, uklanjanje ili premještanje djelatnika na nalogu blokira se nakon početka mobilnog rada, završetka/otkaza naloga ili evidentiranja sati. Promjena vremena na postojećoj dodjeli ostaje dopuštena, a kaskadno brisanje naloga kroz zaštićeni postupak nije blokirano. Za provjeru se oslanja i na API i na bazni trigger; stariji/nepouzdani klijenti ne mogu zaobići pravilo izravnim pisanjem u tablicu.

Ovo je zaštita od gubitka veze ekipe s već započetim izvršenjem, ne povrat prethodne ekipe. Povrat dodjela zahtijeva zaseban atomski tok koji usklađuje mobilni audit, sate, troškove i stanje naloga. Provjeriti na stagingu konkurentno pokretanje rada i promjenu ekipe prije objave.

### Povrat izmjena osnovnih podataka investitora

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110160000_investitori_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Investitori → Povijest izmjena investitora (30 dana)** odabrati postojećeg investitora. Odabir je neovisan o pretraživanju i datumskim filtrima glavne tablice. Čitanje i povrat zahtijevaju aktualno pravo uređivanja **Investitora** u istoj tvrtki.

Vraćaju se naziv, OIB, adresa, mjesto, poštanski broj, osnovna kontakt osoba, telefon, e-pošta, web i napomena. **Zasebni kontakti, objekti, veze gradilišta i fakture ne vraćaju se niti preračunavaju.** Promjena investitora ne ispravlja već izdanu fakturu. Dodavanje i brisanje investitora nisu obuhvaćeni ovom fazom; obrisanog investitora ovaj panel ne može obnoviti. Izmjena koja zajedno obuhvaća identitet, vrijeme stvaranja ili druga nepodržana polja odbija se u cijelosti.

Povrat se izvodi najnoviji-prvi, uz zaključavanje investitora i audit događaja, provjeru točnog aktualnog stanja i novijih promjena. Obična izmjena pa vraćanje iste vrijednosti ne zaobilazi zaštitu. Nova radnja evidentira povrat; izvorna radnja i zapis povrata ne mogu se ponovno poništavati. Ako trigger preskoči, izmijeni ili ne evidentira povrat, cijela se transakcija poništava.

Prije povrata zatvoriti obrazac, pregled i potvrdu brisanja investitora. Povrat je onemogućen tijekom spremanja/brisanja investitora ili zasebnih kontakata, a tijekom povrata ostale kontrole prikaza su zaključane. Nakon uspjeha odbacuju se nacrti i filtri te strogo osvježavaju podaci bez zatvaranja aktivne povijesti. Pogreška osvježavanja ostaje jasno odvojena od već uspjelog povrata.

Lokalni testovi provjeravaju transakcije, ovlasti, izolaciju tvrtki, rok, paginaciju i netaknutost povezanih zapisa. Prije produkcije na testnom Supabaseu provjeriti stvarne RLS politike, triggere, rad u dvije sesije i prikaz na mobitelu.

### Povrat izmjena osnovnih podataka objekata

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110170000_objekti_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Objekti → Povijest izmjena objekta (30 dana)** odabrati postojeći objekt. Popis ne ovisi o pretraživanju glavne tablice. Za čitanje i povrat potrebno je aktualno pravo uređivanja **Objekata** u istoj tvrtki.

Vraćaju se naziv, veza s investitorom, adresa, mjesto, poštanski broj, kontakt osoba, telefon i napomena. Izvorni i aktualni investitor, ako su zadani, moraju i dalje postojati u istoj tvrtki; pri povratu se zaključavaju. Za stare objekte bez investitora čuva se izvorna prazna veza. Nedostupni investitor ili zauzet naziv kod izvornog investitora odbija cijeli povrat.

**Znanje objekta (`znanje`), povezana gradilišta, investitori i financijski zapisi ne vraćaju se niti preračunavaju.** Promjena veze objekta utječe na grupiranje u prikazu, ali ne prepisuje investitora na postojećoj fakturi ili druge povezane redove. Izmjena znanja, identiteta, vremena stvaranja ili drugih nepodržanih polja nije obnovljiva ovim panelom; miješana radnja odbija se u cijelosti. Kasnija izmjena znanja blokira stariji povrat osnovnih podataka. Dodavanje i brisanje objekta nisu obuhvaćeni.

Povrat ide od najnovije promjene prema starijima, uz provjeru točnog aktualnog stanja, novijih audit događaja, roka od 30 dana i evidentiranja samog povrata. Preskočen ili izmijenjen povrat iz triggera poništava cijelu transakciju. Za povrat zatvoriti obrazac, pregled znanja i potvrdu brisanja; spremanje/brisanje objekta ili znanja blokira povrat. Ostale kontrole prikaza zaključane su dok povrat traje. Nakon uspjeha odbacuju se nacrti i pretraga te strogo osvježavaju podaci bez zatvaranja aktivne povijesti; pogreška osvježavanja prikazuje se odvojeno od uspjelog povrata.

Lokalni SQL/API/UI testovi pokrivaju točne vrijednosti, uzastopni povrat, prazne veze, nedostupne/tuđe investitore, konflikt naziva, dozvole, paginaciju i netaknutost povezanih podataka. Prije produkcije na testnom Supabaseu provjeriti stvarne RLS politike, triggere, istodoban rad dviju sesija i mobilni prikaz.

### Povrat izmjena osnovnih podataka kooperanata

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110180000_kooperanti_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Kooperanti → Povijest izmjena kooperanta (30 dana)** odabrati postojećeg kooperanta. Odabir ne ovisi o pretrazi ni kartičnom/tabličnom prikazu. Za čitanje i povrat potrebno je aktualno pravo uređivanja **Kooperanata** u istoj tvrtki.

Vraćaju se naziv, djelatnost, OIB, IBAN, adresa, mjesto, poštanski broj, kontakt osoba, telefon, e-pošta, web, napomena i boja terminskog plana. Promjene boje iz terminskog plana evidentiraju se istim dnevnikom, a vraćaju se u Kooperantima. **Angažmani, zadaci, rokovi, dokumenti, ponude, računi i troškovi ne vraćaju se niti preračunavaju ovom radnjom.** Povrat IBAN-a ne provodi plaćanje i ne ispravlja već izdani račun. Dodavanje i brisanje kooperanta nisu obuhvaćeni.

Nova migracija ispravlja i nevaljani raspon `a-F` u ranijem ograničenju boje plana. Zadržava se namjeravano pravilo: prazna boja ili `#` i točno šest ASCII heksadekadskih znakova. Ranija migracija ne prepisuje se.

Povrat ide od najnovije promjene prema starijima, pod zaključavanjem kooperanta i audit događaja. Točno aktualno stanje i noviji aktivni događaji štite od prepisivanja, uključujući običnu izmjenu pa vraćanje iste vrijednosti. Izmjena identiteta, vremena stvaranja ili drugih nepodržanih polja blokira cijelu radnju. Povrat mora uspjeti i biti evidentiran u istoj transakciji; preskočen ili izmijenjen povrat iz triggera, neuspjela validacija ili nedostajući audit poništava cijelu transakciju.

Prije povrata zatvoriti profil, obrazac i potvrde brisanja. Spremanje/brisanje kooperanta, angažmana, troškova, dokumenata i računa, označavanje plaćanja, povezivanje ponude i analiza računa blokiraju pokretanje povrata. Tijekom povrata ostale kontrole prikaza su zaključane. Nakon uspjeha odbacuju se nacrti, profil i pretraga te strogo osvježavaju podaci bez zatvaranja aktivne povijesti. Pogreška osvježavanja ostaje odvojena od već uspjelog povrata. Ne mijenjaju se postojeća prava za financijske operacije.

Lokalni SQL/API/UI testovi pokrivaju točne vrijednosti i prazna polja, boju plana, uzastopni povrat, konflikte, rok, dozvole, izolaciju tvrtki, paginaciju i netaknutost povezanih zapisa. Prije produkcije na testnom Supabaseu provjeriti stvarne RLS politike, triggere, rad u dvije sesije i mobilni prikaz.

### Povrat izmjena angažmana kooperanata

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110190000_angazmani_povijest_izmjena.sql`, prvo na testnoj bazi, i objaviti novi build. U **Kooperanti → Povijest izmjena angažmana (30 dana)** odabrati postojeći spremljeni angažman. Odabir je neovisan o pretraživanju, otvorenom profilu i kartičnom/tabličnom prikazu; popis angažmana dohvaća sve stranice uz stabilan redoslijed. U nedostatku dostupnog naziva prikazuje se izvorni ID kooperanta/gradilišta. Za čitanje i povrat potrebno je aktualno pravo uređivanja **Kooperanata** u istoj tvrtki.

Vraćaju se dogovoreni iznos (uključujući nulu i praznu vrijednost), spremljeni status, datum početka i završetka te napomena. Upsert postojećeg para kooperant/gradilište bilježi se kao izmjena istog angažmana. **Veze s kooperantom i gradilištem ne vraćaju se**; promjena tih veza, identiteta, vremena stvaranja ili drugih nepodržanih polja blokira cijelu radnju, uključujući miješane izmjene. Kooperant i gradilište moraju i dalje postojati u istoj tvrtki; pri povratu se zaključavaju.

**Računi, troškovi, dokumenti, zadaci, rokovi i stanje gradilišta ostaju netaknuti i ne preračunavaju se.** Povrat iznosa nije knjiženje ni plaćanje. Prikaz angažmana i dalje uvažava postojeće pravilo: završeno ili završeno/neplaćeno gradilište prikazuje angažman kao završen, neovisno o vraćenom spremljenom statusu. Novi i obrisani angažmani nisu obuhvaćeni ovim panelom. Izvedeni `legacy:` angažmani iz troškova nisu stvarni spremljeni redovi i nisu ponuđeni za povrat.

Povrat ide od najnovije promjene prema starijima, uz rok od 30 dana, točno aktualno stanje i provjeru novijih audit događaja (uključujući običnu izmjenu pa vraćanje iste vrijednosti). Preskočen, izmijenjen ili neevidentiran povrat i neuspjela validacija poništavaju cijelu transakciju. Panel dijeli zaključavanje s poviješću osnovnih podataka kooperanta; zatvoriti profil, obrasce i potvrde brisanja te pričekati sva spremanja. Nakon uspjeha odbacuju se nacrti/pretraga i strogo osvježavaju podaci bez zatvaranja aktivne povijesti. Pogreška osvježavanja ostaje odvojena od uspjelog povrata.

Lokalni SQL/API/UI testovi pokrivaju uzastopni povrat, upsert, nulu/prazne vrijednosti, nepromijenjene povezane podatke, nedostupne/tuđe roditelje, konflikte, ovlasti, paginaciju i rollback. Prije produkcije na testnom Supabaseu provjeriti stvarne RLS politike, triggere, istodoban rad dviju sesija i mobilni prikaz.

### Povrat izmjena kataloških stavki (cijene i šifrarnik)

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110200000_stavke_povijest_izmjena.sql`, prvo na testnoj bazi, i tek zatim objaviti novi build. U **Stavke → Povijest izmjena stavke (30 dana)** odabrati postojeću stavku. Odabir je neovisan o pretraživanju i filtru vrste posla. Za čitanje i povrat potrebno je aktualno pravo uređivanja **Stavki** u istoj tvrtki.

Vraćaju se šifra, naziv, vrsta posla, podgrupa, jedinica, cijena i opis. Dodavanje i brisanje stavki nisu obuhvaćeni ovim panelom. Promjena identiteta, vremena stvaranja ili drugih nepodržanih polja blokira cijelu radnju. Povrat ide najnoviji-prvi uz provjeru točnog aktualnog stanja i novijih audit događaja; obična izmjena pa ručno vraćanje iste vrijednosti ne zaobilazi zaštitu.

Promjena cijene sada se evidentira atomarno u bazi: pri svakom uspješnom `INSERT`/`UPDATE` stavke okidač dodaje red u `stavke_cijene_log`, a neuspjela ili izmijenjena evidencija cijene poništava cijelu transakciju. Povrat cijene je nova valjana promjena cijene: zadržava stare logove, dodaje novi log s trenutnim vremenom i ne vraća `cijena_promijenjena_at` na povijesnu vrijednost. Ako baza ne može upisati točan novi log cijene tijekom povrata, povrat se odbija bez djelomičnog upisa.

Povrat stavke **ne preračunava** već spremljene poslovne dokumente (npr. ponude i gradilišne zapise sa spremljenom cijenom). Povezani redovi ostaju netaknuti; povrat mijenja samo šifrarnik stavki. Prije povrata zatvoriti otvorene obrasce i detalje stavke. Tijekom povrata zaključane su kontrole uređivanja, brisanja i detaljnih upisa kako ne bi nastale paralelne izmjene.

Važno za kompatibilnost: ova migracija mora biti aktivna prije builda koji više ne radi klijentski ručni upis u `stavke_cijene_log`. Stariji klijenti koji još rade ručni upis mogu privremeno stvarati duple logove cijene, pa nakon migracije treba koristiti samo novi build.

Lokalni SQL/API/UI testovi pokrivaju uzastopni povrat, točne vrijednosti cijena i polja, append-only log cijena, rollback pri kvaru triggera/loga, ovlasti, izolaciju tvrtki, rok, paginaciju i netaknutost povezanih poslovnih redova. Prije produkcije na testnom Supabaseu provjeriti stvarne RLS politike, triggere, paralelne sesije i prikaz u pregledniku/mobilnom webu.

### Povrat obrisanih računa kooperanata i njihovih troškova

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110210000_kooperant_racuni_povrat.sql`, prvo na testnoj bazi, i zatim objaviti novi build. U **Kooperanti → Povijest obrisanih računa kooperanata (30 dana)** prikazuju se zaštićena grupna brisanja. Brisanje kroz novi build uklanja zapis izvornog računa i sve njegove stavke troška **u jednoj DB transakciji**. Povrat rekonstruira točan skup stavki, izvorne iznose i oznake plaćanja, zajedno s redom priloga. Potrebna su prava uređivanja kooperanata i svih zahvaćenih troškova.

Izvorna privatna datoteka ne briše se pri grupnom brisanju: zadržava se u Storageu do isteka povrata, ali se pravila pristupa mijenjaju tako da se račun može ponovno otvoriti tek nakon povrata metapodataka. Ako datoteka nedostaje, povrat je blokiran. Zaštićeni okidači odbijaju pojedinačno brisanje stavki ili priloga računa i odbijaju dodavanje troška na obrisani/nepostojeći račun. Obična dokumentacija kooperanta i ručni troškovi zadržavaju svoje postojeće tokove.

Knjiženje novog računa najprije učita datoteku, a zatim jednim RPC-om atomarno upisuje metapodatke i sve troškove. Ako odgovor baze nije jednoznačan, klijent provjerava je li transakcija ipak spremljena prije čišćenja datoteke. Stara grupna brisanja prije ove migracije nisu retroaktivno obnovljiva; stariji klijenti mogu biti blokirani pri pojedinačnom brisanju računa, zato nakon migracije koristite novi build.

Ova faza pokriva **grupno brisanje/povrat računa i atomarno stvaranje računa**. Zasebna povijest promjena stavki računa i promjene statusa plaćanja još nije dio ovog panela; ne koristi se za poništavanje bankovne uplate. Lokalni PostgreSQL/API/UI testovi pokrivaju rollback cijelog paketa, retenciju datoteke, nedostajuće priloge, prava i povrat stavki. Prije produkcije provjeriti stvarne Storage RLS politike i knjiženje/brisanje/povrat u dvije sesije na stagingu.

## Responsive raspored

Tailwind prijelomi su `sm` 640 px, `md` 768 px, `lg` 1024 px, `xl` 1280 px i `2xl` 1720 px. Sadržaj koristi jedan stupac ispod 1280 px, dva od 1280 px, a raniji rasporedi s tri ili više stupaca vraćaju se od 1720 px. Navigacijski gumbi nisu sadržajni gridovi. Filtri i akcije slažu se okomito ispod 1280 px; na širim ekranima zadržavaju vodoravni raspored uz prelamanje. Bočna navigacija vidljiva je od 1280 px, osim na ekranima s postojećim automatskim skrivanjem; ispod toga otvara se gumbom iz zaglavlja.

Široke tablice pomiču se unutar vlastitih ograničenih kontejnera, ne cijele stranice. Zajednički modal ima ograničenu visinu prema dinamičkom viewportu, pomični sadržaj i zaseban pomični podnožni dio s akcijama; dugi naslovi prelamaju se. Glavni sadržaj ograničen je na 2560 px na najvećim zaslonima. Nije dodano globalno skrivanje horizontalnog overflowa.

Provjera: `node --test tests/layout.test.mjs`. Za pregled stvarnih komponenti s izoliranim testnim podacima bez pristupa bazi: `node tests/responsive-fixtures.mjs <putanja-do-html-datoteke>`. HTML se može otvoriti u pregledniku i provjeriti na 375, 768, 1280 i 1720 px; svaki korijenski `data-fixture` element predstavlja zaseban ekran (ukloniti mu atribut `hidden` za prikaz). Ovo nije zamjena za provjeru svih korisničkih tokova s produkcijskim podacima.

## Fotografije gradilišta

U detaljima i pregledu gradilišta sve fotografije radnika dostupne su u predpregledu, bez ograničenja na prvih deset. Galerije prikazuju najviše tri reda odjednom; ostale slike pregledavaju se okomitim pomicanjem unutar galerije. Sličice prikazuju cijelu fotografiju bez rezanja. Klik otvara uvećani pregled s listanjem; svaka fotografija ima gumb **Preuzmi** i na sličici i u uvećanom pregledu. Isto vrijedi za slike dodane izravno na gradilište u odjeljku **Slike**. Postojeće preuzimanje svih fotografija radnika kao ZIP ostaje dostupno.

## Stvarni troškovi i prihodi gradilišta

U modulu **Rekapitulacija** tab **Stvarni troškovi i prihodi** prikazuje popis gradilišta, evidentirane troškove uvećane za rad prema odabranoj univerzalnoj satnici ili netto satnici radnika, izdane fakture svih statusa, plaćeni i nenaplaćeni dio, razliku, maržu i radne sate. Prihod koristi postojeći obračun fakture (`iznos + rabat`), nije isto što i naplata i ne uključuje nefakturirane ugovorene radove.

Filtri obuhvaćaju pretragu, višestruki odabir gradilišta, status, regiju, investitora prema objektu, objekt, voditelja, razdoblje, kategoriju troška, status fakture, financijski rezultat, prisutnost evidencije i raspone troška, prihoda i razlike. Razdoblje je uključivo i primjenjuje se na datum troška, rada i izdavanja fakture. Kategorija filtrira samo troškove (kategorija plaća uključuje i radne sate), a status fakture samo prihode; razlika i marža tada prikazuju odabrani dio evidencije. Marža bez prihoda nije definirana. Zbrojevi i PDF/Excel izvoz prate iste filtre; ukupna marža računa se iz ukupne razlike i prihoda, ne kao prosjek marži gradilišta. Klik na naziv otvara postojeći detaljni pregled gradilišta. Nova migracija nije potrebna.

## Kopiranje neriješenih zadataka na novi nalog

Pri spremanju naloga iz dnevnog rasporeda odabrani neriješeni zadaci s drugih
naloga kopiraju se uz vezu na izvorni zadatak. Svaki red skupnog unosa izričito
šalje `vrsta` (`zadatak` ili `dodatni`), kako miješani popis ne bi pokušao
spremiti `NULL` umjesto obavezne vrste. Izvorni zadatak ostaje na starom nalogu.
Popravak zahtijeva novu verziju klijenta, bez dodatne SQL migracije.

### Obostrano rješavanje povezanih stavki

Migracija `20261110410000_obostrano_rjesavanje_kopiranih_stavki.sql` zamjenjuje
automatsko brisanje kopija usklađivanjem oznaka. Označavanje zadatka, dodatnog rada,
materijala ili alata kao riješenog na bilo kojem aktivnom nalogu označava i njegov
izvor, druge kopije te kopije kopija. Uklanjanje oznake ponovno otvara sve povezane
aktivne zapise. Kopije ostaju na svojim nalozima; nazivi, sati, izvještaji, prilozi
i veze ne mijenjaju se. Materijal i alat usklađuju obje oznake, `gotovo` i `uzeto`.

Veza se prati samo preko `izvor_zadatak_id`, `izvor_materijal_id` odnosno
`izvor_alat_id` (za starije kopije materijala/alata i preko `izvor_id` ako nova
izvorna veza nije upisana), unutar iste tvrtke, gradilišta i vrste stavke. Isti naziv nije
dovoljan za povezivanje. Završeni i otkazani nalozi ostaju netaknuti, ali njihove
veze i dalje povezuju aktivne kopije s obje strane lanca. Strojevi nisu uključeni.

Promjene se evidentiraju postojećim auditom; rokovi zadataka usklađuju se u istoj
transakciji. Povrat oznake kroz povijest aktivnog naloga također usklađuje povezane
aktivne zapise, nakon završetka provjera izvornog paketa obnove. Ako druga osoba
zaključava povezanu stavku ili nalog, spremanje se odbija bez djelomičnih promjena;
potrebno je osvježiti nalog i pokušati ponovno.
Samostalna promjena oznake na završenom ili otkazanom nalogu odbija se i u bazi,
neovisno o tome dolazi li iz naloga ili pregleda gradilišta.

U ERP-u se završeni radni zadaci i dodatni radovi mogu ponovno otvoriti uklanjanjem
oznake u njihovoj povijesti. Nakon spremanja ponovno se učitavaju stavke odabranog
naloga; portal djelatnika već ponovno učitava detalje. Drugi otvoreni ekrani nisu
pretplaćeni na te promjene i treba ih osvježiti ili ponovno otvoriti. Pregled
gradilišta učitava povezane stavke nakon spremanja, a njegov postojeći periodični
pregled osvježava podatke i bez ponovnog otvaranja.

Migraciju treba primijeniti nakon prethodnih migracija i objaviti novu verziju
klijenta. Ona ne vraća kopije koje su ranije obrisane niti retroaktivno mijenja
postojeće oznake; usklađivanje se pokreće pri sljedećoj promjeni oznake. Lokalni
PostgreSQL testovi pokrivaju oba smjera za sve četiri vrste, lance i cikluse,
zatvorene naloge, nepovezane zapise, granice tvrtke/vrste/gradilišta, RLS početne izmjene,
povrat povijesti, rokove i atomsko odbijanje neuskladive izmjene. Istodobne sesije
treba dodatno provjeriti na testnoj PostgreSQL instanci.

Postavke dopuštenih tipova vozila po kategoriji djelatnika nalaze se u modulu
**Vozila**, u malom izborniku **Ograničenja točenja goriva**, koji je početno
sklopljen. Podaci se učitavaju tek pri otvaranju izbornika; postavke više ne
zauzimaju prostor na popisu djelatnika. Zadržana su postojeća prava: pregled
zahtijeva pregled djelatnika, a spremanje uređivanje djelatnika, uz nepromijenjene
politike baze. U obrascu djelatnika ostaje informativni prikaz ograničenja njegove
kategorije. Premještanje ne zahtijeva novu SQL migraciju.

Na portalu djelatnika unos goriva nema izbor „Tko je točio”. Osoba se automatski
preuzima iz djelatnika povezanog s prijavljenim računom (`profile.radnik_id`);
njegova kategorija određuje dostupna vozila. I dalje se spremaju djelatnik, ime i
korisnik koji je unio gorivo. Ako povezani djelatnik nije dostupan, unos se odbija
uz poruku, bez zamjene prvim djelatnikom s popisa. ERP unos goriva zadržava izbor
osobe. Za ovu promjenu portala nije potrebna nova SQL migracija.

### Oznake početnih i krajnjih rokova

Terminski plan uz naziv gradilišta prikazuje njegov početak i kraj kada su
uneseni. Tanka siva isprekidana crta u zaglavlju gradilišta označava razdoblje,
a kratke okomite oznake stvarne datume početka/kraja unutar prikazanog prozora.
Ako postoji samo jedan datum, prikazuje se samo njegova oznaka (ne pretpostavlja
se trajanje). Gradilišta s razdobljem koje ulazi u prozor prikazuju se i bez
rokova ili angažmana; ostaju orijentir uz filtriranje aktivnosti po statusu i
kooperantima, ali poštuju odabir gradilišta i razdoblja. Orijentir ostaje i pri
širenju aktivnosti te se uključuje u PDF izvoz. Ne dodaju se novi rokovi u bazu.

Sažeci rokova na karticama gradilišta, u rasporedu i obavijestima (uključujući
nadzornu ploču) uz naziv aktivnosti prikazuju **Početni rok** ili **Krajnji rok**.
Za razdoblje s različitim datumima do uključivo dana početka koristi se početni
datum; nakon toga krajnji. Prošli početak ne označava aktivnost zakašnjelom dok
krajnji rok nije prošao. Jednodnevni rokovi i stari zapisi samo s jednim datumom
prikazuju se kao krajnji rokovi. U detaljima gradilišta i terminskom planu oba
datuma razdoblja imaju izričite oznake; nazivi aktivnosti ne mijenjaju se.
Promjena ne zahtijeva migraciju baze.

### Odustajanje od naloga — popravak stare veze ekipe

Ako odustajanje u rasporedu javlja `radni_nalozi_radnici_nalog_id_fkey`,
primijeniti `supabase/migrations/20261110430000_nalozi_radnici_brisanje_fk.sql`
nakon prethodnih migracija. Stare instalacije mogu imati nekaskadnu vezu:
izvorni `CREATE TABLE IF NOT EXISTS` ne popravlja već postojeća ograničenja.
Nova migracija usklađuje samo vezu `radni_nalozi_radnici.nalog_id` prema nalogu
na `ON DELETE CASCADE`, bez brisanja postojećih podataka ili promjene veze prema
djelatnicima, RLS-a i zaštićenog postupka brisanja. Zadržava naziv ograničenja,
ponašanje pri promjeni ID-a i odgodivost postojećih veza.

U rasporedu **Odustani od naloga** briše nalog kroz postojeći atomski paket s
povratom 30 dana; dodjele ekipe ulaze u isti paket i vraćaju se zajedno s nalogom.
Ne brišu se sami djelatnici. U modulu **Radni nalozi**, akcija odustajanja
označava nalog kao **Otkazan** i ne briše njegove povezane zapise. Neuspjelo
brisanje iz rasporeda zadržava otvoren obrazac. Migraciju prvo provjeriti na
testnoj bazi; ne zaobilaziti zaštitne okidače niti ručno brisati ekipu.

### Osobni auto — pilot portala djelatnika

Nakon prethodnih migracija na testnoj bazi primijeniti
`supabase/migrations/20261110420000_osobni_auto_pilot.sql` i zatim objaviti novi
build. Migracija zahtijeva točno jednog aktivnog djelatnika **Ivan Perićak** s
odobrenim računom povezanim u istoj tvrtki; ako ga nema ili ih ima više, prekida
se bez djelomične primjene. U privatnu tablicu pohranjuje njegov ID i tvrtku.
Naknadna promjena imena ne prenosi pristup drugom djelatniku. Administrator bez
te veze također nema pristup pilotu. Vidljivost kartice **Osobni auto** provjerava
se na poslužitelju; isti uvjeti vrijede za svaki RPC i čitanje zapisa.

Obrazac **Prijavi vožnju** ima auto, datum, početno/završno stanje kilometara i
obavezan odabir gradilišta ili **Privatno**. Zadnji odabrani auto pamti se u bazi
i na drugim uređajima. Početno se nudi njegova aktualna kilometraža, a raniji
zapis može se unijeti ispravkom početnog stanja. Neobavezni polazak/dolazak i
napomena služe samo evidenciji vožnje; dolazak može biti sljedeći dan.
**Ne nastaju radni sati niti stavke obračuna plaće.**

- Privatna vožnja ostaje u vlastitoj povijesti bez troška gradilišta.
- Poslovna vožnja atomski stvara red u postojećim troškovima (`put`): prijeđeni
  kilometri × cijena/km odabranog vozila, zaokruženo na dvije decimale. Gradilište
  i nadzorna ploča koriste taj postojeći trošak. Cijena, iznos i nazivi ostaju
  snimljeni uz vožnju; naknadna promjena cjenika ne mijenja prošli obračun.
  Nedostala ili nevaljana cijena blokira poslovni unos, ali ne privatni.
- Unos, trošak i povećanje kilometraže spremaju se zajedno ili ništa. Kilometraža
  se nikad ne smanjuje. Ponovljena prijava istog zahtjeva ne udvostručuje trošak;
  aktivni intervali kilometara za isti auto ne smiju se preklapati.
- Pogrešan unos stornira se uz razlog. Povijest i originalni iznos ostaju,
  povezani trošak postaje 0 €, kilometraža auta se ne vraća unatrag. Plaćen
  trošak prvo treba razriješiti u uredu. Izravno uređivanje iznosa/veza i brisanje
  povezanog troška blokirani su; status plaćanja može se mijenjati.
- Povijest učitava po 30 vlastitih vožnji. Druge tvrtke i djelatnici nemaju
  pristup. Izravni klijentski unos, izmjena i brisanje redova vožnji nisu dopušteni.
  Vozilo, gradilište, djelatnik, račun i povezani trošak ne mogu se obrisati dok
  postoje reference iz ove trajne povijesti, uključujući stornirane zapise.

**Ne unositi ovdje kilometre već obračunate radnim nalogom.** Pilot blokira
preklapanje svojih vožnji, ali ne provjerava intervale obračuna naloga. Opis
troška počinje s `Osobni auto:`, odvojeno od dnevnog obračuna `Kilometri:`,
pa dnevni obračun ne briše ni zamjenjuje troškove pilota.

Prije produkcije provjeriti na stagingu Ivanov račun, privatni/poslovni unos,
točan zbroj na gradilištu/nadzornoj ploči, storno, prava drugog korisnika i
istodobne unose u dvije sesije. Lokalni PostgreSQL testovi koriste postojeće
okidače troškova i audita, ali ne zamjenjuju provjeru stvarnih paralelnih sesija.
Migracija i objava ne pokreću se automatski iz aplikacije.

## Prijava i korisnička prava

U **Korisnici i prava** popis modula za svakog korisnika početno je sklopljen. Klik na **Moduli i prava** otvara ili zatvara tablicu prava; sažetak prikazuje broj modula s pravom pregleda i uređivanja. Gumb **Spremi prava** ostaje dostupan i kada je popis sklopljen. Otvaranje i zatvaranje popisa ne mijenja dodijeljena prava.

Prijava koristi Supabase Auth s e-mailom i lozinkom. Svaki korisnik pripada jednoj tvrtki. Novi računi otvaraju se pozivnicom administratora; javna registracija nije dopuštena. RLS odvaja poslovne podatke i privatne datoteke tvrtki te zadržava prava pregleda/uređivanja po modulima.

Za sigurno pokretanje:

1. Prije multi-company migracije provjerite postoji li početni vlasnički račun `ivan.pericak@gmail.com`. Na novoj instalaciji prvo ga izradite kroz Supabase Auth.
2. Primijenite migracije redom, uključujući multi-company migraciju, uz sigurnosnu kopiju i staging provjeru.
3. Ako početni račun još nije odobren/administrator, vlasnik baze može mu postaviti prava:

   ```sql
   UPDATE public.app_profiles
   SET approved = true, is_admin = true
   WHERE email = 'ivan.pericak@gmail.com';
   ```

4. Deployajte funkcije za upravljanje tvrtkama/pozivnicama i obavijesti. Vlasnik otvara tvrtke i podešava dostupne module te smjer obračuna rabata na ekranu **Tvrtke**; administratori pozivaju korisnike i dodjeljuju im prava u **Korisnici i prava**. Smjer rabata sprema se na svaku novu fakturu, pa promjena postavke ne mijenja ranije fakture.

Detaljan plan, prijenos postojećih podataka, konfiguracija pozivnica i provjere opisani su u [Multi-company vodiču](docs/MULTI_COMPANY.md). Broj djelatnika i korisničkih računa po tvrtki nije aplikacijski ograničen.

### Portal djelatnika

Za pristup preglednim sličicama povezanih slika gradilišta primijeniti novu migraciju `supabase/migrations/20261110640000_portal_site_document_thumbnails.sql` nakon prethodnih migracija. Ranija Storage pravila dopuštala su izvornu datoteku (`putanja`), ali ne i `thumbnail_path`, pa je učitavanje povezanih dokumenata moglo završiti porukom „Object not found”. Migracija usklađuje postojeće restriktivno pravilo i pravilo čitanja, bez promjene uvjeta upisa. Ne vraća fizički obrisane datoteke. Provjera: `node --test tests/worker-portal-document-storage.test.mjs tests/mobile-work-order-submit.test.mjs`. Nakon primjene otvoriti nalog kao dodijeljeni djelatnik i ponoviti učitavanje dokumenata; provjeriti izvornu sliku i sličicu. Ako greška ostane, provjeriti postoje li obje datoteke u Storageu. Testovi koriste lokalni PGlite i ne potvrđuju stanje produkcijskih datoteka.

Nedostupan dokument naloga ili povezani dokument gradilišta prikazuje zasebno upozorenje s mogućnošću ponovnog učitavanja; ne prekida učitavanje radnih podataka ni predaju naloga. Portal traži poveznice samo za dokumente gradilišta povezane s odabranim nalogom. Ako predaja uspije, a naknadno osvježavanje ne uspije, poruka jasno navodi da je promjena spremljena. Upozorenje o dokumentima ne znači da je datoteka izbrisana: uzrok može biti i nedostupan pristup u Storageu. Nova SQL migracija nije potrebna; potrebno je objaviti novi web-build (i ažurirati web-sadržaj native aplikacije ako se koristi). Regresijske provjere: `node --test tests/mobile-work-order-submit.test.mjs`.

Na radnim nalozima prikazuju se samo neriješeni radni zadaci, dodatni radovi, materijal i alat — pri odabiru stavki u rasporedu i pri popunjavanju naloga u web portalu i mobilnoj aplikaciji. Nakon oznake „riješeno” stavka nestaje s naloga, ali se ne briše iz evidencije gradilišta. Spremanje naloga zadržava vezu ranije riješenih stavki s nalogom. Nova migracija nije potrebna. Provjera spremanja: `node --test tests/work-order-items.test.mjs`.

Pregled gradilišta zadržava i riješene stavke s kvačicom i precrtanim nazivom. Zadaci, materijal i alat čitaju isti spremljeni status kao nalog; nije potrebno zaključiti nalog. Otvoreni pregled osvježava te podatke svakih 15 sekundi dok je kartica preglednika vidljiva te pri povratku na karticu/prozor, kako bi pokazao i promjene radnika s drugog uređaja.

Materijal i alat imaju jednu korisničku oznaku: kvačica znači **riješeno**, ostaje označena na gradilištu, a stavka nestaje s naloga. Prikazuje se sav neriješeni alat, ne samo onaj iz inventara. Migracija `supabase/migrations/20261026074000_material_tool_checkbox_completion.sql` pretvara ranije oznake preuzimanja u riješene stavke i usklađuje polja `uzeto` i `gotovo` radi kompatibilnosti sa starijim aplikacijama i provjerama pokretanja naloga. Strojevi nisu obuhvaćeni. Prethodna migracija `supabase/migrations/20261026073000_work_order_item_site_link.sql` popravlja nedostajuće veze stavki s gradilištem unutar iste tvrtke. RLS pravila ostaju nepromijenjena.

Nakon migracije `supabase/migrations/20261021110000_worker_portal.sql` svaki odobreni korisnik koji nije administrator ni označen kao **Voditelj** (u **Korisnici i prava**) nakon prijave vidi samo Portal djelatnika — i na webu i na mobitelu: moje radne naloge, raspored ekipa i vozila, moje radno vrijeme i moje dokumente. ERP moduli (fakture, ponude, troškovi, vozila, administracija, tvrtke…) su mu skriveni u sučelju i blokirani RLS-om; od modula smije samo čitati alat i strojeve radi odabira na nalogu. Migracija postojeće uredske račune bez povezanog djelatnika, koji imaju neko pravo, automatski označava kao voditelje.

Tab **Raspored** u portalu prikazuje kopiju dnevnog rasporeda (vozila, vrijeme polaska, gradilišta i ekipe) koju ured pošalje na kartici **Pošalji raspored** u Dnevnom rasporedu (vidljiva korisnicima s pravom uređivanja rasporeda; prikazuje pregled kakav vide radnici i status slanja; migracija `supabase/migrations/20261021120000_raspored_objave.sql`). Promjene rasporeda nakon slanja radnici ne vide dok se raspored ne pošalje ponovno.

### Obračun sati

Portal djelatnika računa ukupne i noćne sate iz aktualnog početka i završetka smjene, istim izračunom kao troškove naloga, uključujući prijelaz preko ponoći. Noćni sati zato su vidljivi i prije odobrenja naloga; nezavršena smjena još se ne zbraja. Zadani noćni interval je 22:00–06:00 (postavke noćnog rada). Noćni sati su dio ukupno odrađenih sati, ne dodatni sati.

U **Radno vrijeme → Obračun sati** (potrebno pravo pregleda modula Radnici; za izmjene pravo uređivanja) vidi se mjesečni obračun po radniku: redovni rad, noćni rad, teren, praznik, godišnji i bolovanje. Kvačicom se radniku odobrava pravo na pojedinu kategoriju; obračunavaju se samo odobrene kategorije, po cijenama upisanima kod radnika. Noćni rad i teren bez odobrenja ne upisuju se ni u trošak gradilišta (vrijedi za naloge zaključene nakon promjene). Godišnji, bolovanje i dodatne slobodne dane upisuje ured; broje se radni dani (pon–pet), godišnji ne uključuje državne praznike, a državni praznik na radni dan kad radnik nije radio računa se automatski. U Portalu djelatnika radnik u kartici **Vrijeme** vidi samo sate/dane odobrenih kategorija, bez iznosa. Potrebna je migracija `supabase/migrations/20261021130000_obracun_sati.sql` (postojećim radnicima odobrava kategorije za koje već imaju upisanu cijenu); provjera izračuna: `npm run test:obracun`.

Klik na ime radnika u **Obračunu sati** otvara detalje odabranog mjeseca: rad po datumima, gradilište, broj i naslov naloga, početak i završetak smjene (ako je upisan na nalogu), sate, noćne sate, teren i napomene. Prikazana su odsustva i automatski obračunati državni praznici te dnevna i mjesečna razrada troška po kategorijama. Trošak koristi iste trenutačne cijene i prava kao glavna tablica, a dnevni iznosi zadržavaju točan mjesečni zbroj i pri zaokruživanju centi. Teren se broji jednom po danu. Prikaz obuhvaća evidenciju uključenu u obračun, ne naloge koji još nemaju evidentirane sate. Ručna evidencija bez podataka o smjeni prikazuje crtice umjesto pretpostavljenog vremena. Nova migracija nije potrebna.

Kartica **Vrijeme** u Portalu djelatnika prikazuje povijest po mjesecima (tekući i do 24 prethodna). U **Obračun sati** stupac „Portal: Vrijeme” određuje vidi li pojedini radnik tu karticu (gumbi „Uključi svima” / „Isključi svima”); kad je isključena, kartica se ne prikazuje, a RPC-ovi `get_my_radno_vrijeme` i `get_my_obracun_podaci` ne vraćaju podatke. Potrebna je migracija `supabase/migrations/20261021150000_portal_vrijeme_vidljivost.sql` (nakon `20261021140000`); postojećim radnicima kartica ostaje uključena.

## Mobilna aplikacija za radne naloge

Mobilna aplikacija za Android i iOS koristi postojeći Supabase Auth. Prije puštanja u rad:

1. Primijenite sve migracije redom, uključujući `supabase/migrations/20261016180000_mobile_work_orders.sql`, `supabase/migrations/20261016190000_mobile_shared_team_time.sql` i `supabase/migrations/20261016200000_mobile_work_order_audit.sql`.
2. U **Korisnici i prava** odobrite račun djelatnika i povežite ga s njegovim zapisom u **Radnici**.
3. U detaljima izvršenja radnog naloga odaberite poslovođu, koji mora biti među dodijeljenim djelatnicima. Zaključajte nalog iz rasporeda tek kad su dodani zadaci i ostali potrebni podaci.
4. Izradite Android/iOS pakete nakon konfiguracije push obavijesti:
   - Android push je trenutačno isključen. APK se može izgraditi bez Firebase konfiguracije; postojeće Android push tokene aplikacija uklanja pri pokretanju. Za ponovno uključivanje push obavijesti dodajte `google-services.json` za Firebase projekt u `android/app/` (Firebase Android app ID `com.tmcolor.erp`) i ponovno omogućite Android registraciju u `src/components/mobile/usePushRegistration.ts`.
   - U Xcodeu otvorite iOS projekt, postavite Team/signing za `com.tmcolor.erp` i provjerite da Apple Developer App ID ima uključene Push Notifications. Projekt koristi `development` APNs entitlement u Debug i `production` u Release konfiguraciji.
   - Deployajte Edge Function `notify-work-order` (`supabase functions deploy notify-work-order`) i postavite Supabase secrets potrebne za odgovarajuće platforme: `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_EMAIL`, `FCM_SERVICE_ACCOUNT_PRIVATE_KEY` za Android te `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` za iOS. Za slanje u APNs sandboxu postavite `APNS_USE_SANDBOX=true`; Release aplikacija koristi produkcijski APNs.
   - Servisni ključevi pripadaju samo u Supabase Secrets, nikad u aplikaciju, `.env` ili repozitorij.
5. Pokrenite `npm run cap:sync` nakon promjena web-aplikacije, zatim `npm run cap:android` ili `npm run cap:ios` na računalu s odgovarajućim Android SDK/JDK-om ili macOS/Xcodeom.

Pri prvom pokretanju djelatnik se prijavi, odobri push obavijesti i tako registrira uređaj. Zaključani nalog tada stiže kao push; dodirom se otvara taj nalog. Svi dodijeljeni djelatnici evidentiraju početak i završetak vremena za cijelu ekipu na istom nalogu. Samo poslovođa ispunjava zajednički izvještaj, potvrđuje pregled vremena ekipe i predaje nalog; trošak se obračunava tek nakon završnog odobrenja u ERP-u. Promjene vremena, izvještaja, zadataka, materijala/alata, fotografija i statusa bilježe se uz nalog, a povijest je vidljiva u web aplikaciji u detaljima naloga i osvježava se svakih 30 sekundi. Ako push konfiguracija nije spremna, nalog se svejedno zaključava i dostupan je u aplikaciji, a ERP prikazuje razlog zbog kojeg obavijest nije poslana.

Uz radne zadatke gradilišta i naloga postoji odjeljak **Dodatni radovi** (migracija `20261021160000_dodatni_radovi.sql`, stupac `gradiliste_zadaci.vrsta`). Dodatni radovi ponašaju se jednako kao radni zadaci: prenose se na sljedeći nalog, nedovršeni se vraćaju na gradilište, imaju rokove i potvrdu u mobilnoj aplikaciji. Nalog s dodatnim radovima zahtijeva novu verziju mobilne aplikacije za predaju. Djelatnici u mobilnoj aplikaciji i Portalu djelatnika ne mogu dopisivati radne zadatke (samo ih označavaju kao obavljene), nego nove stavke upisuju u dodatne radove; to se provjerava i u bazi (migracija `20261021170000_radnik_samo_dodatni_radovi.sql`).

### Povrat obrisanih ponuda

Nakon prethodnih migracija primijeniti `supabase/migrations/20261110220000_ponude_povrat_brisanja.sql`, prvo na testnoj bazi, i objaviti novi build. U **Ponude** dostupan je panel **Obrisane ponude i stavke (30 dana)**. Brisanje ponude koristi zaštićenu transakciju koja čuva ponudu i sve kaskadno obrisane stavke; izravno brisanje iz starog klijenta ili SQL poziva odbija se.

Povrat vraća izvorne ID-eve i vrijednosti ponude te svih njenih stavki. Gradilište koje je nastalo iz ponude ostaje nepromijenjeno. Potrebno je aktualno pravo uređivanja **Ponuda**; naknadno promijenjeni redovi ili nedostupne povezane reference blokiraju povrat u cijelosti. Ranija nezaštićena brisanja nisu obnovljiva. Povrat nije povijest pojedinačnih izmjena ponude ili njenih stavki.

### Povrat obračuna radnog naloga

Nakon migracije za povrat ponuda primijeniti `supabase/migrations/20261110230000_nalozi_obracun_povijest_vracanje.sql`, zatim `supabase/migrations/20261110310000_nalog_obracun_povrat_status_guard.sql`, `supabase/migrations/20261110320000_nalog_status_obracun_atomaran.sql`, `supabase/migrations/20261110330000_nalog_zavrsni_izvjestaj_atomaran.sql`, `supabase/migrations/20261110340000_nalog_rokovi_atomarna_sinkronizacija.sql`, `supabase/migrations/20261110350000_nalog_status_povijest_ured.sql` i `supabase/migrations/20261110360000_nalog_status_izvrsenje_povrat.sql`, prvo na testnoj bazi, pa objaviti novi build. Novi panel **Prethodni obračuni sati i troškova naloga (30 dana)** nalazi se u **Radni nalozi**. Ponovni obračun sada u jednoj transakciji zamjenjuje sate te povezane troškove rada i opreme, uz privatni paket povrata. Zaključivanje/ponovno otvaranje, spremanje završne kilometraže/napomene, obračun, prijenos neriješenih zadataka natrag na gradilište te sinkronizacija rokova dovršenih zadataka sada su u istoj transakciji; ako neki od tih koraka ne prođe, promjena se poništi. Promjene statusa i završnog izvještaja iz ERP-a bilježe se i u postojećoj paginiranoj povijesti aktivnosti naloga. Uz pojedinu ERP promjenu statusa moguće je vratiti status, završni izvještaj, pripadajući paket sati/troškova te prenesene zadatke i projekcije rokova u jednoj transakciji. Povrat je dostupan 30 dana, zahtijeva prava uređivanja svih zahvaćenih modula i odbija se ako su nalog, zadaci, rokovi ili obračun naknadno promijenjeni. Zastarjele privatne snimke čisti postojeći satni cron `prune-business-change-history`; provjeriti da posao radi u Supabase Cron prikazu. Kilometarski troškovi nisu dio te transakcije; nakon povrata ponovno se sinkroniziraju za cijeli dan, a neuspjeh se posebno prijavljuje uz mogućnost ponovnog pokušaja. Prijenos/sinkronizacija zadataka zahtijeva pravo uređivanja **Gradilišta** kad postoje zadaci na nalogu. Povrat obračuna se blokira i ako su se nakon obračuna promijenili status, potvrda djelatnika, oznake izvršenja/troška, gradilište, kilometraža ili oznaka terena naloga. Stari RPC `replace_work_order_hours` nakon migracije vraća jasnu pogrešku kako stari klijent ne bi zaobišao povijest. Dnevni kilometarski obračun i kilometraža vozila ostaju nakon glavne transakcije jer obuhvaćaju sve naloge i vozila za taj datum. Ako jedan od tih naknadnih koraka ne uspije, aplikacija izričito javlja da je status naloga već spremljen, a da sinkronizacija kilometara nije uspjela.

Povrat vraća izvorne redove sati i troškova rada/opreme. Potrebna su prava uređivanja **Radni nalozi**, **Radno vrijeme** i **Troškovi**. Povrat odbija nalog, ekipu, sate ili stavke troškova koji su naknadno mijenjani ili ponovno obračunati; za istu provjeru serijaliziraju se izmjene troška s redom naloga. **Kilometarski troškovi po vozilu** imaju zaseban dnevni paket povrata. Povrat pojedinačne promjene statusa zasebno uključuje pripadajuće zadatke i rokove; status i izvršenje ne mogu se vraćati preko običnog paketa obračuna.

### Povrat dnevnog kilometarskog obračuna

Nakon migracije obračuna naloga primijeniti `supabase/migrations/20261110240000_dnevni_kilometarski_troskovi_povrat.sql`, prvo na testnoj bazi, pa objaviti novi build. Panel **Prethodni dnevni kilometarski obračuni (30 dana)** nalazi se u **Radni nalozi**. Svako ponovno računanje za taj datum sada zamjenjuje sve kilometarske troškove vozila tog dana u jednoj transakciji, uključujući uklanjanje zastarjelih troškova ako za dan više nema raspoređenih naloga. Pojedinačne izravne izmjene/brisanja kilometarskih redova blokira baza.

Povrat obuhvaća sve kilometarske troškove tvrtke za jedan datum. Potrebna su prava uređivanja **Radni nalozi** i **Troškovi**. Ako se dnevni obračun ponovno pokrene ili se njegove stavke naknadno promijene, stariji povrat se odbija. Povrat vrijedi 30 dana; nije uključen u paket sati i troškova rada/opreme, a promjenu rasporeda ili naloga sam po sebi ne vraća.

### Povijest izmjena ponuda

Nakon migracije dnevnog kilometarskog obračuna primijeniti `supabase/migrations/20261110250000_ponude_povijest_izmjena.sql`, prvo na testnoj bazi, pa objaviti novi build. U **Ponude → Uredi ponudu** prikazuje se **Povijest izmjena ponude i stavki (30 dana)**. Spremanje zaglavlja i cijelog popisa stavki događa se u jednoj transakciji, a svaka promjena čuva privatnu snimku prije i poslije. Dodavanje nove ponude i uvoz AI troškovnika također koriste zaštićene pozive baze. Izravno uređivanje postojećih ponuda/stavki iz starog klijenta odbija se.

Povrat obnavlja podržana polja ponude i točne izvorne stavke, uključujući identitete i redoslijed. Potrebno je aktualno pravo uređivanja **Ponuda**. Povrat se odbija ako postoji novija neponištena izmjena, sadržaj je naknadno promijenjen, ponuda je obrisana ili izvorne reference investitora, objekta ili stavke kataloga više nisu dostupne u tvrtki. Vraćanje izmjene ponude ne mijenja gradilište nastalo iz ponude ni sam katalog stavki. Za obrisanu ponudu najprije vratiti paket brisanja.

Povijest se učitava po 50 radnji, vrijedi 30 dana, a privatne snimke čisti satni cron `prune-ponuda-change-history`. Provjeriti da posao radi u Supabase Cron prikazu. Ranije neevidentirane izmjene nisu obnovljive. Testovi pokrivaju atomsko spremanje zaglavlja i stavki, točan povrat, zastarjeli povrat, izolaciju tvrtki i prava te RPC pozive i pogrešku nedostajuće migracije. Prije produkcije provjeriti migraciju, RLS/okidače i istodobne zahtjeve na stagingu.
