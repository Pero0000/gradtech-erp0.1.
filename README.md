# Tm-color

## Prijava i korisnička prava

Prijava koristi Supabase Auth s e-mailom i lozinkom. Samostalne registracije ostaju na čekanju dok ih administrator ne odobri i dodijeli prava pregleda/uređivanja po modulu. RLS štiti tablice i privatni bucket `nalozi-foto`; migracija `supabase/migrations/20261016150000_auth_permissions.sql` mora biti primijenjena prije uključivanja aplikacije za korisnike.

Za sigurno pokretanje:

1. Primijenite sve Supabase migracije redom.
2. U aplikaciji napravite račun za osobu koja će biti prvi administrator.
3. U Supabase SQL Editoru postavite taj račun kao administratora (zamijenite e-mail stvarnom adresom):

   ```sql
   UPDATE public.app_profiles
   SET approved = true, is_admin = true
   WHERE email = 'admin@tvrtka.hr';
   ```

4. Prijavite se tim računom i otvorite **Korisnici i prava** kako biste odobrili ostale korisnike i dodijelili prava.

Prvi admin se namjerno ne bira automatski: javna registracija ne može sama sebi dodijeliti administratorski pristup.

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

## Otvaranje lokalne mape gradilišta

Na svakom Windows računalu na kojem se mape otvaraju pokrenite `windows-helper\Instaliraj-pomocnik.bat` jednom. Zatim u detaljima gradilišta kliknite **Otvori u Exploreru**. Pri prvom otvaranju odaberite mapu; aplikacija će je zapamtiti za to gradilište i sljedeći put otvoriti izravno u Windows Exploreru. Ikona olovke služi za odabir ili promjenu mape.

Pomoćni program povezuje prilagođenu `tmcolor-folder:` adresu s PowerShell skriptom, koju instalacijska skripta kopira u `%LOCALAPPDATA%\TmColor\LocalFolderHelper`. Putanje mapa spremaju se samo lokalno, u `%LOCALAPPDATA%\TmColor\site-folders.json`. Mape nisu učitane u aplikaciju niti dijeljene s drugim korisnicima; svaki korisnik/računalo odabire vlastitu lokalnu mapu. Za uklanjanje registracije pokrenite `windows-helper\Ukloni-pomocnik.bat`.
