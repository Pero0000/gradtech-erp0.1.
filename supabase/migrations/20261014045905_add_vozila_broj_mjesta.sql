/*
# Dodaj stupac broj_mjesta vozilu

1. Izmjene:
- `vozila` - novi stupac `broj_mjesta` (integer, default 2) - označava broj ljudi koji stanu u vozilo

2. Napomene:
- Koristi se za validaciju u dnevnom rasporedu da broj dodijeljenih radnika ne prelazi kapacitet vozila
- Default 2 je minimalno za teretna vozila (vozač + suvozač)
*/

ALTER TABLE vozila ADD COLUMN IF NOT EXISTS broj_mjesta integer NOT NULL DEFAULT 2;