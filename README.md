# Tm-color

## Fotografije gradilišta

U detaljima i pregledu gradilišta sve fotografije radnika dostupne su u predpregledu, bez ograničenja na prvih deset. Galerije prikazuju najviše tri reda odjednom; ostale slike pregledavaju se okomitim pomicanjem unutar galerije. Sličice prikazuju cijelu fotografiju bez rezanja. Klik otvara uvećani pregled s listanjem; svaka fotografija ima gumb **Preuzmi** i na sličici i u uvećanom pregledu. Isto vrijedi za slike dodane izravno na gradilište u odjeljku **Slike**. Postojeće preuzimanje svih fotografija radnika kao ZIP ostaje dostupno.

## Stvarni troškovi i prihodi gradilišta

U modulu **Rekapitulacija** tab **Stvarni troškovi i prihodi** prikazuje popis gradilišta, evidentirane troškove uvećane za rad prema odabranoj univerzalnoj satnici ili netto satnici radnika, izdane fakture svih statusa, plaćeni i nenaplaćeni dio, razliku, maržu i radne sate. Prihod koristi postojeći obračun fakture (`iznos + rabat`), nije isto što i naplata i ne uključuje nefakturirane ugovorene radove.

Filtri obuhvaćaju pretragu, višestruki odabir gradilišta, status, regiju, investitora prema objektu, objekt, voditelja, razdoblje, kategoriju troška, status fakture, financijski rezultat, prisutnost evidencije i raspone troška, prihoda i razlike. Razdoblje je uključivo i primjenjuje se na datum troška, rada i izdavanja fakture. Kategorija filtrira samo troškove (kategorija plaća uključuje i radne sate), a status fakture samo prihode; razlika i marža tada prikazuju odabrani dio evidencije. Marža bez prihoda nije definirana. Zbrojevi i PDF/Excel izvoz prate iste filtre; ukupna marža računa se iz ukupne razlike i prihoda, ne kao prosjek marži gradilišta. Klik na naziv otvara postojeći detaljni pregled gradilišta. Nova migracija nije potrebna.

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

4. Deployajte funkcije za upravljanje tvrtkama/pozivnicama i obavijesti. Vlasnik otvara tvrtke na ekranu **Tvrtke**; njihovi administratori pozivaju korisnike i dodjeljuju prava u **Korisnici i prava**.

Detaljan plan, prijenos postojećih podataka, konfiguracija pozivnica i provjere opisani su u [Multi-company vodiču](docs/MULTI_COMPANY.md). Broj djelatnika i korisničkih računa po tvrtki nije aplikacijski ograničen.

### Portal djelatnika

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
## Otvaranje lokalne mape gradilišta

Na svakom Windows računalu na kojem se mape otvaraju pokrenite `windows-helper\Instaliraj-pomocnik.bat` jednom. Zatim u detaljima gradilišta kliknite **Otvori u Exploreru**. Pri prvom otvaranju odaberite mapu; aplikacija će je zapamtiti za to gradilište i sljedeći put otvoriti izravno u Windows Exploreru. Ikona olovke služi za odabir ili promjenu mape.

Pomoćni program povezuje prilagođenu `tmcolor-folder:` adresu s PowerShell skriptom, koju instalacijska skripta kopira u `%LOCALAPPDATA%\TmColor\LocalFolderHelper`. Putanje mapa spremaju se samo lokalno, u `%LOCALAPPDATA%\TmColor\site-folders.json`. Mape nisu učitane u aplikaciju niti dijeljene s drugim korisnicima; svaki korisnik/računalo odabire vlastitu lokalnu mapu. Za uklanjanje registracije pokrenite `windows-helper\Ukloni-pomocnik.bat`.
