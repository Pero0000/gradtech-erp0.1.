ALTER TABLE public.tvrtke
  ADD COLUMN IF NOT EXISTS postavke jsonb NOT NULL
  DEFAULT '{"disabled_modules":[],"invoice_rebate_mode":"oduzmi"}'::jsonb;

UPDATE public.tvrtke
SET postavke = jsonb_set(
  jsonb_set(COALESCE(postavke, '{}'::jsonb), '{disabled_modules}', '[]'::jsonb, true),
  '{invoice_rebate_mode}',
  '"pribroji"'::jsonb,
  true
);

ALTER TABLE public.fakture
  ADD COLUMN IF NOT EXISTS rabat_smjer text NOT NULL DEFAULT 'pribroji'
  CHECK (rabat_smjer IN ('pribroji', 'oduzmi'));

NOTIFY pgrst, 'reload schema';
