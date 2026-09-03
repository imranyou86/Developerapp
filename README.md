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
```

`ANTHROPIC_API_KEY` is server-only and must never be exposed with a
`NEXT_PUBLIC_` prefix — it's read only inside `app/api/claude/*` routes.

### 3. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, create an account, and start a construction.

### 4. Deploy

Push to a Git repo and import it into [Vercel](https://vercel.com). Add the
same four environment variables under Project Settings → Environment
Variables, then deploy.

## Data model

See [`supabase/schema.sql`](./supabase/schema.sql) for the authoritative
schema. Every table is scoped back to `projects.user_id = auth.uid()`
through row-level security, so each developer only ever sees their own
constructions — this is what makes the app safe to use across multiple
devices.

## Feature notes

- **Plan tab** — every page of an uploaded plan PDF is rendered client-side
  (via pdf.js) and stored as its own labeled page in Supabase Storage.
  "Detect rooms from plan" sends every stored page together to Claude in one
  call so floors and ADUs on separate sheets get cross-referenced correctly,
  rather than only reading page 1.
- **Rooms & Tasks tab** — the flat "shoebox" room illustration is built
  entirely client-side from SVG (`lib/illustration.ts`), no AI call needed.
  Claude is only used to write the short design concept and the
  photorealistic image-generation prompt; actually generating a photoreal
  image happens outside the app (ChatGPT, Midjourney, etc.) and the result
  is uploaded back in, replacing the illustration.
- **Payments tab** — bid PDFs are read client-side with pdf.js first; the
  *full* extracted text (not a truncated prefix) is sent to Claude, with the
  section around a detected "Payment Schedule" heading prioritized if the
  document is very long. Scanned/image-only PDFs fall back to sending
  rendered page images instead of text.
- **In-app modals** — `window.prompt()`/`confirm()` are avoided everywhere
  in favor of the `Modal`/`ConfirmDialog` components, since those browser
  APIs are blocked in sandboxed/iframe contexts.
