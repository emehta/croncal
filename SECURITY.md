# Security

## Reporting a problem

Please report it privately: on this repo's **Security** tab, press **Report a vulnerability**. Don't open a public issue for it. You'll get a reply there, and the fix goes out as a new release before anything is said in public.

Only the latest release is fixed. To update, see [Update](README.md#update).

## What CronCal protects, and how

CronCal runs on the user's own computer against their own Supabase project. What it guards:

- **The secret key** (`sb_secret_`) is kept on the server side only: in `config.json` in the app-data folder, readable by the user's account alone (mode 600 on Mac and Linux). It is never sent to the page, and a secret key set where the publishable key belongs is refused rather than sent. A page can't move CronCal to another project: once one is saved, only new keys for that same project are taken, and moving takes removing `config.json` by hand (README, "Another project").
- **This computer only.** The server listens on 127.0.0.1, and `npm start` holds the same port on [::1], where a browser looks for localhost first, so no other program can answer there in CronCal's place. `src/proxy.ts` refuses any request whose Host isn't a loopback name, which stops a web page pointing its own domain at CronCal (DNS rebinding), and every write must come from CronCal's own pages (same origin, JSON), which stops another site posting to it.
- **One owner per project.** The account is made by the server with `app_metadata.self_host_owner`, which only the secret key can set. The tables' row level security needs that flag as well as the row's own user, so someone who signs up to the project through Supabase's API sees and writes nothing. Every Google route checks the same flag on the caller's session. A forgotten password is reset only with the secret key.
- **Google.** The client secret stays on the server side, in `settings.json` beside the config, and never reaches the page. The tokens are in `google_auth`, which no browser role can read. The connect cookie is signed with a key derived from the secret key, so nobody can point the callback's tokens at another account. CronCal asks Google for the calendar's events and the account's email, nothing more.
- **The database setup** (`supabase/schema.sql`) never drops or deletes anything, stops before changing anything if the project has a table by one of CronCal's names that CronCal didn't make, revokes everything from the browser's roles before granting the four privileges the app needs, and keeps the server's own tables out of the browser's reach.

`scripts/proxy.test.mjs`, `scripts/schema.test.mjs`, `scripts/owner-claim.test.mjs` and `scripts/config.test.mjs` hold these in place.

## Out of scope

- Someone who can already use the computer as its user: they can read the settings file, as they can read anything else of that user's.
- Supabase's own service, and Google's.
