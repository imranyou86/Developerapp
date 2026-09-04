# The Developer

A construction project management app for a home developer managing multiple
builds. Organizes each construction around its architect's plan: rooms,
tasks, budget, finishes, payment schedules, and a rough/finish inspection
checklist.

## Stack

- **Frontend:** Next.js 14 (App Router), Tailwind CSS
- **Backend/DB:** Supabase — Postgres, Auth, and Storage
- **AI features:** Anthropic API (Claude), called only from Next.js API
  routes (`app/api/claude/*`), never from the client
- **PDF handling:** pdf.js in the browser renders every page of an uploaded
  plan or bid PDF to an image/text before upload

## Setup

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql). It
   creates every table, row-level-security policy (scoped to
   `auth.uid()`), and the four storage buckets the app uses (`plan-pages`,
   `rendering-photos`, `checklist-photos`, `bid-files`).
3. Under **Authentication → Providers**, email/password and magic-link sign
   in are enabled by default — no extra setup needed. Add your production
   URL under **Authentication → URL Configuration** once deployed so
   confirmation/magic-link emails redirect correctly.

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=        # Project Settings -> API -> Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Project Settings -> API -> anon public key
SUPABASE_SERVICE_ROLE_KEY=       # Project Settings -> API -> service_role key
ANTHROPIC_API_KEY=               # console.anthropic.com -> API keys
RENTCAST_API_KEY=                # rentcast.io -> API keys (Buyers Guide only)
OPENAI_API_KEY=                  # platform.openai.com -> API keys (optional, Rooms tab image generation only)
```

`ANTHROPIC_API_KEY`, `RENTCAST_API_KEY`, and `OPENAI_API_KEY` are server-only
and must never be exposed with a `NEXT_PUBLIC_` prefix — they're read only
inside `app/api/*` routes. `RENTCAST_API_KEY` is only needed for the Buyers
Guide tab (ZIP search + comps/value estimates); `OPENAI_API_KEY` is only
needed for the Rooms tab's "Generate image (AI)" button — the rest of the
app works without either.

### 3. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, create an account, and start a construction.

### 4. Deploy

Push to a Git repo and import it into [Vercel](https://vercel.com). Add the
same environment variables under Project Settings → Environment Variables,
then deploy.

## Data model

See [`supabase/schema.sql`](./supabase/schema.sql) for the authoritative
schema — this is what a **fresh** Supabase project should run. Every table
is scoped back to `auth.uid()` through row-level security (via `user_id`
directly, or via a join up to a `projects`/`deals` row that has one), so
each developer only ever sees their own data — this is what makes the app
safe to use across multiple devices.

If you already have a live project and schema.sql has grown since you last
ran it, don't re-run the whole file — `CREATE POLICY` isn't idempotent and
will error on anything that already exists. Instead run the numbered files
under [`supabase/migrations/`](./supabase/migrations/) you haven't applied
yet; each one only adds what a given feature needed.

## Feature notes

- **Plan tab** — every page of an uploaded plan PDF is rendered client-side
  (via pdf.js) and stored as its own labeled page in Supabase Storage.
  "Detect rooms from plan" sends every stored page together to Claude in one
  call so floors and ADUs on separate sheets get cross-referenced correctly,
  rather than only reading page 1.
- **Rooms & Tasks tab** — the flat "shoebox" room illustration is built
  entirely client-side from SVG (`lib/illustration.ts`), no AI call needed.
  Claude writes a short design concept plus a concise (40-60 word,
  front-loaded) image-generation prompt — image models follow short concrete
  prompts much better than long descriptive paragraphs. If `OPENAI_API_KEY`
  is set, "Generate image (AI)" calls OpenAI's image API (`lib/openai.ts`)
  with that prompt and uploads the result straight into the rendering,
  replacing the illustration; without that key, copy the same prompt into
  ChatGPT/Midjourney by hand and upload the result instead — the manual path
  always works, the button is a convenience on top of it.
- **Construction Cost tab** — Claude reads every plan page marked "Floor
  plan layout" on the Plan tab and, grounded by a couple of web searches for
  current regional (or national, if no address) construction cost data, picks
  a pricing tier (Low $250-300/sqft, Mid $350-400/sqft, High $450+/sqft) and
  gives both a single "most accurate" predicted total (with a contingency %
  for what the plan can't show) and the tier's range, plus a category cost
  breakdown. The $/sqft numbers are clamped server-side to the chosen tier's
  fixed band rather than trusted verbatim from the model. You can manually
  swap the displayed tier (Low/Mid/High buttons on each estimate) to compare
  — swapping away from the AI-recommended tier falls back to a deterministic
  sqft × fixed-band calculation rather than a second AI call.
- **Payments tab** — bid PDFs are read client-side with pdf.js first; the
  *full* extracted text (not a truncated prefix) is sent to Claude, with the
  section around a detected "Payment Schedule" heading prioritized if the
  document is very long. Scanned/image-only PDFs fall back to sending
  rendered page images instead of text.
- **In-app modals** — `window.prompt()`/`confirm()` are avoided everywhere
  in favor of the `Modal`/`ConfirmDialog` components, since those browser
  APIs are blocked in sandboxed/iframe contexts.
- **Finish ID tab** — upload any photo/screenshot and Claude (vision) identifies
  the finishes shown; a "Find real product match" action per item uses
  Claude's server-side web search tool to ground the guess in a real
  brand/model/price/link before you add it to a room.
- **Sharing** — each construction has a "Share" button that issues a random,
  revocable token for a public `/share/[token]` page — a full read-only
  mirror of the project, no account needed. That page is served by a
  service-role admin client (`lib/supabase/admin.ts`) that looks the token
  up server-side, entirely bypassing RLS for that one path; the browser
  never gets a Supabase key capable of reading other users' data.
- **Buyers Guide tab** (top-level, not per-project) — search homes for sale
  by ZIP via the RentCast API, or paste in a specific listing directly. For a
  specific listing, pasting the URL (Zillow, Redfin, etc.) and clicking
  "Look up listing" fills in the address/price/beds/baths/sqft/lot
  size/year built for review before saving — Claude never fetches the URL
  itself (most listing sites block that), it parses the address out of the
  URL text and grounds the rest with web search, same as
  `lookup-property-details`. Manual entry is still there as a fallback if
  the lookup can't find something. Running an analysis estimates construction cost
  from square footage at an editable $/sqft rate, then uses Claude with web
  search to find comps (recently sold, prioritizing renovated/new-construction
  comps) and estimate the after-repair/rebuild value (ARV). The buy/pass
  verdict and profit margin are computed deterministically from those
  numbers, not left to the model. A pursued deal converts into a real
  construction project with one click. Every Claude web-search tool call in
  this app (Buyers Guide, Finish ID's product match, Construction Cost)
  deliberately uses the **basic** `web_search_20250305` tool type, not the
  newer sandboxed variant — that one took 60-90+ seconds in testing (routes
  searches through a server-side Python sandbox), well past a serverless
  function's timeout.
- **Buyers Guide ground-up rebuild calculator** — the zone field is a
  dropdown of LA (LAMC) residential zones (`lib/laZoning.ts`), with an
  "Other" fallback for anything not listed. "Look up %" grounds a starting
  max-lot-coverage-percentage estimate for the selected zone in a web
  search (`/api/claude/lookup-zoning-coverage`) — verified against the real
  API: R1 correctly comes back medium-confidence with the Baseline
  Hillside/RFA sliding-scale caveat spelled out, while a flat-coverage zone
  like RD1.5 comes back high-confidence. Remodel and ground-up scopes each
  keep their own manually-entered $/sqft and construction budget
  (`costPerSqftByScope`/`budgetByScope`), so switching scope to compare
  them doesn't overwrite whichever number you'd already typed for the
  other one — analysis always runs against whichever scope is currently
  selected.
- **Files tab** — every upload across the app (plan pages, bid files,
  checklist photos, rendering photos, finish scans) is mirrored into a
  `project_files` row by the same server action that saves it
  (`lib/projectFiles.ts`), so the Files tab lists everything in one place
  without querying five different tables at once. It's a convenience index,
  not a second source of truth — deleting the original (from its own tab)
  removes the library row too, and re-uploading (e.g. replacing a rendering
  photo) deletes-then-reinserts rather than piling up stale duplicates. Add
  a note per file, then download individually (proxied through an API route
  so the correct filename survives cross-origin — a plain link to a public
  Supabase Storage URL won't) or select several and download as one zip
  (`jszip`, built in-memory server-side). Files can also be uploaded
  directly from this tab (any file type — contracts, permits, warranties,
  extra photos) and tagged Plan/Bid/Document/Photo; those rows have no
  originating feature-table row (`source_table`/`source_id` are null) and
  can be removed from this tab directly — auto-mirrored files can't, since
  removing them here without touching their source tab would desync the two.
- **Finish ID's product search** — sends the actual scan photo alongside the
  text description to Claude (vision + web search in one call), and is
  explicitly instructed to cross-check each search result's own product
  photos against the real photo rather than matching on the text label
  alone, downgrading or dropping results that don't actually look right.
  Adding a matched product with a price to a room auto-creates a budget line
  for it (`budgeted` = found price, `actual` = 0, linked via
  `budget_items.finish_id`), marked with a "finish" badge on the Budget tab;
  deleting that finish removes the budget line it created.
