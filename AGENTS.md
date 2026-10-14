# Notes for coding agents

CronCal is a Next.js 16 app (App Router, TypeScript strict, Tailwind v4) that runs on the user's own computer against their own Supabase project. [CONTRIBUTING.md](CONTRIBUTING.md) is the guide: how it fits together, the code style, the database rules and the traps. [SECURITY.md](SECURITY.md) says what must stay true.

- Run it with `npm run develop` (port 3202, its own settings in `.dev-data`), never on the user's own CronCal data.
- This is Next.js 16, which differs from older versions in places: read the guide in `node_modules/next/dist/docs/` before writing Next-specific code.
- Before saying a change is done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run smoke`.
- `supabase/schema.sql` runs over users' existing tables: never drop or delete, and bump `SCHEMA_VERSION` with any change.
- Never print, log or commit a key or token (`sb_secret_`, a Google client secret, a Google access or refresh token).
- Google Calendar is reached only through the owner's own OAuth client, with the `calendar.events` scope: ask for nothing wider.
