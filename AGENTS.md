# Repository Guide

## Project

- Tm-color is a React 18, TypeScript, and Vite ERP web app, also packaged for Android and iOS with Capacitor.
- The UI is in Croatian. Keep user-facing labels and messages consistent with the existing Croatian terminology.
- The main app shell and view selection are in `src/App.tsx`; feature screens are in `src/components/views/`, mobile work-order UI is in `src/components/mobile/`, shared UI is in `src/components/ui/`, and reusable backend/business logic is in `src/lib/`.
- Authentication and module permissions are in `src/auth/`. Shared application types are in `src/types.ts`.
- Supabase Edge Functions and ordered SQL migrations are under `supabase/`.

## Conventions

- Follow the existing React/TypeScript patterns and Tailwind utility styling. Keep changes scoped to the owning feature and reuse existing components and helpers.
- Route Supabase operations through the existing `src/lib/` API/service modules rather than duplicating data access in views.
- Preserve both UI permission checks and database Row Level Security. Permission changes must be checked against `src/auth/` and the relevant Supabase policies; client-side checks alone are not security controls.
- For schema or policy changes, add a new ordered migration under `supabase/migrations/`; do not rewrite an already-applied migration.
- Never put service-role keys, push credentials, or other secrets in source, `.env`, or committed configuration. Use Supabase Secrets for server-side credentials.
- Treat Android and iOS directories as native Capacitor projects. Regenerate/synchronize them only when required by a native or web-to-native change.

## Validation

- `npm run typecheck` runs the app TypeScript check.
- `npm run lint` runs ESLint across the repository.
- `npm run build` creates the production Vite build.
- There is no test script currently defined in `package.json`; do not report tests as run unless a relevant test command is added or otherwise available.

Run the narrowest relevant check after a change, then the broader build/lint checks when the scope warrants them. Supabase migrations should be reviewed for ordering, access control, and compatibility with existing data.