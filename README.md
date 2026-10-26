# Chaos Catalog

Chaos-storage collection manager for trading cards (Yu-Gi-Oh! first). Cards go wherever there's room; the app
remembers where. Design and decisions: [DESIGN.md](DESIGN.md).

## Layout

| Path | What |
|---|---|
| `src/` | The web app (React + TypeScript + Vite) |
| `src/games/<game>/` | Per-game code (only `ygo` for now); `types.ts` describes the data files |
| `scripts/build-data.ts` | Builds the static card data (catalog, prices, meta) for every game |
| `scripts/games/<game>.ts` | Per-game data builder (`ygo`: YGOPRODeck API) |
| `supabase/migrations/` | Database schema, applied in order |
| `.github/workflows/deploy.yml` | Daily data build + deploy to GitHub Pages, and the Supabase keep-awake ping |

## Running locally

Needs Node.js 20.19 or newer.

```bash
npm install
npm run build:data   # downloads card data into public/data/ (about 12 MB; not committed)
npm run dev          # http://localhost:5173
```

Checks: `npm test` (search, collection model, and the SQL migrations run in PGlite), `npm run typecheck`,
`npm run lint`, `npm run build`.

If `npm install` fails with `Cannot read properties of null (reading 'edgesOut')`, that's a bug in npm 10.8; use
`npx -y npm@11 install` instead.

## Card data and prices

`npm run build:data` writes, under `public/data/ygo/`:

- `catalog.json`: every card from the [YGOPRODeck API](https://ygoprodeck.com/api-guide/) (two requests:
  `checkDBVer.php`, then `cardinfo.php?format=genesys&misc=yes`): stats, archetype, TCG/OCG dates, Genesys points,
  banlist status, Konami id, printings (plus TCGplayer-only printings, marked `tcg`) and the mentions index.
- `prices/<YYYY-MM-DD>.json`: TCGplayer market prices in USD per printing and edition, from
  [TCGCSV](https://tcgcsv.com) (thanks!), dated by TCGCSV's update. The last 28 days are kept; older files are deleted.
- `tcgplayer-products.json`: which TCGplayer product is which printing; the next run reads it back and only re-fetches
  sets that changed.
- `meta.json`: database version, build time, counts and the list of price days.

The GitHub Action runs this daily after TCGCSV's update and publishes the result with the site, reading earlier days
back from the live site, so data files are never committed.

**Be gentle with both sources.** YGOPRODeck asks for a local copy of its data, at most 20 requests per second, and no
hotlinking of images (the app icon was downloaded once and is stored in `assets/`). TCGCSV asks for a clear
User-Agent, a pause between requests, and no more than one request per price file in 24 hours. The builder does all of
this: one request at a time, 250 ms apart, and it skips TCGCSV entirely when that day's prices are already built
(locally or on the live site). Code pushes set `TCGCSV_FETCH=false` and redeploy with the published prices; only the daily and manual runs
fetch. For local experiments, `TCGCSV_MAX_GROUPS=40 npm run build:data` prices only the first
40 sets. Don't call either API from the browser.

## Setup: GitHub Pages

1. Create an empty GitHub repository (e.g. `chaos-catalog`) and push this repo's `main` branch to it.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Build and deploy → Run workflow** (or push to `main`). The site appears at
   `https://<user>.github.io/<repo>/`.

## Setup: Supabase

1. Create a free account at https://supabase.com and a new project (any name; pick the region nearest you; save the
   database password in a password manager).
2. **SQL Editor**: run each file in `supabase/migrations/` in order (each only once).
3. **Authentication → Sign In / Providers → Email**: turn off **Confirm email** (sign-ups already need an invite, and
   the free tier sends only a few emails an hour). **Authentication → URL Configuration**: set **Site URL** to the
   GitHub Pages address (e.g. `https://<user>.github.io/<repo>/`) and add it under Redirect URLs.
4. **First account:** in the SQL editor run `insert into public.invites (code) values ('<pick-a-code>');`, sign up in
   the app with that code, then run `update public.profiles set is_admin = true where username = '<you>';`. Admins
   create invite links for others under Account.
5. **Project Settings → API**: copy the project URL and the public anon (publishable) key.
6. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**: add `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`. The build passes them to the app, and the daily job pings the project so the free tier never
   pauses it. For local development put the same two values in `.env.local` as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (gitignored).

The anon key is designed to be public (it ships in the web app); access is controlled by Row Level Security. Never put
the `service_role` key in the app or in this repo.
