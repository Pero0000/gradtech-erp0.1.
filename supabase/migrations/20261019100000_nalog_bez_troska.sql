-- Radni nalozi otvoreni sa stavki popisa "Ostalo" bilježe sate radnika u radno vrijeme (bez gradilišta), ali ne upisuju nikakav trošak.
ALTER TABLE radni_nalozi
  ADD COLUMN IF NOT EXISTS bez_troska boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
