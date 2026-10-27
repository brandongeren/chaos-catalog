# Chaos Catalog: design (living document; last updated 2026-10-27)

A chaos-storage collection manager for trading cards, Yu-Gi-Oh first. Cards go wherever there's room; the app remembers
where. Runs in any browser (phone or computer), installable as an app, free to host.

Name: **Chaos Catalog** (repo `brandongeren/chaos-catalog`). Icon: the artwork of the card "Chaos Greed".

---

## 0. Start here (handoff, 2026-10-27)

Everything a fresh session needs; the sections below hold the full design and decisions.

**State:** all 10 build phases are built, deployed and in use. Live: https://brandongeren.github.io/chaos-catalog/
(GitHub Pages, repo https://github.com/brandongeren/chaos-catalog, branch `main`). Supabase project
`https://uxnwfrxpxilgfvrbyvlx.supabase.co`. The owner's account is `brandongeren` (admin, city "lincoln, ne").

**Working rules** (also in `CLAUDE.md` and `~/claude/CLAUDE.md`):
- Personal project, separate from work tooling: never copy or reference it in `~/.claude` (the Waylon repo).
- Keep this file current in the same commit as any design change.
- Commits: identity is set per repo (`Brandon Geren`, `7003889+brandongeren@users.noreply.github.com`). The user
  allows pushing to `main`; every push deploys. Push runs never call TCGCSV (`TCGCSV_FETCH=false`).
- Be gentle with YGOPRODeck and TCGCSV (README "Card data and prices"): one request per TCGCSV price file per day.
- Database changes are new files in `supabase/migrations/` (never edit applied ones). The user runs them by hand in
  the Supabase SQL Editor; copy one for them with `pbcopy < supabase/migrations/<file>` and say what breaks until it
  runs. Any change to `_put_row()`/`apply_ops()` is a `create or replace` of the latest full body.
- Explain things in plain words; the user isn't a developer of this stack. The user prefers being asked before
  choices that are theirs, and a short action list when they owe steps.

**Migrations applied:** 0000-0007 confirmed (column checks with the public key). **0008_borrow_and_trade.sql:
unconfirmed** (copied to the user; can't be verified anonymously). Until it runs: "borrow and trade" can't be saved,
and the app re-downloads the collection on every open (safe, just more egress).

**Code map**
| Path | What |
|---|---|
| `scripts/build-data.ts`, `scripts/games/ygo.ts` | Daily data build: YGOPRODeck catalog (+ cardsets dates, beta names), TCGCSV prices |
| `scripts/games/ygo-tcgplayer.ts` | TCGplayer products → printings (set code+rarity, set code, name, title), variants, placeholders |
| `src/games/ygo/` | Yu-Gi-Oh adapter: types, search, query/URL, syntax, decks (formats), scan (OCR), prices, data loading |
| `src/games/ygo/ui/` | Search, card detail, filters, decks, prices, scan, syntax guide pages |
| `src/core/collection/model.ts` | Draft/applyOp: the only way the collection changes (shared with the server's semantics) |
| `src/core/collection/store.ts` | Sync: IndexedDB copy + queue, apply_ops, conflicts, skip-download check |
| `src/core/collection/{pull,files}.ts` | Deck pull lists; JSON/CSV import/export |
| `src/ui/collection/` | Collection page (sidebar, group/box views), dialogs, history, data page, sync banner, demo |
| `src/ui/social/`, `src/core/social.ts` | Friends, requests, trades, wants, who has it |
| `supabase/migrations/`, `supabase/functions/fetch-deck/` | Schema + RLS + RPCs; deck-page fetcher (deployed as `fetch-deck`) |
| `supabase/sql.test.ts`, `supabase/store.test.ts` | Real SQL in PGlite (permissions, apply_ops parity, social, offline store) |

**Checking work:** `npm test` (80 tests), `npm run typecheck`, `npm run lint` (a few known warnings),
`BASE_PATH=/chaos-catalog/ npm run build`. Screens without signing in: `npm run dev`, then `?view=demo` (dev-only
sample collection, never in the live build). Browser checks used Playwright from `~/.claude/tools/.venv` (screenshots
under /tmp, deleted after). Local data: `TCGCSV_FETCH=false npx tsx scripts/build-data.ts --previous
https://brandongeren.github.io/chaos-catalog/data` (reuses the published prices and product cache, no TCGCSV calls).

**Decisions made with the user after the original plan** (details in the sections below):
- Home page is the collection when signed in. "Only my cards" sits left of Advanced in the search bar.
- Sub-groups (any depth; share the order with cards in ordered groups). Rows display as "Row N".
- Notes on copies (misprint, signed). "Copies here" sets a stack's count in Edit.
- Availability: none / borrow / trade / both; defaults per account, box and group; bulk set per group or box.
- Prices shown in the Collection tab (per copy, line, group, box, total).
- Search: old names (`beta_name`) and TCGplayer names are searchable ("aka"); archetype members listed after name
  matches; "did you mean" when an exact search finds nothing; overframe/alt-art printings are separate.
- Duelingbook links are not supported (Turnstile); paste its .ydk/ydke export.
- Card artwork: not built (needs a hosting decision, ~380 MB).

**Open / watch next:**
- Did GitHub's schedule fire? (The first day's 21:17 UTC run never started; a backup 03:47 UTC slot was added. Check
  Actions for "schedule" runs.) If unreliable: a Supabase pg_cron job calling workflow_dispatch with a repo-scoped
  token (needs the user's token; not set up). GitHub also stops schedules after 60 days without commits.
- Overframe prices appear separately from the next daily price run on.
- The user should click **Fix** on the "New" rarity banner in the Collection tab (Cyberse Code Magician MAMO-EN017).
- Camera scanning accuracy on real photos is untested (needs photos from the user).
- Search speed on a phone with fuzzy on was never measured.
- Free-tier usage was fine on 2026-10-27 (§16); egress fix depends on 0008.

---

## 1. Goals and non-goals

**Goals**
- Find any card fast: search the full card database or only your collection, and see every location holding a copy.
- Place, move, split and merge cards between boxes, rows and groups, one at a time or in bulk.
- Model real play: pull a decklist's cards out of storage into a deck, then later take the deck apart, putting cards
  back anywhere, from any past change.
- Import and export decks in every common format; import and export collections as JSON and CSV.
- Share read-only; only the owner edits. Invite-only accounts, friends, city-based "who has it", borrow and trade.
- Prices in USD, with a "movers" view over the last 28 days.
- Add cards by camera, several per photo, with a confirm list.
- Built so another card game can be added later without rewriting the core.

**Non-goals (decided)**
- No undo/redo. History is for viewing and for re-adding cards; moving things should simply be easy.
- No deck legality checks (banlist, Genesys cap). Users build decks elsewhere; a deck is a name plus cards.
- No price history beyond 28 days.
- No full-size photos. Everything is stored as a thumbnail.
- English card data only for now (each copy can still record its language).

---

## 2. Architecture

```
            GitHub Actions (daily cron)                  Supabase (free)
   YGOPRODeck API ──► build catalog + prices ──┐       ┌─ Postgres: profiles, boxes, groups, stacks,
                                               │       │  operations (history), friends, wants, requests
                                               ▼       │  Row Level Security: owner writes, others read
   Browser / installed app  ◄── static files on GitHub Pages
   (React + TypeScript)        catalog.json.gz, prices.json.gz, movers.json.gz
     ├─ IndexedDB: catalog cache, collection cache, pending operation queue
     ├─ search runs on the device
     └─ talks to Supabase for login, collection reads and writes, photos, deck-link fetches
                                                       └─ Storage: box/group thumbnails
                                                       └─ Edge Function: fetch Konami/Neuron deck pages
```

| Piece | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite, installable web app (PWA) | Largest ecosystem; one codebase for phone and desktop |
| Hosting | GitHub Pages (`<user>.github.io/<repo>`) | Free; deployed by GitHub Actions |
| Backend | Supabase free tier | Postgres, invite-only auth, Row Level Security, 1 GB storage, Edge Functions |
| Card data and prices | GitHub Actions daily job, output as static files | No database space or reads used; search works offline |
| Local storage | IndexedDB (via Dexie) | localStorage holds only ~5 MB |
| Fuzzy search | MiniSearch or Fuse.js (pick after a speed test on ~14k cards) | Runs on the device |
| Card detection and OCR | OpenCV.js (find cards) + Tesseract.js (read set codes) | Free, runs on the device |

**Free-tier fit**
- Collection: 70k cards as stacks, around 30k rows of ~300 bytes ≈ 10 MB. History adds ~300 bytes per change.
  Supabase's 500 MB database cap is far away.
- Thumbnails: ~400 px, ~25 KB each; 1 GB ≈ 40,000 photos.
- Prices: 28 daily files of ~1 MB compressed, kept as static files, not in the database.
- Supabase pauses a project after 7 days with no activity. The daily GitHub job pings it to keep it awake.

---

## 3. Multi-game design

The core (collections, locations, history, social, sync) knows nothing about Yu-Gi-Oh. Each game is an **adapter**:

| Adapter supplies | Yu-Gi-Oh |
|---|---|
| Catalog builder (job) | YGOPRODeck API → compact catalog |
| Card key | `ygo:<passcode>` (YGOPRODeck id) |
| Printing key | set code + rarity, e.g. `LOB-EN001/UR` |
| Search fields, filters, sort options, syntax keywords | type, attribute, ATK, DEF, level, rank, link rating, Genesys points, ... |
| Deck sections | Main, Extra, Side |
| Deck formats | ydk, ydke, Omega, YGOPRODeck, Neuron, text |
| Scan pattern | set-code regex `[A-Z0-9]{2,5}-[A-Z]{2}\d{3}` |
| Price source | YGOPRODeck per-printing price |

Every collection row stores `game` plus the card key, so a second game is a new adapter and catalog file, not a schema
change.

---

## 4. Data model (Supabase / Postgres)

Every user-owned table has `owner_id`. Row Level Security: the **owner** can read and write; anyone else can read only
what the owner's profile allows (section 9).

### Accounts and social
- **profiles**: `user_id`, `username`, `display_name`, `city` (city only, no address), visibility settings
  (`profile_public`, `show_locations`, `show_prices`), default `group_ordered`.
- **invites**: `code`, `created_by`, `used_by`, `expires_at`. Only the admin (you) creates invite links.
- **friendships**: `user_a`, `user_b`, `status` (pending / accepted).

### Locations
- **boxes**: `id`, `name`, `photo_path?`, `notes?`, `sort_order`.
- **groups**: `id`, `box_id?` (null = stands alone, e.g. a binder or deck box), `row_label?` (a plain label inside the
  box), `name`, `kind`, `ordered` (defaults from the profile setting), `photo_path?`, `sort_order`.
  - `parent_id?`, `position?` (added 2026-10-26, `0006_subgroups.sql`): **sub-groups**. A group can sit inside another
    group, any depth, and hold cards and sub-groups at once. Sub-groups share their top group's box (moving a group
    moves its sub-groups); in an ordered parent, cards and sub-groups share one order (↑/↓). No loops (app check plus
    a database trigger); a group with sub-groups can't be deleted. CSV writes nested groups as "Binder › Page 1".
  - `kind = storage`: an ordinary group.
  - `kind = deck`: a deck. Its stacks carry a section (main / extra / side).
  - `kind = holding`: a "purgatory" in-between area. Each user starts with one and can add and name more.
  - `kind = lent`: system area for cards lent out (one per user).

### Cards
- **stacks**: identical copies in one place, with a quantity.
  - `id`, `group_id`, `game`, `card_key` or `custom_card_id`, `qty`
  - optional details: `set_code?`, `rarity?`, `edition?` (1st / Unlimited / Limited), `language` (default `en`),
    `condition?` (NM / LP / MP / HP / Damaged), `note` (free text, e.g. misprint or signed; added 2026-10-26, `0005_notes.sql`)
  - `section?` (deck groups only), `position?` (ordered groups only)
  - `availability`: none / borrow / trade
  - loans: `lent_to_user?`, `lent_to_name?` (for non-users), `lent_due?`, `lent_from_group?`
  - **Merge rule:** two stacks merge only when every detail field matches exactly (unknown stays separate from
    known). Splitting takes N copies off into a new stack with the same details.
  - Details stay with the copy wherever it moves.
- **custom_cards**: blank cards the user fills in (proxy, token, another game's card, ...): `id`, `name`, free-form
  `fields` (JSON), `notes`.
- **wants**: standing wants list: `game`, `card_key`, `qty`, optional preferred details.

### How changes are applied (built 2026-10-26)
- The app builds every change as one **op** with a `Draft` (`src/core/collection/model.ts`): it edits a working copy
  and lists every row it touched with the **version** it saw, plus the full new rows and the deleted ids.
- The server's `apply_ops()` (security definer) checks each version, applies the rows with `owner_id = auth.uid()`
  forced, bumps versions, and logs the op. A version mismatch rejects the op (no silent overwrite); a repeated
  `client_op_id` is a no-op (safe retries). The app applies the same op locally first (`applyOp`), so the screen updates
  at once; on a rejection it reloads. Tests run the real SQL in PGlite and check both sides produce identical rows.
- There are **no** insert/update/delete policies: direct table writes are impossible; reads go through RLS.
- **Merging:** adding or moving copies into an **unordered** group merges them into an identical stack (same card and
  every detail, availability and loan field). **Ordered** groups never auto-merge: new stacks go at the end, and the
  group view offers Split, Merge (identical neighbours) and ↑/↓ reordering.
- Deck sections are set when cards enter a deck group (Extra for Fusion/Synchro/Xyz/Link, else Main) and cleared when
  they leave.
- **Sign-up:** a trigger on `auth.users` consumes an unused, unexpired invite code or fails the sign-up. Admins (set by
  hand: `profiles.is_admin`) create invite links in the app. The very first invite is inserted in the SQL editor.
- **Photos:** public `photos` bucket, owner-only uploads into `<user id>/`, 200 KB cap, thumbnails made on the device.
  A photo's URL is unguessable but works for anyone who has it, even if the profile is later made private.

### History and sync
- **operations**: the single source of history **and** the offline queue.
  - `id`, `client_op_id` (UUID made on the device, so a retry is never applied twice), `batch_id`, `device`,
    `created_at`, `type`, `payload`, `status` (applied / rejected), `reject_reason?`
  - types: `add`, `remove`, `move`, `split`, `merge`, `edit_details`, `lend`, `return`, box/group create, rename and
    delete, `bulk` (a list of the above that succeeds or fails as a whole).
  - Each op is applied by one Postgres function (RPC) that checks ownership and preconditions (e.g. "Group 3 still has
    ≥1 Ash Blossom with these details") inside a transaction.
- **requests**: borrow and trade requests between users: `from_user`, `to_user`, `stack_id`, `type`, `qty`,
  `message`, `status`.

---

## 5. Search

Runs on the device over the cached catalog, with a toggle for **all cards** vs **my collection** (and "include OCG-only
cards", off by default).

- **Basic bar:** name search with a **fuzzy** toggle.
- **Advanced panel** (collapsed by default, so the filters don't crowd the page): card type and subtype, attribute,
  monster type, level, rank, link rating and arrows, pendulum scale, ATK and DEF ranges, Genesys points, TCG release
  date range, archetype, set, card text, TCG banlist status, related cards; in collection mode also rarity, condition,
  edition, language, availability, location.
- **Related cards:** cards sharing YGOPRODeck's `archetype` field, plus **mentions in both directions** (cards whose text names this card, and cards
  this card's text names). The daily job builds the mentions index from quoted names in card text.
- **Sort:** TCG release date, name, ATK, DEF, level/rank, Genesys points, price, quantity owned.
- **Syntax mode** (Scryfall-style), with a guide page (`?view=syntax`). Built 2026-10-26 in `syntax.ts`; it parses
  into the same query as the filter panel. AND across keywords, commas mean "any of" within one. Draft keywords were: `t:effect a:dark atk>=2500 lv:4 r:4 link:3
  arch:"blue-eyes" o:"draw" gp>0 set:LOB rar:ur cond:nm in:box:"Box 3" avail:trade mentions:"Dark Magician"`.
  No Yu-Gi-Oh parser like this seems to exist, so we write our own, borrowing ideas from open-source Magic tools.
- **Name search also covers** (2026-10-26): earlier names of renamed cards (YGOPRODeck `beta_name`, e.g. Kinetic Soldier
  → Cipher Soldier, Frog the Jam → Slime Toad; 3,203 cards) and TCGplayer's English name when it differs; such
  results say "aka …". Cards whose **archetype** matches the words come after the name matches (Artmage → Nervedo the
  Shadebeast Power Patron), marked "<archetype> archetype". The card page lists "Also known as".
- **Results:** each card lists every location holding it (box → row → group, quantity, details), with inline
  **Add**, **Move** and **Split** actions.

---

## 6. Collection management

- Browse boxes → rows → groups with thumbnails; a Notion-like layout (sidebar tree, clean lists).
  As built (2026-10-26): each box is a rounded card with its total; rows are dashed bands labelled "Row N" (a bare
  label like "2" is shown as "Row 2", also in location paths); groups are pills with a count badge; sub-groups are
  indented under their group. On phones, picking a box or group scrolls down to it.
- **Edit copies:** "Copies here" sets a stack's count (more = copies added with the same details, fewer = taken
  out; both in History); "apply detail changes to N" splits off only some copies. Details are only touched if they
  changed, so an ordered group doesn't split identical copies.
- Create, rename and delete boxes and groups; set `ordered` per group; drag to reorder in ordered groups.
- **Bulk actions:** multi-select stacks or whole groups → move to a group, move groups to another box, send to a holding
  area, mark availability, edit details, remove.
- **History view:** a timeline of operations, filterable by date, card, group and batch. You can **select some cards from
  any past change** (even ones removed days ago) and add them to any group: this is how you take a deck apart and file
  the cards away.
- **Placement suggestions** (built 2026-10-26, `0004_capacity.sql`): storage groups may have a capacity; the add
  dialog offers the emptiest groups with room for the quantity being added.

---

## 7. Decks

- A deck is a group with `kind = deck`: a name plus Main, Extra and Side sections. No legality checks.
- **Import** (paste, file or link): `.ydk`, `ydke://`, YGO Omega code, YGOPRODeck deck link, Konami database /
  Neuron link (`neuron.konami.net/link/...` redirects to a `db.yugioh-card.com` deck page; card ids map through
  YGOPRODeck's `konami_id`), plain text (`3 Ash Blossom & Joyous Spring`).
  Konami and YGOPRODeck deck pages are fetched by a Supabase Edge Function, since the browser can't read them directly.
  It only accepts those hosts. (`.xml` decks skipped for now, 2026-10-26.)
- **Pull list** for an imported deck: for each card, the locations to take it from. User-set preferences (fewest
  stops, lowest value first, worst condition first, prefer a box); with no preferences set, list every location.
  "Pull" moves the chosen copies into the deck group as one batch.
- **Missing cards:** shows what you lack, then **who has it**: friends, and users in the same city, with
  borrow/trade availability. One tap builds an **LF list**, copied to the clipboard:
  ```
  LF:
  3x Ash Blossom & Joyous Spring
  1x Called by the Grave
  ```
  The LF list can also come from the wants list.
- **Export** any deck as `.ydk`, `ydke://` or text.

---

## 8. Import and export of collections

- **JSON:** full fidelity (boxes, groups, stacks, details, custom cards, wants). Import works as a restore or a merge.
- **CSV:** one row per stack (card name, card key, set code, rarity, edition, language, condition, qty, box, row,
  group, availability). Import maps columns and shows a preview before applying.

---

## 9. Users, sharing and permissions

- **Invite-only sign-up:** you create invite links; each link is single-use and expires.
- **Public read-only:** anyone with the link can view a public profile and collection; nobody but the owner can change
  it. This is enforced by Row Level Security in the database, not just hidden in the interface.
- **Profile privacy:** public or private profile; hide locations; hide prices.
- **Friends:** request and accept.
- **"Who has it":** checks friends **and** users with the same city, even if they're not friends, but only cards they
  marked available, and only if their profile allows it.
- **Borrow and trade:**
  - Marking: none / available to borrow / available to trade / **both** (2026-10-26, `0008`), per stack; both counts
    for "who has it" and for trade matches.
  - **Defaults** (2026-10-26, `0007_availability_defaults.sql`): account default (Account), optional box and group
    defaults (box/group settings). New cards take the nearest: group, parent groups, box, account, else none. Cards
    already in the collection keep theirs, also when moved.
  - **Bulk:** ticked cards in a group (bulk bar), or everything in a group with its sub-groups / a whole box
    ("Borrow / trade…"), optionally also setting that group's default.
  - In-app request flow between users (request → accept/decline → the lend or transfer is recorded on both sides).
  - Lending to someone who isn't a user: record a name and optional due date; the cards move to the "Lent out" area and
    return to their old group (or one you pick).
- **Trade matching:** your wants vs. other users' trade-available cards, and the reverse, for friends and locals.

---

### Social rules (built 2026-10-26, `0003_social.sql`)
- Friends can read each other's collections even when a profile is private.
- **Who has it** / **trade matches**: friends (all copies, availability shown) and same-city users with a public
  profile (only copies marked borrow/trade). Lent-out copies never count. City match is case-insensitive.
- Requests go only to friends or locals; the recipient accepts/declines/marks done, the sender cancels. Accepting
  doesn't move cards: the owner records the hand-over with Lend (loan) or Remove (trade).
- Wants are a plain owner-writable table (no versions needed); visible like the collection.

### Decks and files (built 2026-10-26)
- Deck import detects the format from what's pasted. Links (YGOPRODeck, Neuron/Konami) go through the `fetch-deck`
  Edge Function, which only fetches those hosts (redirects included), max 2 MB; the app parses the HTML. Verified on
  the two sample Neuron decks (42/15/15, 40/15/15) and a YGOPRODeck deck (45/15/15), all cards matched.
- Pull strategies: list only (default), fewest stops, cheapest first, most played (worst condition) first, prefer a
  box. Copies already in the target deck count; lent-out copies are skipped; the same copy is never used twice.
- Collection JSON is a full backup; imports always create new ids and go in chunks of 400 stacks per op. CSV is one
  row per stack; boxes/groups are matched by name or created; custom cards aren't re-imported from CSV.

## 10. Prices

- Source: TCGplayer market prices (USD) per printing and edition, via TCGCSV (§16). A card's own price is its cheapest
  printing, falling back to YGOPRODeck's lowest TCGplayer price.
- The daily job saves today's snapshot and keeps the **last 28 days**, removing the oldest each day.
- **Movers page:** your cards (or all cards) ranked by change vs 7, 14, 21 or 28 days ago, rising or falling, with a
  **$ / %** toggle and a minimum price (default $1) so tiny prices don't dominate the % view. Collection value uses the
  exact printing and edition when recorded, else the printing's cheapest edition, else the card's cheapest printing.
- Collection value totals per box, group and deck (hidden for viewers if the owner turned prices off). Built
  2026-10-26: the Collection tab shows each stack's price per copy and line total, group/box values (including
  sub-groups) and the collection total in the sidebar.

---

## 11. Offline and sync

- Every change is an **operation**. The app writes it to the IndexedDB queue, updates the screen, and sends it to the
  server right away.
- With no connection, operations wait in the queue; a banner says "N changes not synced". On reconnect they are sent in
  order.
- If the server rejects one (e.g. the card was moved on another device meanwhile), a **conflict screen** shows it with
  options: apply to a different stack, skip, or edit.
- The full collection is cached locally for fast loads and read-only offline use.
- **iOS caveat:** Safari may delete site data after ~7 days of not using the site unless the app is installed to the
  home screen. The app will suggest installing it.
- Built online-first in the early phases; the queue and conflict screen come in a later phase. Using operations from
  day one keeps that step small.

---

### As built (2026-10-26)
- `CollectionStore` keeps `base` (last server-confirmed copy) and a `queue` of unconfirmed ops, both in IndexedDB;
  the screen shows base + queue. Ops are sent at once, in batches of 20, in order; offline they wait and are sent on
  the browser's `online` event or every 30 s. A rejected op becomes a **conflict** (shown in a banner with its summary;
  nothing is overwritten); the store reloads and re-checks the rest of the queue, moving any that no longer fit to
  conflicts too. Tested against the real SQL in PGlite with a fake client that goes offline (`supabase/store.test.ts`).
- A service worker caches the app shell (HTML, hashed assets, icons) so the installed app opens offline; card data
  and collections come from IndexedDB, so the worker leaves `data/` and API calls alone.

## 12. Camera scanning

1. Take or upload a photo of several cards laid out flat.
2. OpenCV.js finds the card rectangles and straightens each one.
3. Tesseract.js reads the set code area; the set code is matched against the catalog's printings. That identifies the
   card, set and language; rarity can be picked from that printing's rarities.
4. **Confirm list:** one row per detected card, each with a ticked checkbox (approved). Untick a row to enter that card
   by hand instead. Pick a target group, then add.

Paid recognition services were checked and ruled out: Delver Lens has no API; Nyckel's Yu-Gi-Oh model only returns a
card category (100 free calls a month, then paid). Risk: foils, glare and small text. Test on real photos early.

---

### As built (2026-10-26)
- No separate card-detection step: Tesseract.js reads the whole (upscaled, high-contrast grey) photo with a
  whitelist of A–Z, 0–9 and "-", and every word that turns into a **set code that exists in the catalog** is one
  card. Letter/digit confusions are fixed only in the number part (O→0, S→5, …); a missing dash and words split at the
  dash are handled. 8-digit passcodes count only beyond the copies already found by set code (foil glare fallback).
- Tesseract's engine and English data are downloaded by the browser on first scan (from its CDN); photos never leave
  the device. Synthetic check (rendered 9 px codes): 3 of 4 codes read, no false matches. Real photos still to test.

## 13. Look and feel

- **Home page** (decided 2026-10-26): your collection when signed in, search otherwise. Collection is the first tab.
- Follows the device's light/dark setting.
- Search: Scryfall-clean, with YGOPRODeck/Neuron-level filtering behind "Advanced".
- Deck and collection views: Moxfield-like, adapted to Yu-Gi-Oh (Main/Extra/Side).
- Management screens: Notion-like.
- Card artwork: optional later phase. YGOPRODeck forbids loading its images directly, so they'd have to be downloaded
  once and hosted ourselves (measured: ≈380 MB for every card's small image).

---

## 14. Build phases

| Phase | Delivers | Status |
|---|---|---|
| 0. Setup | Repo, GitHub Pages deploy, Supabase project, daily catalog job | done 2026-10-26 |
| 1. Search | Catalog search for everyone (no login): fuzzy, filters, sorts, related cards | done 2026-10-26 |
| 2. Collection core | Login, boxes/rows/groups, add/move/split/merge, details, operations log, history view, public read-only | built 2026-10-26; needs the migrations applied |
| 3. Bulk and decks | Multi-select bulk actions, holding areas, deck groups, re-add from history | built 2026-10-26 |
| 4. Deck formats | Import (all formats incl. Neuron), pull list, missing cards, LF list, export | built 2026-10-26; links need the fetch-deck function deployed |
| 5. Collection files | JSON and CSV import/export | built 2026-10-26 |
| 6. Social | Invites, profiles, city, privacy, friends, availability, who-has-it, requests, lending, wants, trade matching | built 2026-10-26; needs migration 0003 |
| 7. Prices | Daily price files, values, movers page | built 2026-10-26 |
| 8. Offline | Operation queue, conflict screen | built 2026-10-26 |
| 9. Scanning | Camera, card detection, OCR, confirm list | built 2026-10-26; accuracy on real photos untested |
| 10. Extras | Syntax search mode and guide, placement suggestions, card artwork | syntax + guide and placement built 2026-10-26; artwork not started (needs a hosting decision, §13) |

Syntax search could move earlier (after phase 1) if you want it sooner.

---

## 15. Verified facts (2026-10-26)

- **Catalog:** 14,645 cards, 44,613 printings, DB version 147.60. `cardinfo.php?format=genesys&misc=yes` returns
  **every** card (same 14,645) with `misc_info.genesys_points` (750 nonzero), so one request a day covers cards, sets,
  prices and Genesys points. 509 cards have no TCG date (OCG-only); 236 have no `konami_id`.
- **Sizes:** search catalog (name, text, stats, archetype) ≈ 8.1 MB raw / **1.3 MB gzipped**; per-printing price map
  ≈ 1.0 MB raw / **0.22 MB gzipped** per day, so 28 days ≈ 6 MB.
- **Card artwork:** small images measured at ~25–29 KB each, so **≈ 380 MB** for every card. Fits on GitHub Pages
  (1 GB site limit) or Cloudflare R2 (10 GB free).
- **Mentions index:** quoted names in card text resolve to 3,418 links across 2,562 cards (e.g. 62 cards mention "Dark
  Magician"). The quoted strings that don't match a card are mostly archetype names (e.g. "Dragonmaid"), which can link
  to the archetype instead, plus some parsing noise to filter out.
- **Alternate-art passcodes:** 125 cards have alternate artworks with their own passcodes (172 in all), listed in
  `card_images`. YGOPRODeck's bulk list sometimes returns an alternate as the card's `id` (Dark Magician: 46986420,
  not 46986414), so the catalog keeps all of them (`alt`) and every lookup accepts any of them.
- **ATK/DEF "?"** are stored as -1 (96 cards); shown as "?" and ignored by number filters.
- **Printing keys:** `<passcode>|<set code>|<rarity name>`. YGOPRODeck lists a few set codes on two different cards
  (e.g. BLCR-EN015 on two Crystal Beasts), and some rarities have no rarity code, so neither set code alone nor
  set code + rarity code is unique. Set names contain HTML entities (`&apos;`), decoded by the builder.
- **Deck formats:**
  - `ydke://`: three base64 sections separated by `!` (main, extra, side), each an array of little-endian uint32
    passcodes. Decoded the reference example correctly. (`ydke.js` from Project Ignis is LGPL; we'll write our own
    ~20-line version.)
  - **YGO Omega code:** base64 → raw deflate → byte 0 = main+extra count, byte 1 = side count, then little-endian uint32
    passcodes (main and extra together, then side; split main and extra by card type). Checked against **79 of 79** codes
    with matching `.ydk` files from a public Omega deck backup (`K1TT5UN3/YGO-Deck-Backup`). Omega also exports `.ydk`
    (`#Created by YGO Omega`, plus a `#tags=` line).
  - **YGOPRODeck deck links** (`ygoprodeck.com/deck/<slug>-<number>`): the page contains `maindeckjs`, `extradeckjs`
    and `sidedeckjs` JSON arrays of passcodes. The `getDecks.php` API ignores deck-id filters, so we read the page
    (through the Edge Function).
  - **Konami / Neuron links:** `neuron.konami.net/link/<code>` redirects (302) to a `db.yugioh-card.com` deck page. Each
    card row carries a hidden `cid` input, the name and a `cards_num_set` count, inside `detailtext_main`,
    `detailtext_ext` and `detailtext_side` sections. A prototype parser got 42/15/15 and 40/15/15 on the two sample
    decks, and **every** cid matched YGOPRODeck's `konami_id`.

- **Duelingbook links: not supported (checked 2026-10-26).** Its deck page loads the list from
  `php-scripts/load-deck.php` only with a Cloudflare Turnstile (anti-bot) token, so a server can't fetch it without
  defeating that check. Users export from Duelingbook (.ydk file or ydke:// text) and paste or upload that instead.
- **Live checks 2026-10-26:** YGOPRODeck link (45/15/15), Neuron link (42/15/15), .ydk file and ydke:// all import on
  the deployed site.

- **GitHub schedules are best effort (2026-10-26):** the first day's 21:17 UTC run never started (0 scheduled runs
  2+ hours later; started by hand instead). The workflow now has a second slot (03:47 UTC); the once-a-day TCGCSV guard
  makes the extra run harmless. GitHub also disables schedules on public repos after 60 days without commits, which
  would stop the data updates and the Supabase keep-awake ping. The site shows a notice when data is over 3 days old.

- **Missing TCG dates (2026-10-26):** 27 cards had no TCG date and no English printing in YGOPRODeck, though TCGplayer
  lists them (e.g. Artmage Pact -Awakening-, DUAD-EN075), so they were hidden as OCG-only. The builder now dates such
  cards from their printings' sets (YGOPRODeck `cardsets.php` `tcg_date`, matched by set code prefix).

- **Different English names (2026-10-26):** YGOPRODeck sometimes uses its own translation (Layer 19: "Preventing the
  Invasion! …" vs the TCG's Layer 19 "Sudden Incursion! …"), and older TCG printings used other names (Kinetic Soldier
  = Cipher Soldier). TCGplayer products now also match on the title before a quote/colon when exactly one card has it,
  and TCGplayer's name is kept as an alternate name (`an`) that search covers. Language suffixes like
  `(German) - "…"` are stripped first. Search shows close matches when an exact name search finds nothing.

- **Art variants and placeholders (2026-10-26):** TCGplayer lists overframe/extended-art, alternate-art and new-art
  versions under the same set code and rarity as the plain card (MAMO-EN017 Ultra Rare and "(Extended Art)"), and
  YGOPRODeck often has only a placeholder rarity "New" for them. A variant now becomes its own printing, e.g.
  "Ultra Rare (Overframe)", with its own price, **when TCGplayer also lists the plain version**; when only the variant
  is listed (MAMO-EN017 Starlight Rare), that listing is the printing. Placeholder rarities ("New", bare numbers) are
  dropped where the same set code has real ones (195 dropped, 86 variants split).

- **Placeholder repair (2026-10-26):** stacks saved with a placeholder rarity ("New") get a one-click fix in the
  Collection tab when that set code now has exactly one printing YGOPRODeck didn't list (the one "New" stood for);
  otherwise the banner lists them for a manual Edit.

- **Free-tier usage (checked 2026-10-26):** GitHub (public repo): Actions minutes unlimited; Pages site 13 MB of 1 GB
  (≈100 MB once 28 price days are kept); bandwidth ≈3 MB per device per day. Supabase: the database stays far under
  500 MB even at 70k cards (≈20 MB). **Egress (5 GB/month) was the risk**: every app open re-downloaded the whole
  collection (≈15–20 MB at 70k cards). Since `0008`, `apply_ops()` returns op ids and the store skips the download
  when the newest history entry is one its copy already includes (own changes are checked to be the only ones in
  between). Read-only views of other people's collections still download fully (their history is private).

## 16. Still open

- OCR accuracy on real photos (foils, lighting, several cards per photo). **Tabled** until phase 9; needs sample photos.
- **Prices (decided 2026-10-26): TCGCSV**, a free daily mirror of TCGplayer (YuGiOh = category 2, 659 sets). Market
  price per printing **and edition** (1st / Unlimited / Limited). YGOPRODeck's `set_price` was zero for 72% of printings
  and stale elsewhere (DUDE-EN003 Ash Blossom $31.50 there vs $4.24 market on TCGplayer). YuGiOhPrices.com is gone (its
  domain has no address records and parked nameservers). Products are matched to cards by set code + rarity, then set
  code alone, then unique name: 99% matched in a 40-set test (4,771 exact, 564 by set code, 119 by name; the 41 left are
  promo tokens, which users can add as custom cards). 667 TCGplayer-only printings (e.g. Prismatic Collector's Rare)
  are added to the catalog. TCGCSV's daily archive is offline, so a full run is ~660 price requests plus product lists
  for changed sets, about 3 minutes at TCGCSV's suggested pace.
- Search speed on a phone with ~14.6k cards and fuzzy matching on (test in phase 1).
- A scheduler that doesn't depend on GitHub's (e.g. Supabase pg_cron calling the workflow_dispatch API with a
  repo-scoped token), if the GitHub schedule proves unreliable or the 60-day rule becomes a problem.
