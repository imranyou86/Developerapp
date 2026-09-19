# Alaia Homes Dev

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
GEMINI_API_KEY=                  # aistudio.google.com/apikey (optional, Rooms/Interior Design/Landscape image generation only)
RESEND_API_KEY=                  # resend.com -> API keys (optional, email alerts only)
ALERT_FROM_EMAIL=                # optional, needs a Resend-verified domain — see .env.example
```

`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are server-only and must never be
exposed with a `NEXT_PUBLIC_` prefix — they're read only inside `app/api/*`
routes. `OPENAI_API_KEY` is only needed for the Rooms tab's "Generate image
(AI)" button; `RESEND_API_KEY`/`ALERT_FROM_EMAIL` only for the "Get alerts"
email feature — the rest of the app works without either.

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

- **Branding: Alaia Homes Dev** — renamed from the original "The Developer"
  placeholder name. The mark shown throughout the app (`components/BrandMark.tsx`)
  is `public/logo.png`, trimmed and resized via `sharp` from the original
  export (`public/AHLOGO.png`, kept around as the full-resolution source in
  case it needs regenerating at a different size). It's shown directly
  against the white header bars rather than inside a colored badge chip
  like the old "TD" text badge was — the mark is black on transparent, so a
  dark chip behind it would kill contrast without recoloring the artwork.
  `app/icon.png`/`app/apple-icon.png` (same source, generated the same way —
  the apple one composited onto a solid white square since iOS renders
  transparency in touch icons poorly) are picked up automatically by
  Next.js's App Router file-based favicon convention, no manual `<link>`
  tags or `metadata.icons` needed.
- **Certificate of Occupancy** (the last per-project tab, `PROJECT_TABS` in
  `lib/permissions.ts`, `certificate-of-occupancy` slug — defaults visible
  to every role including Contractor, since inspection/clearance status is
  field-relevant, not a financial tab). Went through two false starts before
  landing here, both worth knowing about since they explain why the tab
  works the way it does: (1) a Claude web-search call against LADBS's
  "Property Activity Report" tool, same pattern as the Buyers Guide's
  zoning/property-detail lookups — but that tool is an interactive form
  (type an address, click search, results load dynamically), not something
  search-engine-indexed or reachable by a simple fetch, so it came back
  empty every time; (2) embedding that tool directly in an `<iframe>` — but
  LADBS sends headers blocking other sites from framing their page (common
  for city/government sites), so the embed just rendered a blank box. What
  actually ships: a "Search LADBS ↗" button (`LADBS_PLR_URL` in
  `certificate-of-occupancy-client.tsx`) that opens
  `https://www.ladbsservices2.lacity.org/OnlineServices/?service=plr` in a
  new tab. LADBS's search itself has separate House Number and Street Name
  fields rather than one address box, so a single "copy the whole address"
  button wasn't actually usable there either — `splitAddress()`
  (`lib/address.ts`) splits the project's address into a house number and a
  bare street name (no type/suffix, no city/state/zip — "Main", not "Main
  St" or "Main St, Los Angeles"), and each half gets its own copy button,
  so both LADBS fields are one paste away. First cut of this was a
  hand-rolled comma-split regex, which broke on addresses typed without
  commas ("123 Main St Los Angeles CA 90012") by leaking the city straight
  into the "street" half — there's no reliable way to know where a
  multi-word city name ends and truly no comma to split on. Replaced with
  [`parse-address`](https://www.npmjs.com/package/parse-address) (a small,
  well-tested JS port of the long-standing Perl `Geo::StreetAddress::US`
  parser — ambient types for it, since none ship, live in
  `types/parse-address.d.ts`), which handles directional prefixes and USPS
  street types properly regardless of comma placement. Still best-effort
  parsing, not address validation — an address it can't confidently parse
  just comes back with an empty street/number rather than a wrong guess. A
  "Record findings" modal then lets you save what you found there — status, CO
  number, issue date, a growing list of open/remaining clearances, a
  growing list of issued permits, and inspector contact info (phone/email
  render as tap-to-call/email `tel:`/`mailto:` links via the shared
  `lib/phone.ts` helper Subcontractors also uses) — displayed the same
  clean way either way. One row per project
  (`certificate_of_occupancy_checks`, unique on `project_id`, unchanged
  from the first pass) that each save overwrites in place rather than
  accumulating history — this is current status, not a timeline of past
  checks — so it's only ever as current as whoever last recorded it,
  which the tab says outright. If the construction has no address on file
  yet, the tab shows an inline "enter one" field instead — saving it
  writes straight to `projects.address` (via the existing `renameProject`
  action, so it's consistent everywhere else in the app that uses it, not
  a separate one-off address).
- **Subcontractors** (top-level, next to Buyers Guide/Interior Design —
  gated by the same `tab_permissions` matrix, `subcontractors` tab, default
  hidden for Contractor) — a shared directory (`app/subcontractors/`), not
  scoped to a single project, so anyone on the team can look up a vetted
  sub while working any construction. Each entry holds company/contact
  name, trade, phone, email, address, license number + state, free-text
  notes, and two independent tags: **reliability** (1-5 stars) and
  **cost** (1-4 "$" tier, like a Yelp price rating) — both optional until
  someone's actually rated the sub. Trade is a free-text field with a
  `<datalist>` of common trades as autocomplete suggestions, not a locked
  enum, same call as the Rooms tab's style search. The list is searchable
  (company/contact/trade/notes) and filterable by trade (the filter's
  options are derived from whichever trades are actually in the data, not
  a fixed list). RLS (`supabase/migrations/017_subcontractors.sql`) makes
  the whole directory readable by any signed-in user — it's a shared
  resource, unlike the per-user-private `deals` table — but only whoever
  added an entry (`created_by`), or a Developer, can edit or delete it;
  the Edit/Delete buttons themselves are hidden client-side for anyone
  else, matching what RLS would reject anyway. The add/edit form is a
  single reusable modal component that the parent only ever mounts
  conditionally (`{formOpen && <SubcontractorFormModal key={editing?.id ??
  "new"} .../>}`) rather than toggling a persistent instance via an `open`
  prop — giving it a `key` derived from which row (if any) is being edited
  means switching targets, or even just reopening "Add" after cancelling
  a previous attempt, always mounts fresh internal form state instead of
  carrying over whatever was typed and abandoned last time.
  - **Associating a sub with a construction** — a many-to-many
    `project_subcontractors` join table
    (`supabase/migrations/018_project_subcontractors.sql`), since a sub
    works multiple projects and a project uses multiple subs. Deliberately
    scoped by `has_project_access(project_id)` rather than the
    subcontractor row's own `created_by` — any project member can tag "this
    sub is working on my construction" regardless of who originally added
    the sub to the shared directory, since that's really a project-team
    decision, not a directory-ownership one. The add/edit form gets a
    "Projects" checkbox list (scoped to whatever constructions the current
    user can see, same as the Constructions list itself); each card shows
    the resulting associations as "Working on: [project chips]".
    `setSubcontractorProjects` (`app/subcontractors/actions.ts`) replaces a
    sub's links wholesale (delete-then-reinsert) rather than diffing —
    simpler, and still safe under RLS, since the delete step can only ever
    touch rows for projects the caller has access to in the first place, so
    a link to a project they can't see is silently left alone either way.
  - **Tap-to-call/email** — a saved phone number is a `tel:` link (stripped
    to digits + a leading `+`, since that's the most reliably dialable form
    across phone apps regardless of how the number was typed in) and a
    saved email is a `mailto:` link — tapping either on a phone opens the
    dialer or Mail app directly instead of just displaying the text.
  - **"Check CSLB"** — next to the license number/state fields, a button
    (disabled when the license number field is empty) calls
    `/api/subcontractors/check-license`, which fetches California's CSLB
    license detail page server-side for that exact license number and
    fills the **License status** field in-app — no new tab. Unlike LADBS's
    property lookup (see Certificate of Occupancy below, an interactive
    ASP.NET form no AI web search or iframe could drive), CSLB's
    check-license tool serves a direct result for a plain GET request with
    the license number in the query string
    (`https://www2.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=...`),
    so the route fetches that HTML directly and parses it: first for CSLB's
    own summary sentence ("This license is current and active.", etc.),
    falling back to scanning near a "License Status" label for one of
    CSLB's known status words (active, inactive, suspended, revoked,
    expired, cancelled, pending, delinquent, reinstated, deceased). If
    neither pattern matches, it still returns whatever text it found near
    the label so the toast shows that instead of nothing, rather than
    silently failing. This parsing was written from CSLB's publicly
    documented status vocabulary and search results describing the page's
    layout, not a page fetch — this sandbox's network policy blocks
    reaching cslb.ca.gov directly (confirmed via a failed fetch attempt),
    while the deployed app has normal outbound access — so it's expected
    to need one round of adjustment against the real page if CSLB's exact
    markup turns out to differ from what was inferred. `license_status`
    (migration `023_subcontractor_license_status.sql`) is still a plain
    editable text field regardless — a manual correction or an out-of-state
    license (this tool only covers CA) can always be typed in directly.
    Shown on the card as a color-coded badge (sage for "active", red for
    expired/suspended/revoked/inactive, neutral otherwise, matched by a
    simple substring check against the saved text) alongside a "checked
    &lt;date&gt;" stamp (`license_checked_at`, set server-side whenever a
    non-empty status is saved).
- **Design system / motion pass** — the app leaned "industrial and clunky"
  (flat colors, hard edges, everything appearing/disappearing instantly), so
  this pass is a set of small, centralized changes that cascade everywhere
  rather than touching every screen individually:
  - `tailwind.config.ts` adds reusable `animate-fade-in` / `animate-fade-in-up`
    / `animate-scale-in` / `animate-slide-in-right` keyframes and `shadow-soft`
    / `shadow-elevated` tokens — plain CSS, no animation library needed.
  - `app/globals.css`'s shared `.btn`/`.card`/`.input` component classes
    (used by nearly every screen in the app) got snappier transitions: a
    tactile `active:scale-[0.97]` press on every button, a themed focus ring
    (`:focus-visible`) instead of the default browser blue, thin themed
    scrollbars, and a soft default card shadow. A new opt-in `.card-hover`
    (lift + border + shadow on hover, no `cursor-pointer` baked in since not
    every hoverable card is uniformly clickable — e.g. a project card's
    Rename/Delete footer isn't part of its link) is used on the projects grid.
  - `TopNav` and `ProjectTabs` (`components/TopNav.tsx`,
    `app/projects/[id]/project-tabs.tsx`) switched from an underline tab
    strip to an animated filled-pill active state — reads as more
    "app-like" than a flat underline, and the pill transition
    (`transition-all duration-200`) is what makes switching tabs feel snappy
    rather than just an instant color swap.
  - `Modal`/`ConfirmDialog` now fade+scale in (`animate-fade-in` backdrop,
    `animate-scale-in` panel) instead of popping in instantly; `Toast`
    messages slide in from the right (`animate-slide-in-right`) with a
    ✓/⚠ glyph per kind.
  - **`Modal`'s footer used to be unreachable on a long form** — the outer
    card had no height cap, so a form with enough fields (Certificate of
    Occupancy's "Record findings" being the one that surfaced it, with its
    growing clearance/permit lists) could grow taller than the viewport
    with no way to scroll down to the Save/Cancel buttons, especially on a
    short or rotated screen. Fixed once, in the shared component, for
    every modal in the app: the card is now `flex flex-col`, capped at
    `max-h-[90vh]`, with the header and footer `shrink-0` (pinned in
    place) and only the body `overflow-y-auto` (scrolls internally) — the
    footer stays visible and reachable regardless of content length or
    screen size.
  - The **login page** (`app/login/page.tsx`) — the first thing anyone sees
    — got the most direct attention: a soft radial glow plus a faint
    blueprint-grid background (pure CSS, `aria-hidden`/`pointer-events-none`
    since it's decorative), the card and logo mark fade/scale in on load,
    and switching between Sign in/Create account/Magic link re-triggers a
    quick fade on the field block (`key={mode}` on the wrapper forces a
    remount, which restarts the `animate-fade-in` CSS animation) instead of
    the fields just snapping to their new shape.
  - The **projects grid** — the first authenticated screen — gets a
    staggered fade-in-up entrance (`animationDelay` scaled by each card's
    index, capped at 400ms so a long list doesn't drag out the entrance) on
    top of the new `.card-hover` lift.
  - Deliberately did not add a new animation dependency (no Framer Motion) —
    everything here is Tailwind-generated CSS `@keyframes`, which is enough
    for entrance/hover/press polish and keeps bundle size and complexity
    down. Verified with a Playwright screenshot of `/login` in both its
    sign-in and sign-up states (the only page in the app that renders
    without needing a live Supabase session) rather than just eyeballing
    the JSX — the rest of the app's screens require your live Supabase
    project to authenticate into, which this sandboxed session's network
    can't reach, so give the other tabs a look yourself.
- **Design system / motion pass #2** — every feature built after the first
  pass above (Chat, Warranty Request, House Book, Landscape, Finish ID, the
  Bids/Deals/Subcontractors lists, Rooms, Plan, Admin, …) had shipped with
  zero animation — only `/login` and the projects grid used the keyframes
  from pass #1. This pass brought the rest of the app in line, still with
  no new dependency:
  - **A brighter, more saturated palette** — `tailwind.config.ts`'s four
    semantic colors (`blueprint`, `concrete`, `amber`, `sage`) were muted
    navy/beige/terracotta; every one of them is used by name everywhere in
    the app (`bg-blueprint`, `text-amber`, …), so brightening the four hex
    values in one file re-themes every screen at once — no component
    touched a color literal directly. `concrete` (the app's page
    background) went from a dim beige to a near-white, so accent colors
    read with far more contrast against it.
  - **`components/PageTransition.tsx`** — a small client component that
    keys its children by `usePathname()`, forcing a fresh mount (and a
    replayed `animate-fade-in-up`) on every navigation. Needed specifically
    for `app/projects/[id]/layout.tsx`: its `<main>` persists across every
    project tab (Plan, Checklist, Chat, Warranty Request, …), so a plain
    CSS animation class there would only ever play once, on the very first
    tab ever visited — wrapping `{children}` in `PageTransition` instead of
    directly in `<main>` makes every tab switch fade in fresh, without
    remounting the header/nav/providers around it (which would lose
    background-task state; see the Global background-task tracking note).
    Every other top-level page (Buyers Guide, Interior Design, Construction
    Cost, Landscape, Subcontractors, Admin, the constructions list, a deal's
    detail page) is its own route with no shared persistent layout, so
    those just got `animate-fade-in-up` added straight to their `<main>`.
  - **Staggered entrance for every major list/grid** — checklist items,
    warranty items and their inspection reports, subcontractors, incoming
    bids, landscape/interior-design galleries, Finish ID scans and its
    product-match results, Buyers Guide search results and saved deals,
    plan page thumbnails, room cards, admin's user list, and chat messages
    all animate in with `animate-fade-in-up` and a per-index
    `animationDelay` (capped, usually at 300-320ms, so a long list doesn't
    drag the entrance out) — the same pattern pass #1 established for the
    projects grid, just applied everywhere else it was missing. Chat is the
    one exception worth calling out: since messages mount once and never
    remount on re-render, giving every bubble the same class means an
    *incoming* message animates in while every already-mounted one stays
    put — no per-message replay, no needing to track "is this new."
  - **Progress bars now animate their width** (`transition-all
    duration-500`) on Checklist, Warranty Request, and Construction Cost's
    breakdown bars, instead of snapping instantly when an item is
    checked off.
  - Fixed one latent bug surfaced while doing this: a warranty item's
    status `<select>` used `text-sage-700`, which doesn't exist — `sage` is
    a custom token with only `DEFAULT`/`light`/`dark` keys (unlike Tailwind's
    *built-in* `amber`, which still has its full numeric scale sitting
    alongside this app's custom `amber` — that's why `text-amber-700`
    elsewhere in the app was never actually broken). Fixed to `text-sage-dark`.
  - Still no animation library — every transition here is a Tailwind
    `@keyframes` triggered by a class, animating only `opacity`/`transform`
    (compositor-only, GPU-accelerated properties), so none of this adds
    JS execution cost or changes what data gets fetched. Confirmed via a
    full `next build`: per-route bundle sizes moved by low-single-digit KB
    at most (e.g. Warranty Request: 7.03 kB → 7.09 kB) — visual polish
    without a performance trade-off. Verified the palette change with a
    Playwright screenshot of `/login` (the one page reachable without a
    live Supabase session in this sandbox); the rest of the app's screens
    are worth a look in your own browser.
- **Plan tab** — every page of an uploaded plan PDF is rendered client-side
  (via pdf.js) and stored as its own labeled page in Supabase Storage.
  "Detect rooms from plan" sends every stored page together to Claude in one
  call so floors and ADUs on separate sheets get cross-referenced correctly,
  rather than only reading page 1.
- **Rooms & Tasks tab** — the flat "shoebox" room illustration is built
  entirely client-side from SVG (`lib/illustration.ts`), no AI call needed.
  Claude writes a short design concept plus a concise (40-60 word,
  front-loaded) image-generation prompt — image models follow short concrete
  prompts much better than long descriptive paragraphs. If `GEMINI_API_KEY`
  is set, "Generate image (AI)" calls Google's Gemini API (`lib/gemini.ts`)
  with that prompt and uploads the result straight into the rendering,
  replacing the illustration; without that key, copy the same prompt into
  an image tool by hand and upload the result instead — the manual path
  always works, the button is a convenience on top of it.
  - **Style is pure free text, no presets** — style used to be 5 fixed
    preset buttons (`lib/styles.ts`'s `STYLE_PALETTES`), then a free-text
    `<input>` with a `<datalist>` of those same names as autocomplete
    suggestions. Both are gone now — `lib/styles.ts` keeps only the
    `StylePalette` type (still used by `lib/illustration.ts`'s SVG
    placeholder) and a `DEFAULT_PALETTE_COLORS` constant to seed the color
    pickers, with no preset list or suggestion UI left anywhere. `StyleName`
    (`lib/types.ts`) is a plain `string` — DB-side `renderings.style` was
    already unconstrained text, so no migration was needed. The panel is a
    plain free-text style input plus three color pickers (wall/floor/accent)
    that default to `DEFAULT_PALETTE_COLORS` but are fully user-adjustable.
    "+ Add to list" queues a
    `{name, wall, floor, accent}` entry as a removable chip rather than
    generating immediately, so you can line up several styles/colorways
    before committing; "Build design(s) (N)" then generates them one at a
    time (`handleGenerate` now takes the queued entry plus the room state
    threaded through the loop — each generation's `onRoomUpdated` call
    builds on the previous one's result rather than the stale `room` prop,
    which would otherwise make each subsequent queued generation overwrite
    the ones before it in local state).
  - **"View plans" link, next to the dimensions fields.** Room
    width/depth are sometimes hand-entered or AI-estimated from the plan
    and occasionally come out wrong — rather than switching to the Plan
    tab to double-check, `RoomsClient`/`RoomCard` now load that
    construction's layout plan pages (`plan_pages` where `is_layout =
    true`, the same source Interior Design already reads room sizing
    from) and open them in the same `FileViewerModal` used by the Files
    tab (zoom, Prev/Next across pages) right from a "View plans" button —
    one next to "+ Add room" in the header for browsing all pages, and
    one per room next to "Save dimensions" for checking a specific room's
    numbers against the plan without losing your place. An
    AI-estimated room also gets a one-line note under its dimension
    fields suggesting exactly this check. Disabled (with an explanatory
    title) when the project has no plan pages yet.
    `FileViewerModal`/`isImage`/`isPdf` were pulled out of the Files tab
    into a shared `components/FileViewer.tsx` for this — Rooms passes
    plan pages in directly (`downloadUrl` = the public Storage URL, since
    they're always images, never PDFs, and there's no per-project-file
    row id to proxy through), while Files still maps its own
    `ProjectFile[]` through the same-origin download proxy.
- **Interior Design** (top-level, next to Buyers Guide — not a per-project
  tab) — two sections on one page (`app/interior-design/interior-design-
  sections.tsx`): "Design a room" (below) and "Finish ID" (universal — see
  its own bullet further down; it doesn't need a construction picked here
  to work, unlike "Design a room"). "Design a room" designs a room,
  optionally starting from a real photo of it
  empty/framed-out. Pick which construction it's for first
  (`app/interior-design/project-picker.tsx`, auto-selected when there's
  only one), then pick a room type and type a style (free text, no presets),
  and size the room either by selecting one of that project's pre-added rooms
  (auto-fills width/depth from `rooms`) or entering dimensions/sqft
  manually.
  - **2D layout editor** (`components/LayoutEditor.tsx` — shared with
    Landscape's yard layout, see its bullet further down) —
    once the room has real dimensions, a scaled top-down SVG of it appears
    with a palette of draggable fixtures/furniture specific to the room
    type (`lib/fixtureCatalog.ts` — cabinets/island/range/fridge for a
    Kitchen, toilet/shower/tub/vanity for a Bathroom, bed/dresser for a
    Bedroom, etc.). Drag a chip from the palette onto the room to place it
    at that spot; drag a placed item to reposition it; a small toolbar
    rotates 90°, deletes the selected item, or adds a freeform detail note
    to it (`PlacedFixture.detail`, e.g. "stainless steel, French door" on a
    fridge) — folded into that fixture's line in the generated prompt by
    `describeLayout()` in `lib/interiorDesignPrompt.ts`. Positions clamp to stay
    inside the room, including when you switch rooms mid-edit, and snap to
    a 0.5ft grid once on release (not while dragging — see below).
    Built with pointer events (not the HTML5 Drag and Drop API, which is
    unreliable on touch) — dragging in from the palette tracks `window`
    pointermove/pointerup while a floating preview (a raw DOM node moved by
    direct style writes) follows the cursor; repositioning a placed item
    uses native pointer capture on that element instead, so it keeps
    tracking even if the cursor leaves it mid-drag. Moving an item is a
    live SVG `transform` written directly to the DOM during the drag — not
    a React state update on every pointermove — both because a state
    update per move (previously via `onChange` mid-drag) forces a full
    re-render of every item on the canvas, which felt janky, and because
    the position only actually commits (and snaps to the grid) once, on
    release; the drag also preserves the offset between where you grabbed
    the item and its origin, rather than recentering it under the cursor
    on the very first pointermove — that recentering was the "dragging
    feels off" jump reported and fixed here: grabbing an item anywhere but
    its exact center used to make it visibly teleport before you'd even
    moved the mouse.
    - **Resizing** — the selected item gets a small handle at its
      bottom-right corner; drag it to resize (anchored at the item's
      top-left, same clamp/snap-on-release behavior, and the same
      grab-offset preservation as moving — grabbing the handle imprecisely
      no longer nudges the size before you've moved the pointer at all).
      Resizing writes a per-instance `width`/`depth` straight onto that
      `PlacedFixture`, independent of the catalog's default footprint.
      Minimum size is 3"; the handle's own touch target scales with the
      room size so it stays grabbable in both a tiny closet and a great
      room.
    - **Feet-and-inches accuracy** (`lib/feetInches.ts`) — every size and
      position is now precise to the nearest inch, not a rounded decimal
      foot: dragging/resizing snaps to a 1" grid (`SNAP` in
      `components/LayoutEditor.tsx`, decoupled from the coarser 1ft visual grid
      lines, `GRID_SPACING`, so the reference grid doesn't get too dense to
      read), and every displayed number is formatted as `4'6"` rather than
      `4.5'` (`formatFeetInches`). This isn't just cosmetic — internally
      everything still computes in decimal feet (simpler arithmetic; `4'6"`
      is exactly `4.5`), so switching the display format didn't change any
      math, only what's shown and what a text input accepts. Every
      width/depth entry field across the app that feeds this — the Rooms
      tab's "Add room" form and its inline dimension editor, and the
      Interior Design form's manual sizing — uses the same
      `components/FeetInchesInput.tsx` control (parses `4'6"`, `4' 6"`,
      `4ft 6in`, `54"`, or plain `4.5`; reverts to the last valid value on
      an unparseable entry rather than silently zeroing a room out), so a
      room entered precisely on the Rooms tab stays precise everywhere it's
      read from — Interior Design's "use an existing room" picker, the
      Rooms tab's own display, and the public share page.
    - **Measurements on the canvas** — every placed item shows its current
      size as a "W' D"" caption (live-updated during a resize via the same
      direct DOM writes as the drag, not React state); the room itself
      gets architectural-style dimension lines with tick marks along its
      top and left edges showing total width/depth, drawn in a margin
      added outside the room in the SVG's `viewBox` (`MARGIN` in
      `components/LayoutEditor.tsx`) so they don't overlap the fixtures. All
      figures come directly from the same feet-based coordinates the
      drag/resize/clamp math already uses, so what's displayed is what's
      actually stored — not a separate, driftable label.
    - **Full screen** — a "Full screen ⤢" toggle renders the same editor
      instance (same drag/resize state, via `createPortal` to
      `document.body`, matching the pattern `components/Modal.tsx` already
      uses) in a large fixed overlay instead of the narrow column next to
      the form, for more room to work precisely; Escape or "Exit full
      screen" returns it inline.
    - **Deleting** — besides the "Delete" button in the selected-item
      toolbar, the selected item also gets a small × badge in its
      top-right corner, and pressing Delete/Backspace removes it too (the
      keyboard shortcut is skipped while focus is in a text input
      elsewhere on the page, so backspacing the style/dimensions fields
      doesn't also delete the current selection).
  - **"Example setup from plans"** — with plan pages uploaded on the Plan
    tab, this button (`/api/claude/suggest-room-layout`) sends Claude the
    same layout-marked plan sheets the Plan tab/Construction Cost use (vision, low
    thinking effort — same latency lesson as `detect-rooms`) along with the
    room's name/type/size and the exact fixture catalog for that room type,
    asking it to find this room on the plan and place fixtures matching
    what's actually drawn (which wall the cabinet run is on, where the
    island sits, etc.), falling back to a sensible generic arrangement
    (flagged via `found_on_plan: false`) if the room can't be confidently
    located. The server clamps/validates every returned placement against
    the real catalog and room bounds before it reaches the client — never
    trusts the model's arithmetic verbatim. Replaces whatever's currently
    on the canvas; drag from there to adjust.
  - **Rendering from the layout** — `lib/interiorDesignPrompt.ts`'s
    `describeLayout` turns the placed items into a numbered, imperative
    "FIXTURE PLACEMENT — follow this exactly" list (one line per item:
    label, size, and a zone derived from its position relative to the
    room — "along the back wall", "in the back-right corner", etc., since
    an image model can't use real coordinates), and it explicitly tells
    the model not to add anything beyond that list. A dense semicolon-joined
    sentence turned out to get partially skimmed/ignored; a numbered
    "do exactly this" list is what actually gets followed. `buildInteriorDesignPrompt`
    (still a deterministic template, no Claude round-trip) puts that list
    right after the opening scene-setting sentence — ahead of the softer
    style/finish language — and drops the generic "add appropriate
    fixtures and furniture" fallback whenever an explicit layout exists,
    since that catch-all was competing with and diluting the specific
    placement instructions. It also resolves a coordinate-frame ambiguity:
    the 2D plan's "back/front/left/right" are the plan's own axes and have
    no inherent relationship to a camera angle. Without a source photo,
    the prompt fully specifies the camera itself (shot from just inside
    the doorway, straight across toward the far wall) so those axes line
    up with what gets generated; with a source photo, the camera angle is
    whatever the photo already has, so the prompt instead tells the model
    to map the plan's axes onto what it can actually see (farthest wall =
    back, nearest = front, left/right as shown). This is a best-effort
    mitigation, not a guarantee — image models have real limits following
    precise multi-object spatial instructions, especially on the
    photo-edit path where it also has to preserve the existing photo. The
    uploaded photo is still optional: with one, it's still
    Gemini's image *edit* call (`editRoomImage` in `lib/gemini.ts`,
    POST `/api/gemini/edit-room-image`) — image-to-image seeded with the
    real photo so the actual architecture/windows carry through; without
    one, it falls back to the Rooms tab's existing text-to-image endpoint
    (`generateRoomImage`, POST `/api/gemini/generate-room-image`) and
    generates the room from scratch using the room type, style, and
    layout description alone.
  - Every past design for a project is kept (not overwritten) in a
    gallery with the generated result, the before photo when there was
    one, a "N fixtures laid out" note, "Copy prompt", and "Save image";
    deleting one removes its images and File Library entries. The layout
    itself is saved too (`interior_designs.layout`, jsonb array of
    `{id, typeId, label, x, y, width, depth, rotated}` in feet from the
    room's top-left).
  - Still belongs to a project under the hood
    (`interior_designs.project_id`) — being top-level only changes where
    you start (pick the construction up front, same as picking a deal in
    Buyers Guide) — and it's gated by the same tab_permissions row
    (`interior-design`), just reclassified from `PROJECT_TABS` to
    `TOP_LEVEL_TABS` in `lib/permissions.ts`. Requires `GEMINI_API_KEY`
    like the Rooms tab's image generation does.
- **Construction Cost** (top-level, next to Interior Design — its own
  section, not folded into Interior Design's page — gated by the same
  `tab_permissions` matrix, `cost` tab) — started as a per-project tab, but
  an estimate is really "pick a construction, then estimate it," the same
  shape as Interior Design, so it moved to a top-level page with a
  project-picker (`app/construction-cost/page.tsx`, sharing the same
  `components/ProjectPicker.tsx` Interior Design uses — worth a shared
  component once there were two call sites) instead of living inside that
  project's own tab strip. Moving `cost` from `PROJECT_TABS` to
  `TOP_LEVEL_TABS` in `lib/permissions.ts` needed no migration —
  `tab_permissions` is just a (role, tab) matrix agnostic to which array a
  slug lives in app-side, so a Developer's existing visibility settings for
  Construction Cost carried over unchanged. Claude reads every plan page
  marked "Floor plan layout" on the selected construction's Plan tab and,
  grounded by a couple of web searches for current regional (or national,
  if no address) construction cost data, picks a pricing tier (Low
  $250-300/sqft, Mid $350-400/sqft, High $450+/sqft) and gives both a
  single "most accurate" predicted total (with a contingency % for what
  the plan can't show) and the tier's range, plus a category cost
  breakdown. The $/sqft numbers are clamped server-side to the chosen
  tier's fixed band rather than trusted verbatim from the model. You can
  manually swap the displayed tier (Low/Mid/High buttons on each estimate)
  to compare — swapping away from the AI-recommended tier falls back to a
  deterministic sqft × fixed-band calculation rather than a second AI
  call.
  - **Data-accuracy pass** — an audit of every AI/API data-retrieval path
    in the app surfaced two real gaps here specifically (the other ~11
    routes were already solid: web-search-grounded, honest confidence
    levels, "never invent a number"). First: `cost_per_sqft` and
    `contingency_pct` were already clamped server-side to sane bands, but
    `total_sqft` — the single biggest multiplier in every total below it —
    had zero guardrail; it's now checked for finite/positive and clamped
    to a believable 100-50,000 sqft range before anything is computed from
    it. Second: the category `breakdown`'s percentages were only ever
    *asked* of Claude ("should sum to ~100"), never enforced, so the
    displayed per-category dollar amounts could silently fail to add up to
    the shown total — they're now normalized to actually sum to 100 before
    being priced.
  - `lib/anthropic.ts`'s `extractJson` (which every one of these routes
    depends on to pull JSON out of Claude's response) found the JSON's end
    by counting `{`/`}` characters without tracking whether it was inside
    a quoted string — a stray brace inside a free-text field (a "notes" or
    "analysis" paragraph) could throw off the count. Now string-aware, the
    same way `escapeControlCharsInStrings` in the same file already was.
  - **Buyers Guide's profit math** (`app/api/claude/evaluate-deal/route.ts`)
    computed `estimated_profit`/`profit_margin_pct` — and so the good/
    marginal/pass verdict itself — off gross numbers only, with the actual
    omission (selling commissions, closing costs) disclosed only as a UI
    caption next to the figure, not reflected in the number or the verdict
    it drove. Now deducts a standard ~7% of the completed value (agent
    commission + closing costs, the same rule of thumb flip/rebuild
    calculators use) before computing profit and verdict, with the
    deduction itself spelled out in a new "COST ASSUMPTIONS" section of
    the analysis. Financing/holding costs during construction still aren't
    modeled — this app doesn't know the buyer's loan terms or timeline —
    so the UI caption now scopes its disclaimer to just that remaining gap.
- **Landscape** (top-level, next to Construction Cost — `landscape` tab,
  same project-picker shape as Interior Design/Construction Cost) — upload a
  photo of the house's exterior, type a style, optionally lay out yard
  elements with the same 2D layout editor Interior Design uses (see below),
  add freeform notes, and Gemini's image-*edit* call (`editRoomImage`, reused
  as-is from Interior Design — it only cares about an image + a prompt, not
  what feature is calling it) redesigns that actual photo's yard in place.
  Unlike Interior Design there's no from-scratch path — a photo is always
  required, since the point is redesigning this specific house rather than
  generating a generic one. `lib/landscapePrompt.ts` builds the prompt the
  same way `lib/interiorDesignPrompt.ts` does (the layout description first
  as an explicit numbered "place exactly this" block, then an instruction to
  keep the house's architecture/camera angle unchanged). `landscape_designs`
  (migration `025_landscape.sql`) mirrors `interior_designs`'s shape. The
  original fixed checklist of components (Grass/Lawn, Deck, Pool,
  Concrete/Patio) was retired in favor of the layout editor below — its
  `components` column stays in the schema for old rows but new saves always
  write an empty array.
  - **2D yard layout editor** (migration `039_landscape_layout.sql` adds
    `layout`/`yard_width`/`yard_depth` to `landscape_designs`) — enter yard
    dimensions and the same `components/LayoutEditor.tsx` used by Interior
    Design's room layout appears, with a yard-specific catalog
    (`lib/landscapeCatalog.ts`: pool, spa, deck, patio, walkway, lawn,
    planting bed, fire pit, outdoor kitchen, pergola, fence line, retaining
    wall, shed). The editor itself was generalized from Interior-Design-only
    (`app/interior-design/room-layout-editor.tsx`, taking a `roomType`
    string and resolving fixtures internally) into a shared component
    (`components/LayoutEditor.tsx`, taking a `catalog: FixtureType[]` prop
    directly) so both features share one drag/resize/rotate/snap
    implementation — Landscape passes `areaNoun="yard"` for its helper copy,
    Interior Design keeps the default "room" wording. The layout-to-prompt-
    text logic (`describeLayout`, zone labels like "along the back wall") was
    likewise extracted from `lib/interiorDesignPrompt.ts` into
    `lib/layoutDescription.ts`, parameterized with `sideLabel`/`elementNoun`
    (defaulting to Interior Design's exact original "wall"/"furniture or
    fixtures" wording, so that extraction changed no existing behavior) —
    Landscape calls it with `sideLabel: "side"`, `elementNoun: "landscape
    elements"`.
  - **Standalone Photos** (`landscape-sections.tsx`, migration
    `027_landscape_standalone.sql`) — a second tab alongside "By
    Construction" for a photo that isn't tied to any tracked construction at
    all (a listing you're scouting, a reference photo). `project_id` is
    nullable; a standalone row instead carries `created_by` and uses the
    same shared-directory RLS shape as `finish_scans`/`subcontractors` — any
    signed-in user can see every standalone design, only its creator (or a
    Developer) can delete one. Since there's no project to file it under,
    a standalone save skips the File Library `recordProjectFile` calls the
    per-construction path makes.
- **House Book** (per-project tab, `house-book`, migration
  `026_house_book_tab.sql` — no new tables, nothing persisted; everything's
  generated on demand) — a polished, book-style PDF for the homeowner.
  `app/projects/[id]/house-book/house-book-client.tsx` shows what's
  available for this construction (layout plan pages, room renderings +
  Interior Design images, Landscape designs, linked subcontractors) as
  checkable cards/rows, all selected by default, plus a toggle for an
  AI-written closing note — the Developer/PM picks what actually goes in
  before generating, rather than an all-or-nothing dump. "Generate House
  Book" posts the selected ids to `app/api/projects/[id]/house-book/route.ts`,
  which re-fetches each one scoped to this project server-side (never
  trusting the client-sent list as more than an id filter), optionally asks
  Claude for a short warm closing paragraph grounded only in what was
  actually selected (room/style/landscape/trade names — never inventing
  specifics), and renders the whole thing with `@react-pdf/renderer`
  (`lib/houseBookPdf.tsx`) — a cover page, one page per plan sheet, a
  grid of room/finish photos, landscape pages, a "Your Team" subcontractor
  page, and the closing note — then streams the PDF back as a download.
  Built on the base-14 PDF fonts (Times/Helvetica) rather than a registered
  font, so there's nothing that can fail to download mid-request. Every
  photo is re-encoded to a JPEG data URI via `sharp` before being handed to
  `@react-pdf/renderer` — its `<Image src="https://...">` fetches the URL
  itself and sniffs the actual bytes for a JPEG/PNG/SVG signature (not the
  file extension), throwing "Not valid image extension" and failing the
  *entire* PDF over one photo that's actually HEIC (the iPhone camera
  default), WEBP, or otherwise unsupported — normalizing every image up
  front sidesteps that, and a photo that still can't be fetched/decoded
  (dead URL, corrupt file) is logged and skipped rather than failing the
  whole House Book. Deploying this to Vercel surfaced its own gotcha:
  pdfkit (which `@react-pdf/renderer` uses internally) loads its base-14
  standard fonts via a *computed* require
  (`pdfkit/standard-fonts/<name>`), which Vercel's static file-tracing
  can't follow — it only sees the literal template string, not which font
  a given run actually needs — so those files never made it into the
  deployed function and requiring one threw "Cannot find module
  .../standard-fonts/Helvetica.cjs" in production only (never locally,
  where the full `node_modules` tree is already on disk). `next.config.js`
  marks `@react-pdf/renderer` as a `serverComponentsExternalPackages`
  entry and force-includes pdfkit's/`@react-pdf`'s file trees via
  `outputFileTracingIncludes` as belt-and-suspenders, but the fix that
  actually closes the gap is in `lib/houseBookPdf.tsx` itself: a literal,
  otherwise-unused import of the exact 4 pdfkit standard-font subpaths
  this app's styles use (Helvetica, TimesRoman, TimesBold, TimesItalic).
  Since that file (unlike `@react-pdf/renderer`) isn't external, webpack
  bundles their content directly into the route's own compiled output —
  confirmed by grepping the built `route.js` for `glyphWidths` — so
  nothing needs to be traced or resolved against pdfkit's own files at
  request time at all.
- **Chat** (per-project tab, `chat`, migration `028_project_chat.sql`) — one
  running message thread per construction, live for everyone with access to
  that project via Supabase Realtime's `postgres_changes`, which enforces
  RLS on its own: a subscribed client only ever receives INSERT/DELETE
  events for rows `project_messages_select` would let it read anyway, so no
  separate authorization check is needed client-side. `sender_email` is
  denormalized onto each row at write time (read from
  `supabase.auth.getUser()`, not resolved via a `profiles` join) because
  `profiles_select` only lets a user read their own profile row — a join
  would come back empty for every other member's name. `chat-client.tsx`
  generates the message `id` client-side (`crypto.randomUUID()`) before
  inserting and appends it to local state immediately for an instant-feeling
  send; the Realtime INSERT event for that same id arrives moments later and
  is deduped away (`prev.some(m => m.id === row.id) ? prev : [...]`) instead
  of rendering twice. A failed send/delete rolls the optimistic change back
  and surfaces a toast. Deleting is limited to your own messages (or a
  Developer, per RLS). Enabling this feature requires the migration to also
  add `project_messages` to the `supabase_realtime` publication (wrapped in
  a guarded `do $$ ... if not exists ...` block so re-running it is safe) —
  without that step the table exists and works for sending/reading, but
  nothing streams live.
  - **Unread-count badge on the Chat tab** (migration
    `044_project_chat_reads.sql`) — a small solid-fill number
    (`.badge-count` in `app/globals.css`, deliberately not a translucent
    `.badge-*` tint like the rest of the app's badges, so it stays legible
    sitting on top of either the active tab's solid blueprint fill or the
    inactive tab's transparent one) shown next to "Chat" in
    `app/projects/[id]/project-tabs.tsx` whenever there are messages the
    current user hasn't seen yet. Backed by a new `project_chat_reads
    (project_id, user_id, last_read_at)` table — no row yet means "never
    read this project's chat," so every existing message counts as unread
    the first time, same as most chat apps. `ProjectTabs` lives in the
    per-project layout, so it stays mounted across every tab within one
    construction (not remounted per page) — that's what lets a single
    long-lived Realtime subscription (on `project_messages` INSERT,
    filtered to this project) drive the badge live without a subscription
    per tab: a message from someone else increments the count when the
    user isn't currently on the chat page, and either way (own message or
    already on chat) instead calls `markChatRead`
    (`app/projects/[id]/chat/actions.ts`, an upsert of `last_read_at =
    now()`) so a message that arrives while chat is already open never gets
    counted as unread the next time the user leaves and comes back. A
    `pathname` **ref** (not state) inside that same effect is what lets it
    always check "is chat the active tab right now" without having to tear
    down and resubscribe the channel on every navigation — a second, small
    effect keyed on the actual `pathname` state separately resets the badge
    to 0 and marks read the moment the user lands on (or client-navigates
    into) the chat tab itself, including on the very first server-rendered
    load if that's the page they opened directly (the initial count itself
    comes from `app/projects/[id]/layout.tsx`, computed server-side per
    request so it's correct even before any client code runs).
- **Email alerts** (migration `033_project_alerts.sql`) — a "🔔 Get alerts" /
  "🔕 Alerts on" toggle in every construction's header (next to Invite/Share,
  `app/projects/[id]/alert-subscribe-button.tsx`) subscribes the signed-in
  user to an email whenever that project gets a new chat message, a
  checklist item is added or marked done, a warranty item is filed or fixed,
  or a warranty item's review status changes — one `project_alert_subscriptions`
  row per (project, user), self-service only (`alerts-actions.ts`'s
  `subscribeToAlerts`/`unsubscribeFromAlerts`, each scoped to `auth.uid()`).
  Dispatch (`lib/alerts.ts`'s `notifyProjectSubscribers`, called from the
  relevant action right after each mutation succeeds) reads every
  subscriber's row via the service-role admin client rather than the
  caller's own session — `project_alert_subscriptions_select`'s RLS only
  lets a user see their own row, so the caller's normal client could never
  see who else is subscribed to fan a notification out to; that's a
  deliberate scope limit on the policy, not a workaround for a bug. Whoever
  caused the change is excluded from the send. Actually sending mail is a
  thin `fetch` wrapper around Resend's REST API (`lib/email.ts`, no SDK —
  same style as `lib/anthropic.ts`/`lib/gemini.ts`) gated behind
  `RESEND_API_KEY`; every call site wraps dispatch in a try/catch that only
  ever logs a failure (a bad key, Resend being down, a bounced address)
  rather than surfacing it to the user or rolling back the action that
  triggered it — the chat message/checklist change/etc. always succeeds on
  its own merits regardless of whether the alert email actually went out.
  With no `RESEND_API_KEY` set, subscribing still works (the toggle and the
  DB row are unaffected) but no email is ever sent. `ALERT_FROM_EMAIL`
  needs a domain verified in Resend's dashboard to actually deliver to
  subscribers other than the Resend account owner — see `.env.example`.
- **Warranty Request** (per-project tab, `warranty-request`, migration
  `029_warranty_request.sql`) plus a new **Warranty** account role, for a
  homeowner given access once their construction is complete. They log
  issues one at a time — each becomes a row in the same `checklist_items`/
  `checklist_photos` tables the Checklist tab uses (`phase = 'warranty'`
  instead of `'rough'`/`'finish'`), so it gets the same title/done/comment/
  photo shape and RLS for free; `checklist-client.tsx`'s phase filter simply
  never matches `'warranty'`, so these items don't leak into the Checklist
  tab's rough/finish columns (or the public `/share/[token]` page, whose
  section component is hardcoded to those same two phases). Warranty is
  account-wide like every other role here — not scoped to one construction —
  so tab_permissions gives it the opposite shape from Contractor's few
  exclusions: everything is `false` except `warranty-request`, meaning that
  account sees nothing else, on any project it can reach. Set it either by
  changing an existing member's role in Admin's Users list, or by inviting
  someone fresh at the "Warranty" role (Admin's per-project invite panel or
  the project page's own Invite button) — both surfaces warn that the
  choice is account-wide before it's sent. Owner/PM/Contractor/Developer all
  see Warranty Request by default (same "field-relevant, not financial"
  reasoning as Chat/Certificate of Occupancy) so the team can act on what
  gets filed there.
- **Warranty tracker construction type** (`projects.kind`, migration
  `030_warranty_tracker_projects.sql`) — a second way to get a
  warranty-only project, alongside setting a member's account to the
  Warranty role: create the construction itself as a tracker, for a
  property that's already built elsewhere and never needs the full
  workflow at all. Picked at creation time in "+ New construction"
  (`CreateProjectModal` in `projects-client.tsx`); `createProject` skips
  seeding the rough-in/finish checklist for this kind, since it'll never
  have a Checklist tab to show it on. `app/projects/[id]/layout.tsx`
  intersects the normal per-role allowed tabs with just `warranty-request`
  when `kind = 'warranty_tracker'` — every role, Developer included, sees
  only that one tab on a project like this, not because of who they are
  but because of what the project itself is. The constructions list badges
  these projects "Warranty Tracker" and swaps their card's Rooms/Tasks/
  Budget stats (always zero — nothing ever populates them) for a plain
  one-line description instead.
- **Inspection reports on the Warranty Request tab** (`inspection_reports`,
  migration `031_inspection_reports.sql`) — upload any file (a PDF from an
  inspector, a photo, a scan) and separately attach it to the warranty item
  it applies to, rather than the file being locked to whatever item it was
  uploaded under. `checklist_item_id` is nullable and starts null; the
  report shows as "Not attached" until picked from a dropdown of the
  project's warranty items, and can be moved to a different item or
  detached again later — `attachInspectionReport` just updates that one
  column. Uses the same `project-files` storage bucket the Files tab
  already uploads to (no new bucket/policy needed) and is also recorded
  into `project_files` (`category: 'document'`) so it surfaces there too on
  a full construction. Deleting the warranty item it's attached to detaches
  the report rather than deleting it (`on delete set null`), mirrored in
  the client so local state doesn't show a report "attached" to an item
  that no longer exists.
- **"Generate checklist items" from an inspection report** — reading a
  report by hand and retyping each finding as its own warranty item is the
  slow part; a "Generate checklist items" button per report does it
  instead. Reads the report straight from its stored URL (works for a
  report uploaded just now or long ago, not just the one still in memory
  from an upload) — a PDF gets its text pulled with `pdf.js`, falling back
  to rendering pages as images for a scanned/image-only PDF, the same
  approach `bids-client.tsx` already uses for reading contractor bids; a
  photo report goes straight to Claude as an image. `/api/claude/extract-
  inspection-report` is told to pull out every actionable issue as
  `{ title, detail }` — deliberately dropping passed/satisfactory items and
  boilerplate report text — and `addWarrantyItemsFromReport` bulk-inserts
  them as warranty checklist items (`title` → the item, `detail` → its
  comment) in one insert rather than one `addWarrantyItem` call per
  finding. The report itself isn't auto-attached to any of the items it
  generated — one report can produce several items, and
  `inspection_reports.checklist_item_id` only ever points at one — so
  attaching stays the manual dropdown, same as before.
- **Warranty item review status** (`checklist_items.status`, migration
  `032_warranty_item_status.sql`) — a second, independent axis from "done"
  (Fixed). Each warranty item gets a dropdown: Pending review (default),
  Validate (confirmed as a real, warranty-covered issue), or Not covered by
  warranty (reviewed and rejected — normal wear, homeowner-caused damage,
  outside the warranty period, whatever the reason). Kept as its own
  `status` column rather than folded into `done` because the two aren't the
  same axis — an item can be validated but not yet fixed, and an
  invalidated item was never going to be "fixed" under this claim at all;
  modeling that as more boolean flags on `done` would allow nonsense
  combinations a single enum doesn't. Marking an item "Not covered" clears
  a stray "Fixed" check and disables the checkbox (nothing left to fix
  under warranty), and the title renders struck through in red instead of
  the normal gray. `status` lives on `checklist_items` itself (not a
  separate table) so rough/finish items carry the same column — they just
  never touch it and stay at the 'pending' default.
- **Warranty role: Chat access + view-only + request/approval queue**
  (migration `034_warranty_item_requests.sql`) — three changes to the
  Warranty role's access, all in response to it being too locked-down:
  Chat is now allowed alongside Warranty Request (`tab_permissions` and the
  `warranty_tracker`-kind filter in `app/projects/[id]/layout.tsx` both
  updated), since a homeowner filing warranty issues should be able to talk
  to the team about them. On Warranty Request itself the role was originally
  view-only — able to watch every checklist item, note, photo, and
  inspection report — but has since been narrowed further into a pure
  submission form with no visibility into any of that at all; see "Warranty
  Request becomes a one-way submission form" near the end of this section
  for where that landed. Every mutating action on the tracking side
  (`toggleWarrantyItem`,
  `setWarrantyStatus`, `updateWarrantyComment`, `deleteWarrantyItem`,
  `addWarrantyPhoto`/`deleteWarrantyPhoto`, the inspection-report actions,
  and direct `addWarrantyItem`) is blocked for it server-side by a shared
  `requireCanManageWarrantyItems()` guard in
  `app/projects/[id]/warranty-request/actions.ts` (checked against the
  real stored `profiles.role`, the same pattern `app/admin/actions.ts`'s
  `requireDeveloper()` uses, not a Developer's preview-role cookie) — the
  client mirrors this by disabling/hiding those controls when
  `viewerRole === "warranty"`, but the actual boundary is the action guard,
  since RLS on `checklist_items` stays wide open to every project member
  (unchanged, to avoid touching a widely-shared table's RLS for a
  single-role restriction). Adding a new item now goes through a request
  instead: a new `warranty_item_requests` table (`pending`/`approved`/
  `rejected`) that `requestWarrantyItem` inserts into and a Contractor or
  Developer reviews from a new "Warranty Item Requests" section on the
  tab — `approveWarrantyItemRequest` copies the request into a real
  `checklist_items` row (`phase = 'warranty'`) and links back via
  `checklist_item_id`; `rejectWarrantyItemRequest` just marks it rejected.
  Approval is gated by a `requireApprover()` action guard AND, since this
  is a genuinely new authorization boundary (not an existing widely-shared
  table), directly in RLS too (`warranty_item_requests_update` checks
  `profiles.role in ('contractor', 'developer', 'pm')` — PM added by the
  extension described just below — the same `is_developer()`-in-RLS
  pattern `project_invites` uses) for defense in depth. All three request/
  approval actions notify subscribers via the existing email-alerts
  pipeline. (The select policy's original "anyone with project access
  sees the whole queue" behavior is also since narrowed — see below.)
  - **A filed request is now a lightweight ticket, not just an approve/
    reject gate** (migration `045_warranty_request_tracking.sql`) —
    Contractor/Developer/PM (PM newly added everywhere in this section;
    previously only Contractor/Developer could touch a request at all)
    can now also track a request's actual progress, assign a
    subcontractor to it, and leave a running comment/notes thread, all
    independent of whether it's ever been approved into a real checklist
    item. Three additions to `warranty_item_requests`:
    - **`progress`** (`open` / `in_progress` / `complete`, its own column,
      deliberately separate from the existing `status` triage column) —
      `status` answers "is this a legitimate warranty issue at all";
      `progress` answers "where does the actual work stand," and moves on
      its own timeline, usually starting well before (or entirely without)
      an approve decision. `setWarrantyRequestProgress` updates it and
      renders as a Default/"Working on it"/Complete selector for a
      manager, a plain badge for everyone else.
    - **`subcontractor_id`** (references `subcontractors`, nullable) —
      `assignWarrantyRequestSubcontractor` sets it; the picker only offers
      subs already linked to *this* construction (`project_subcontractors`,
      same query `house-book/page.tsx` already uses for the same purpose),
      not the entire shared subcontractor directory.
    - A **comment/notes thread** — a new `warranty_item_request_comments`
      table (`request_id, user_id, sender_email, body, created_at` — same
      shape and same `sender_email`-denormalized-at-write-time reasoning
      as `project_messages`), posted via `addWarrantyRequestComment` and
      gated to Contractor/Developer/PM in both the action (`requireApprover`,
      renamed in spirit though not in name to cover all three roles now)
      and RLS (`warranty_item_request_comments_insert`) — 'warranty' was
      never able to post to it, and (per the form-only restructure below)
      no longer sees it rendered anywhere either, though the RLS read
      restriction described next still applies underneath as defense in
      depth regardless of what the UI shows.

    **"Only track the requests they created"** — previously any project
    member (including every other 'warranty' account sharing that
    project) could see the *entire* request queue via one broad
    `has_project_access` select policy. A new security-definer function,
    `can_view_warranty_request(rid)` (same "callable from the table's own
    policy without recursing through it" pattern as `has_project_access`/
    `is_developer()`), now backs both `warranty_item_requests_select` and
    `warranty_item_request_comments_select`: a 'warranty' account only
    ever sees a request where `requested_by = auth.uid()` (and, by
    extension, only that request's own comment thread); every other role
    with project access still sees the whole queue, since Contractor/
    Developer/PM need to triage all of it. This is a real RLS-level
    restriction, not just a client-side filter — `page.tsx`'s query for
    the queue has no explicit `requested_by` filter of its own; the row
    set a 'warranty' session gets back from Postgres is already narrowed
    before it ever reaches the app.

    **Uploading an inspection report to a request directly** — before
    this, `inspection_reports.checklist_item_id` was the only attachment
    point, which doesn't exist until a request is approved, and
    `addInspectionReport` was blocked for 'warranty' entirely. A new,
    independent `warranty_item_request_id` column on `inspection_reports`
    lets the person who filed a request attach evidence to it right away;
    `addInspectionReport` now accepts that id as an optional 4th argument
    and, when the caller is 'warranty', checks that the request is
    actually theirs (`request.requested_by === user.id`) before allowing
    it — every other role keeps its existing broad access unchanged. Each
    request card in the UI has its own small "+ Attach report" upload
    control (same direct-to-`project-files`-bucket signed-upload flow the
    top-of-page Inspection Reports section already uses) and its own
    attached-reports list, separate from that top section's checklist-
    item-scoped one.
  - **Warranty Request becomes a one-way submission form for the 'warranty'
    role** (migration `046_warranty_request_category.sql`) — rather than a
    trimmed-down view of the same tracking dashboard Contractor/Developer/
    PM use, the 'warranty' role's whole "Warranty Request" tab is now a
    single-purpose form, `CreateWarrantyRequestForm`
    (`app/projects/[id]/warranty-request/create-warranty-request-form.tsx`):
    a title, a **category** (a new fixed list —
    `lib/warrantyRequestCategories.ts`: Electrical, Plumbing, Roof/Leaks,
    HVAC, Structural, Appliances, Flooring, Windows & Doors, Exterior/
    Siding, Other — plain `text` column, no DB check constraint, same
    "fixed option list enforced only at the UI layer" choice
    `bank_transactions.category` already made), an optional description,
    and multiple photo/file attachments, submitted with "Submit request,"
    followed by a one-line "submitted, thank you" confirmation. Below it,
    a **`MyWarrantyRequests`** section
    (`app/projects/[id]/warranty-request/my-warranty-requests.tsx`) lets the
    same account track what it's already filed — status (pending/approved/
    rejected), progress (open/working on it/complete), assigned
    subcontractor, and the comment thread Contractor/Developer/PM leave on
    it — read-only, and scoped to *its own* requests only, never another
    warranty account's. It reuses `WarrantyRequestCard` (exported from
    `warranty-request-client.tsx`) with `canManageRequests={false}`, the
    exact same read-only rendering path Contractor/Developer/PM see for a
    request they can't act on, rather than a second parallel
    implementation; every handler prop besides the report-upload one is a
    no-op, since that component already hides every control that would
    call them once `canManageRequests` is false. Everything else after
    submission — approving/rejecting, moving progress, assigning a
    subcontractor, posting comments — is still Contractor/Developer/PM's
    internal working queue (the `WarrantyRequestClient` dashboard described
    throughout this section, unchanged for them).
    `app/projects/[id]/warranty-request/page.tsx` branches on `viewerRole`
    *before* querying anything — a 'warranty' viewer's request short-
    circuits to its own narrower query (`requested_by = auth.uid()` only,
    no checklist items, no other account's requests), so the full-project
    dashboard data is never fetched or sent to that viewer at all, not
    merely hidden client-side; every other role still gets the full
    dashboard query exactly as before (now also selecting `category`, shown
    as a badge on each request card, with a category filter dropdown above
    the list for triage). Submission itself still goes through the same
    `requestWarrantyItem` action (now taking `category` as a 4th argument)
    and the same `addInspectionReport(..., warrantyItemRequestId)` path
    described above for attachments — this is a UI/data-flow restructure of
    who sees what, not a new write path. The now-unreachable "submit a
    request from here" form and its messaging were removed from
    `WarrantyRequestClient`/`RequestsSection`, since that component is only
    ever rendered for the roles that manage the queue now.
  - **`warranty_item_requests_insert` no longer checks project access**
    (migration `048_warranty_request_insert_no_access_check.sql`) — a
    'warranty' account submitting from the form above kept hitting a raw
    `"new row violates row-level security policy for table
    \"warranty_item_requests\""` even after being directly verified (live
    policy text, `has_project_access()`'s own logic, the `project_members`
    row, and a manually impersonated insert all checked out correctly in
    isolation) to have real access to the construction it was submitting
    against, across multiple accounts including freshly created ones — no
    root cause was found. The policy's `has_project_access(project_id)`
    half was dropped to unblock submissions; **any signed-in user can now
    file a warranty request against any project id**, not just one they
    belong to — `auth.uid() = requested_by` is the only remaining check, so
    no one can file a request pretending to be another account, but the
    project-membership boundary on this one insert path is gone. Revisit
    this if the root cause is ever found. `requestWarrantyItem`
    (`app/projects/[id]/warranty-request/actions.ts`) also no longer
    chains `.select("id")` on the insert — generates the id with
    `crypto.randomUUID()` up front instead — since `INSERT ... RETURNING`
    separately requires the new row to pass the table's SELECT policy too,
    which was a second way this exact error could surface.
- **Only Developer or Contractor can create, rename, or delete a
  construction** (migration `047_restrict_project_management.sql`) —
  previously any signed-in user could create a project (with themselves as
  its `user_id` owner) and that owner (or a Developer) could rename/delete
  it, with no role check anywhere. A new `can_manage_projects()` SQL
  function (`role in ('developer', 'contractor')`, same security-definer
  shape as `is_developer()`) now backs all three RLS policies —
  `projects_insert`/`_update`/`_delete` — and a matching
  `requireCanManageProjects()` guard in `app/projects/actions.ts` gates
  `createProject`/`renameProject`/`deleteProject` at the action layer too,
  for a clear error message instead of a raw RLS one. `projects_insert`
  deliberately has no `has_project_access(id)` check — the row doesn't
  exist yet, so there's nothing to already have access to — while
  `_update`/`_delete` require both `can_manage_projects()` **and**
  `has_project_access(id)`, so a Contractor can only manage constructions
  they're actually on, not every construction in the system (a Developer's
  `is_developer()` check inside `has_project_access` already covers them
  regardless). `app/projects/projects-client.tsx`'s "+ New construction"
  button and each card's Rename/Delete buttons are now hidden for any
  other role (`canManageProjects`, computed in `app/projects/page.tsx`
  from the real `profiles.role`). Two side effects worth knowing about:
  converting a Buyers Guide deal into a construction
  (`app/deals/actions.ts`'s `convertDealToProject`) calls `createProject`
  under the hood, so that's now Developer/Contractor-only too, matching
  the same rule; and the Certificate of Occupancy tab's "Save address"
  field (`certificate-of-occupancy-client.tsx`) reuses `renameProject` to
  persist just the address, so it's now also gated the same way as a full
  rename — an Owner/PM filling in the property address there for a permit
  lookup will now see "Only a Developer or Contractor can manage
  constructions." This was a deliberate reading of "edit constructions" as
  covering the whole `projects` row, not just the Projects-list rename
  dialog specifically — if that address field should stay open to any
  project member instead, that's a one-line carve-out to make.
- **Bids tab, separate from Payments** — uploading, reviewing, and deciding
  on a bid is its own tab now; Payments only shows what you've already
  accepted. This split exists because not every uploaded bid is the one you
  go with — several competing bids often come in for the same scope, and
  only Payments' totals/tracking should reflect the one actually happening.
  `bids.status` (`pending` | `accepted` | `declined`, migration
  `022_bids_tab.sql`) drives it: `saveBid` (now in
  `app/projects/[id]/bids/actions.ts`) always inserts a new upload as
  `pending`; the Bids tab's page query excludes `accepted` (`.neq("status",
  "accepted")`) so an accepted bid disappears from Bids the moment it's
  accepted, while the Payments tab's query is the mirror image (`.eq("status",
  "accepted")`) — a bid only ever shows up on exactly one of the two tabs at
  a time. Bid PDFs are still read client-side with pdf.js first (upload
  happens on the Bids tab now); the *full* extracted text (not a truncated
  prefix) is sent to Claude, with the section around a detected "Payment
  Schedule" heading prioritized if the document is very long. Scanned/
  image-only PDFs fall back to sending rendered page images instead of text.
  - **Incoming bids** section lists every `pending` bid with Accept/
    Decline/Delete. Accepting calls `setBidStatus(..., "accepted")` and
    removes it from local state immediately (it now belongs on Payments);
    declining keeps the record in a collapsed "Declined bids" section
    (`<details>`) with Reconsider (back to `pending`) and Delete, rather
    than deleting it outright — useful for remembering which contractors
    you passed on and why. The public `/share/[token]` mirror was updated
    to the same `.eq("status", "accepted")` filter the Payments tab uses,
    so a link shared outside the team never surfaces bids still under
    internal review.
  - **"Evaluate bid"** (`/api/claude/evaluate-bid`) grounds a bid's price
    against typical market cost with a web search — the contractor, total,
    and line items (which are sometimes just payment draw stages like "50%
    deposit" with no real scope detail, in which case the prompt is told to
    infer scope from the contractor/trade instead and cap confidence
    accordingly) plus the project's address for regional cost calibration.
    Returns a verdict (`good_price`/`fair_price`/`high_price`), a
    confidence level, a typical cost range, and a short analysis — cached
    on the bid itself (`evaluation_*` columns, migration
    `021_bid_evaluation.sql`) via `saveBidEvaluation` so it doesn't need
    re-running every time the page reloads; "Re-evaluate" reruns it
    on demand.
  - **A saved (now accepted) bid's payment schedule stays editable** — a
    hover-revealed "Edit"/"Remove" per line plus a "+ Add item" button
    (`PaymentLineModal` in `payments-client.tsx`), for change orders and
    overages discovered after acceptance, not just typos caught during the
    original extraction review. Adding or editing a line adjusts the bid's
    `total_amount` by the same delta server-side
    (`addPaymentLine`/`updatePaymentLine`/`deletePaymentLine` in
    `app/projects/[id]/payments/actions.ts`) rather than recomputing it as
    a flat sum of every line — `total_amount` can legitimately differ from
    the extracted lines' sum from the start (the review step already warns
    about this without forcing them to match, since the contract's stated
    total is authoritative even when the schedule didn't extract perfectly
    cleanly), so a delta preserves whatever that original gap was instead
    of silently erasing it the moment someone adds one overage line. Each
    action re-reads the bid's current total and writes back total ± delta
    (no DB transaction — consistent with the rest of this app's server
    actions, and fine for a single-admin-editing-at-a-time tool) and
    returns the new total so the client can update its local `bids` state
    immediately rather than waiting on `revalidatePath`.
- **Accounting tab** (per-project, next to Payments — migration
  `040_bank_transactions.sql`; labeled "Bank Transactions" until this tab grew
  the manual-entry/category/P&L features below and "Accounting" became the
  more accurate name — the slug, table, route, and file paths all stayed
  `bank-transactions`/`bank_transactions` to avoid a tab-permissions
  migration and broken bookmarks, so that name still appears throughout the
  code and this doc) — upload a bank-exported CSV of transactions
  and reconcile them against bids: how much has actually gone out the door,
  matched to which contractor. Parsing is entirely deterministic
  (`lib/bankCsv.ts`, unit-tested in `lib/bankCsv.test.ts`) — a CSV is
  already structured tabular data, unlike a bid PDF or inspection photo, so
  no AI call is involved; the real problem is that every bank names (and
  orders) its columns differently. The parser recognizes a single signed
  Amount column, separate Debit/Credit columns (extra columns like a
  running balance are ignored), and the common header aliases for each
  (date/posting date, description/memo/payee, debit/withdrawal,
  credit/deposit, etc.), plus falls back to Wells Fargo's well-known
  headerless 5-column layout (Date, Amount, \*, \*, Description) when no
  header row is recognized. Rows that don't parse (blank lines, footer/
  subtotal rows) are silently skipped and counted, not treated as errors.
  - **Import flow** — the file is read client-side (`FileReader`, no
    upload/storage needed — only the parsed rows are kept, not the
    original file) into a preview table before committing anything, so a
    misrecognized column layout is obvious before it's saved. "Import N
    transactions" then calls `importBankTransactions`
    (`app/projects/[id]/bank-transactions/actions.ts`), which upserts with
    `ignoreDuplicates: true` against a unique index on `(project_id,
    txn_date, description, amount, type)` — re-importing a statement with
    an overlapping date range (a common habit — "this month plus last
    month" to be safe) silently skips the transactions already on file
    instead of duplicating them, and the returned duplicate count is
    surfaced in the success toast so that's visible rather than silent.
    "Undo" a whole import at once by its source filename
    (`deleteBankTransactionsBySource`) rather than deleting rows one at a
    time if the wrong file gets uploaded.
  - **Matching to a bid** — each transaction gets an optional `bid_id`
    (nullable FK, `on delete set null`), settable per-row from a dropdown
    of that project's non-declined bids. "Auto-match by contractor name"
    (`autoMatchTransactions`) is a second, cheap deterministic pass (still
    no AI): an unmatched transaction whose description contains exactly
    one bid's contractor name gets linked automatically; an ambiguous
    description (matching more than one contractor, or none) is left for
    a person to assign by hand rather than guessing wrong. A "Paid vs.
    bid, by contractor" summary sums matched debit transactions per bid
    against that bid's `total_amount` to show what's actually been paid
    and what's left — this is a separate, transaction-grounded number from
    Payments' planned/checked-off payment schedule, not a replacement for
    it.
  - **Filter and select, each with their own running total** — a search-
    by-description box plus type (paid out/received), bid, category, and
    "In P&L" / "Not in P&L" filters narrow the table, and a running total
    (paid out / received / net) for whatever's currently showing updates
    live as those filters change, with no selection needed. The category
    filter (all / uncategorized / a specific category) and the P&L-status
    filter compose with the rest, so "everything tagged Construction Cost
    that isn't in the P&L yet" is one combination of dropdowns, not a
    separate view. Checking rows (a per-row checkbox,
    plus a header checkbox that selects/deselects everything currently
    filtered) shows a second, visually distinct running total scoped to
    just the checked rows — selection persists across filter changes (so
    filtering down, selecting a few, then clearing the filter doesn't
    lose the selection) since it's tracked as its own `Set<string>` of
    ids rather than derived from the visible rows. The CSV upload preview
    (before anything's imported) has its own independent description filter
    and running total for the same reason — reviewing a big statement
    before committing to import benefits from the same narrow-and-check
    as the saved ledger does, but nothing in the preview is filtered OUT
    of the import itself; it's a review aid, not a selection mechanism.
  - **`lib/bankCsv.ts` matches column headers by alias priority, not
    leftmost column** — some banks export both a real "Description" column
    and a separate "Detail"/"Details" column (a transaction-type code like
    "DEBIT"/"ACH_DEBIT"), and the original leftmost-match logic could pick
    up "Details" instead of "Description" if it happened to come first in
    the file. `findColumn` now checks each alias in priority order
    (`description` first) and returns the first column matching that
    specific alias, rather than the first column matching *any* alias in
    header order — so "Description" always wins regardless of column
    order, and "detail(s)" was removed from the alias list entirely since
    it's never the column that actually matters. Covered by a regression
    test (`lib/bankCsv.test.ts`) with both columns present.
  - **CSV import preview: check/uncheck rows before importing, with its own
    running total** — everything found is checked by default (matching the
    original all-or-nothing import), but unchecking a row (or filtering
    down with the description search and unchecking a batch via the
    header checkbox) excludes just that row — for a personal charge mixed
    into an otherwise-business account, say. A second, emphasized running
    total ("N of M will be imported") tracks the *included* set live and
    independently of the filter's own total, and only those rows are sent
    to `importBankTransactions`.
  - **Categories, manual entries, and a Profit & Loss statement** (migration
    `041_bank_transaction_categories.sql` adds `category`; migration
    `042_bank_transaction_pl_flag.sql` adds `include_in_pl`) — built for tax
    prep specifically. Every transaction, imported or not, can be tagged
    with a category from a small fixed list (`lib/bankCategories.ts`:
    Property Value, Construction Cost, and Property Tax lead the list — the
    three actually used day to day — followed by Materials, Labor/
    Subcontractors, Permits & Fees, Insurance, Financing/Interest,
    Utilities, Professional Fees, Selling Costs, Sale Proceeds/Revenue,
    Loan Proceeds, Other, for anyone who wants a more granular construction-
    cost breakdown than one lump line) — fixed rather than
    free text specifically *because* it's accounting, not a creative field:
    free text would let "Materials"/"materials"/"material costs" fragment
    into three separate P&L lines instead of grouping into one. "+ Add
    manual entry" inserts a row directly (`addManualTransaction`) for
    anything that never hits a bank statement — a cash payment, a cost
    folded into a closing statement the bank CSV won't itemize, etc. — with
    `source_file_name` left null, which is also how the table tells it
    apart from an imported row (a small "Manual" badge next to the
    description).
    - **The P&L only sums rows explicitly marked `include_in_pl`, never
      "everything imported."** A bank feed's debits aren't all real
      expenses (a transfer between the owner's own accounts, a loan
      principal payment) — so nothing counts by default for CSV-imported
      rows (`include_in_pl` defaults `false`) until a person checks "In
      P&L" on it. Marking happens per row, or in bulk over whatever's
      currently selected (the same multi-select checkboxes/running-total
      mechanism the browse table already has, so filtering down to, say,
      one category or contractor first and then bulk-marking the result is
      the normal workflow) via "Add selected to P&L"/"Remove selected from
      P&L" (`setTransactionsIncludeInPl`). A manual entry defaults to
      *checked* instead, on the theory that a single deliberate action
      (unlike unreviewed bulk CSV data) is usually meant to count. The same
      selected-rows bar carries a "Set category…" dropdown
      (`setTransactionsCategory`) for bulk-categorizing that same
      filter-then-select batch in one action, instead of picking a category
      from each row's own dropdown one at a time — e.g. filter to one
      contractor's transactions, select all, and tag every one
      "Construction Cost" in a single pick.
    - The P&L table itself groups whatever's marked in by category into a
      Paid out/Received/Net table with a grand total row, scoped to one
      calendar year at a time via a year dropdown (derived from whatever
      years actually appear in `txn_date`) or "All time" — so it's directly
      comparable year over year the way a return needs to be. It's a plain
      computed summary of what's marked, explicitly not tax advice — the
      UI says so, since what's capitalized vs. deductible and how a given
      cost should actually be treated is a question for whoever prepares
      the return. "Export ledger to CSV" (a client-built CSV, same
      Blob-download technique used elsewhere in the app) hands the full
      ledger — date, description, category, type, amount, in-P&L flag,
      matched bid, source — to that person directly rather than requiring
      them to re-type it from the screen.
    - **"Generate expense chart"** (`ExpenseBreakdownChart`, opt-in — a
      button next to the table, off by default) is a concise horizontal bar
      chart of the same P&L numbers, ranked largest category first, scoped
      to the same year selector. Built the way the dataviz skill's method
      works out for this job: the data's job is "compare magnitude across
      categories," which calls for one fixed hue rather than a per-bar
      color ramp — coloring each bar darker by its *own* amount would
      double-encode the length the bar already shows, and fails for nominal
      (unordered) categories exactly like a value-ramp on nominal data
      always does. So every bar is the same red (the color "paid out"
      already wears everywhere else in this tab), and only bar *length* and
      the direct dollar labels on the axis carry magnitude — no legend
      needed since there's one series and each bar already names its own
      category. Marks match the app's existing table conventions: 24px-
      thick bars, 4px rounded corner at the far end (square at the origin),
      a light `bg-concrete` track behind each bar so relative length reads
      at a glance. No new dependency — it's plain flex/div bars sized by
      `width: %`, not a charting library. The P&L table right below it is
      this chart's exact table-view twin (identical numbers), so nothing
      shown in the chart is chart-only.
    - **"Export detailed PDF for CPA"** (`lib/bankTransactionsPdf.tsx` +
      `app/api/projects/[id]/bank-transactions/pnl-pdf/route.ts`) turns the
      same P&L numbers into a print-ready document instead of a screen the
      preparer has to transcribe from. It's a route handler, not a server
      action, since it streams back a `Content-Type: application/pdf` blob
      (same `@react-pdf/renderer` + base-14-font-only approach as the House
      Book PDF, including the identical literal-subpath-import workaround
      for pdfkit's standard fonts — see the comment in `lib/houseBookPdf.tsx`
      for why that trick is needed at all). The route re-queries
      `bank_transactions` itself scoped to `project_id` and
      `include_in_pl = true` (and to the requested year, if any) rather than
      trusting a client-computed list — the same reasoning as the House
      Book route re-scoping every id list it's handed. The PDF has two
      pages: a summary page (total expenses/revenue/net as three stat
      tiles, the same expense-breakdown bar chart re-rendered as PDF
      `View`s at the same red-on-`#eef1f3`-track styling as the on-screen
      chart, and the category summary table) and a detail page listing
      every underlying transaction — date, description, matched
      contractor, source (a file name, or "Manual entry" for an audit
      trail), and signed amount — grouped by category with a per-category
      subtotal and a grand total, in the same category order as the
      summary table above it so the two pages never disagree. This is
      deliberately the app's own accounting colors (the red/sage/blueprint
      already used for paid-out/received/net everywhere in this tab) rather
      than the House Book's decorative gold-and-navy "keepsake" palette,
      since a P&L handed to a CPA is a working document, not a memento. The
      button lives right next to "Generate expense chart" and is scoped to
      whatever year is currently selected — "All time" or a specific year —
      so the exported PDF always matches what's on screen.
- **In-app modals** — `window.prompt()`/`confirm()` are avoided everywhere
  in favor of the `Modal`/`ConfirmDialog` components, since those browser
  APIs are blocked in sandboxed/iframe contexts.
- **Finish ID** — a universal section (a second tab on the top-level
  Interior Design page, not scoped to any one construction) — upload any
  photo/screenshot and Claude (vision) identifies the finishes shown; a
  "Find real product match" action per item uses Claude's server-side web
  search tool to ground the guess in a real brand/model/price/link. Once
  identified, checked items get sent to a specific construction's room via a
  project → room picker right there, rather than requiring a construction to
  already be selected before scanning — `finish_scans` (created_by, RLS:
  any signed-in user can see every scan, only its own creator or a Developer
  can change/remove it — same shape as the shared `subcontractors`
  directory) is separate from `finishes`, which is still per-room.
- **Sharing** — each construction has a "Share" button that issues a random,
  revocable token for a public `/share/[token]` page — a full read-only
  mirror of the project, no account needed. That page is served by a
  service-role admin client (`lib/supabase/admin.ts`) that looks the token
  up server-side, entirely bypassing RLS for that one path; the browser
  never gets a Supabase key capable of reading other users' data.
- **Buyers Guide tab** (top-level, not per-project) — paste in a specific
  listing to research. Pasting the URL (Zillow, Redfin, etc.) and clicking
  "Look up listing" fills in the address/price/beds/baths/sqft/lot
  size/year built for review before saving — Claude never fetches the URL
  itself (most listing sites block that), it parses the address out of the
  URL text and grounds the rest with web search, same as
  `lookup-property-details`. Manual entry is still there as a fallback if
  the lookup can't find something. Running an analysis estimates construction cost
  from square footage at an editable $/sqft rate, then uses Claude with web
  search to find the property's current as-is value AND comps (recently
  sold, prioritizing renovated/new-construction comps) and estimate the
  after-repair/rebuild value (ARV). The buy/pass verdict and profit margin
  are computed deterministically from those numbers, not left to the model
  — profit deducts an estimated ~7% of ARV for selling costs (agent
  commission + closing), disclosed in the analysis's "COST ASSUMPTIONS"
  section. A pursued deal converts into a real construction project with
  one click. Every Claude web-search tool call in this app (Buyers Guide,
  Finish ID's product match, Construction Cost) deliberately uses the
  **basic** `web_search_20250305` tool type, not the newer sandboxed
  variant — that one took 60-90+ seconds in testing (routes searches
  through a server-side Python sandbox), well past a serverless function's
  timeout.
  - **RentCast removed** — this tab originally used the RentCast API for two
    things: a ZIP-code "browse homes for sale" grid, and a pre-fetched
    AVM/comps lookup feeding into the ARV analysis above. RentCast's paid
    tiers ($74-449/mo past the 50-request free tier) weren't worth carrying
    for a feature this app already had a cheaper alternative for — Claude
    web search, the same pattern already used for the "paste a listing URL"
    lookup, zoning lookup, and property-detail lookup elsewhere in this tab.
    The ZIP-browse grid is gone entirely (no replacement — paste a listing
    URL instead), and `evaluate-deal`'s current-value-estimate and comps are
    now 100% Claude web search rather than a RentCast-plus-web-search blend.
    `lib/rentcast.ts`, `app/api/rentcast/search/`, and `saveDeal` (the
    ZIP-grid's save action — `saveManualDeal`, used by the URL/manual flow,
    is unaffected) are deleted; no `RENTCAST_API_KEY` is needed anymore.
- **Buyers Guide ground-up rebuild calculator** — the zone field is a
  dropdown of LA (LAMC) residential zones (`lib/laZoning.ts`), with an
  "Other" fallback for anything not listed. "Look up %" grounds a
  max-lot-coverage-percentage estimate for the selected zone in a web
  search (`/api/claude/lookup-zoning-coverage`).
  - **Lot-size-dependent zones now actually use the lot size.** R1 and its
    variants (RS, RE9-RE40, RW1, RZ) aren't a flat percentage — LAMC
    12.21.1-A,10's Residential Floor Area sliding scale sets max buildable
    floor area from a table keyed to lot square footage, so the same zone
    can correctly return very different percentages for a 5,000 sqft lot
    vs. a 15,000 sqft one. The lookup used to ignore lot size entirely
    (never sent it to the route at all) and hand back one generic
    "medium confidence" number regardless of lot size — technically
    labeled as an estimate, but silently wrong for any lot whose actual
    tier differed from whatever the model defaulted to. Now the route
    takes `lot_size` in the request (the client sends whatever's in the
    Lot size field) and the system prompt requires it: for a
    lot-size-dependent zone, it searches for the real sliding-scale table
    and computes the percentage for that specific lot size (assuming a
    standard, non-hillside lot, with a note to confirm on ZIMAS if the
    parcel might be hillside — hillside status isn't derivable from an
    address); a zone that isn't lot-size-dependent (R2, RD1.5-RD6, R3, R4,
    RAS3/4, R5) is unaffected and still gets its normal flat percentage.
    The route also now returns `lot_size_dependent: boolean` so the UI can
    tell the user up front — the "Look up %" button is disabled until a
    lot size is entered, rather than silently producing a number that
    can't be correct for a sliding-scale zone without one. Verified
    against the real API: R1 with a lot size now comes back with a
    lot-size-specific percentage and high/medium confidence depending on
    how directly the sliding-scale table was sourced, while RD1.5 (flat
    coverage, not lot-size-dependent) is unaffected either way.

  Remodel and ground-up scopes each keep their own manually-entered $/sqft and construction budget
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
  The same "Check all"/individual checkboxes used for the bulk-zip download
  also drive a **"Delete selected"** button (`deleteProjectFiles` in
  `app/projects/[id]/files/actions.ts`) — a single query
  (`.in("id", ids).is("source_table", null)`) that deletes whichever
  checked files are directly-uploaded and silently leaves any auto-mirrored
  ones checked alone (same restriction as the single-file Remove button,
  applied in bulk); the confirmation dialog and the resulting toast both
  say up front how many of the selection will actually be deleted vs.
  skipped, so it's never a surprise. Selection is the same persisted set
  used elsewhere (`usePersistedSelection`), so it survives the category
  filter and tab switches.
  - **Auto-mirrored files are hidden by default, not just non-deletable.**
    Every file mirrored in from another tab was always shown alongside
    directly-uploaded ones, with delete silently skipping the ones it
    couldn't touch — in practice this read as "delete isn't working" when
    a selection was mostly (or entirely) auto-mirrored files. Now they're
    hidden by default (`showAutoMirrored` in `files-client.tsx`, off by
    default) so what's on screen — and what "Check all"/"Delete selected"
    act on — is always exactly what can actually be deleted from here. A
    checkbox ("Also show N files from other tabs (view-only)") brings them
    back for browsing everything in one place, this tab's original
    purpose — genuinely view-only there, no delete button shown for them
    even when visible, so there's no ambiguity about what a given checked
    box will do.
  - **A multi-page plan shows as one row, not one per page.** The Plan tab
    stores a multi-page PDF as one rendered image per sheet (needed there —
    per-page room detection, per-page layout flags), each labeled
    `"<file name> — Page N"`, and each mirrors into `project_files`
    individually like any other upload. Browsing 12 separate rows for a
    single 12-page plan in the Files tab was exactly the clutter this fixes
    — purely a display grouping (`groupPlanPages` in `files-client.tsx`),
    nothing about the underlying storage/Plan-tab behavior changes: rows
    whose label matches that `"— Page N"` pattern collapse into one card
    (cover thumbnail from the first page, a "N pages" badge, one "Download
    all pages" button that zips just that group's page images via the
    existing bulk-zip endpoint). Checking a group's checkbox selects all of
    its underlying pages for the regular bulk download/delete actions — the
    grouping is display-only, so those still operate on real per-page
    files. A single-page PDF's label never gets the `"— Page N"` suffix in
    the first place, so it already showed as one row before this and is
    unaffected.
  - **In-app viewer for plans, bids, and photos.** Every row (and plan
    group) with an image or PDF now shows a **View** button/clickable
    thumbnail that opens `FileViewerModal` — a full-screen overlay, not the
    shared `Modal` component (its card chrome doesn't fit a full-bleed
    viewer) — instead of forcing a download just to look at a file. Images
    render directly, at up to 85vh, with zoom controls (`+`/`-`/reset
    buttons, `+`/`-` keyboard shortcuts, 50%–400%, resets when you move to
    another page) applied via a CSS `scale()` transform, panning by
    scrolling the overlay once zoomed past what fits. Opening a plan group
    opens its viewer already carrying every page (in the same
    already-sorted reading order the "N pages" grouping produces) with
    Prev/Next controls and arrow-key navigation between them. A file type
    that isn't an image or a PDF has no View button — a "can't preview,
    use Download" message covers it in case the modal is still reached via
    another path. Download and Close stay available at the top at all
    times.
    - **PDFs (bid files, stored as the original PDF) render via
      `pdfjs-dist`, not an `<iframe>`.** An `<iframe src={pdfUrl}>` defers
      to the browser's own PDF viewer, which on mobile Safari/Chrome shows
      only page one with no way to reach the rest, and opens at whatever
      zoom level that viewer defaults to rather than fit-to-width — both
      reported directly against the first version of this feature. Instead
      `PdfViewer` fetches the file through the existing same-origin
      download proxy (a script `fetch()` of the public Supabase Storage
      URL would be subject to CORS, unlike a plain `<img>`/`<iframe>`
      embed of it), loads it with the same `pdfjs-dist` library the Plan
      tab already uses to rasterize PDF pages, and renders every page as
      its own canvas stacked vertically — all pages visible up front,
      scrollable, sized to fit the overlay's width at zoom 100% (each
      canvas is rendered once at 2x that fit width for retina sharpness,
      then just resized via CSS on every zoom click rather than
      re-rendering the PDF each time, so zoom stays instant).
- **Roles & permissions** — every account has a login type: Owner, PM,
  Contractor, or Developer (`profiles.role`, set at sign-up and stored via a
  trigger on `auth.users`; `imranyousuf86@gmail.com` is seeded as Developer
  by `supabase/migrations/012_permissions.sql`). Developer is an admin role,
  granted either by an existing Developer directly changing someone's role
  from the **Admin** page's Users section, or by inviting them as
  "Developer" (see below) — not selectable at sign-up. Only a Developer can
  invite someone onto a construction — the "Invite" button next to "Share"
  on a project page (Developer-only) creates a `project_invites` row with a
  role and a one-time link, and tries to email it automatically via
  Supabase Auth's `admin.inviteUserByEmail` (`app/projects/[id]/invite-actions.ts`).
  That only works for an email with no existing account — it's how GoTrue's
  invite flow is designed — and it depends on the Supabase project actually
  being able to send email: Supabase's own built-in sender works out of the
  box but is rate-limited to a handful of emails/hour, so anything beyond
  testing needs a custom SMTP provider configured under **Authentication →
  Emails → SMTP Settings** in the Supabase dashboard. Either way, sending
  never blocks creating the invite — if the email doesn't go through (already
  has an account, no SMTP configured, rate-limited), the modal says so and
  the Developer copies the link and sends it manually instead; the link
  always works regardless of whether the email did.

  **Important Supabase dashboard setup**: Supabase's stock "Invite user"
  email template (Authentication → Email Templates) links straight to
  `{{ .SiteURL }}` with the session in the URL *fragment*
  (`#access_token=...`) rather than through this app's `/auth/confirm`
  route the way Magic Link/Signup do — clicking it authenticates the
  browser, but skips the app-level join logic that creates the
  `project_members` row, so it looks like the invite silently did nothing
  and the person just lands on the main page. `app/invite/[token]/hash-session-bridge.tsx`
  works around this — it's what actually appears first when someone clicks
  an unmodified invite email: it picks the tokens out of the fragment
  client-side, turns them into a real cookie session, then reloads so the
  server-side join logic runs. For a cleaner flow (and so Redirect URLs
  restrictions don't reject `redirectTo`), update the "Invite user"
  template to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next={{ .RedirectTo }}`
  (matching the other templates) and add `/invite/*` to **Authentication →
  URL Configuration → Redirect URLs**. An invited account also has no
  password at all (`admin.inviteUserByEmail` creates it without one), so
  accepting an invite always routes through `/set-password` next — an
  optional, skippable "set a password so you can sign in directly next
  time" step (`app/set-password/`) — before landing in the project.
  The invitee accepts the invite itself at `/invite/[token]` once signed in
  with the matching email, which creates a `project_members` row for them;
  inviting someone as
  "Developer" specifically also promotes their account (`profiles.role`),
  since Developer is an admin role, not a per-project one — they get full
  access everywhere and the Admin page, not just that one project. From the
  Admin page a Developer can also edit the **tab permission matrix** —
  which sections each role can see, covering both the per-project tabs
  (Plan, Rooms, Checklist, Budget, Bids, Payments, Accounting, Files,
  Certificate of Occupancy, House Book, Chat, Warranty Request) and the
  top-level tabs (Buyers Guide/`deals`, Interior Design, Construction Cost,
  Landscape, Subcontractors) — Finish ID no
  longer has its own row here since it's nested under Interior Design's
  own permission instead; Developer itself always has
  every tab regardless of that table. Every RLS policy that used to check
  `projects.user_id = auth.uid()` now goes through a
  `has_project_access(project_id)` SQL helper that also allows a
  `project_members` row or a Developer account, so an invited PM/Contractor
  actually gets real data access to a project, not just a visible shell.
  Tab-permission enforcement itself (which tabs/pages render or redirect)
  happens in the app layer — `app/projects/[id]/layout.tsx` +
  `TabAccessGuard` for the per-project tabs, `app/deals/layout.tsx` for
  Buyers Guide — not RLS: RLS controls data access, the tab matrix controls
  which pages a role is shown (including whether "Buyers Guide" even
  appears in the top nav, via `TopNav`'s `showDeals` prop). The Admin
  page's Users section also has a **Delete** button per user
  (`app/admin/actions.ts`'s `deleteUser`, using
  `admin.auth.admin.deleteUser`) — it's blocked for your own account and
  for the last remaining Developer, and the confirmation dialog calls out
  up front if the account owns any constructions, since deleting a
  project's owner cascades to permanently delete everything they own too
  (`projects.user_id references auth.users(id) on delete cascade`), not
  just their profile. A **Reset password** button per user
  (`app/admin/actions.ts`'s `resetUserPassword`, `ResetPasswordModal` in
  `app/admin/admin-client.tsx`) sets a new password directly via
  `admin.auth.admin.updateUserById` — no email, current password, or
  action from the account owner required, unlike the self-service
  `/set-password` flow (which needs an authenticated session as *that*
  user, which a Developer resetting someone else's password doesn't
  have). The modal has a "Generate a random password" button (avoids
  visually-ambiguous characters — no 0/O or 1/l/I) and a copy button on
  the result, since the new password is shown back only once — the
  Developer has to relay it to the account owner themselves; there's no
  server-side record of it afterward beyond the hash Supabase stores.
- **Create account, and per-account tab-permission overrides** (migration
  `043_user_tab_permissions.sql`) — a **Create account** form on the Admin
  page (`app/admin/admin-client.tsx`'s `CreateAccountSection`,
  `app/admin/actions.ts`'s `createAccount`) makes an account directly —
  email, password, role, and a "Test account" checkbox — skipping the
  public `/login` sign-up form and its pending-approval queue entirely
  (role and `status: "approved"` are passed as auth `user_metadata`, which
  `handle_new_user()`'s trigger already reads when inserting the `profiles`
  row — the exact same mechanism `invite-actions.ts`'s
  `inviteUserByEmail` uses to pre-approve an invited account, just with a
  password set up front here instead of an emailed sign-in link, via
  `admin.auth.admin.createUser({ email_confirm: true, ... })` so it can be
  signed into immediately). Two use cases in one form: a throwaway **test
  account** to see exactly what a role looks like from the inside (as
  opposed to the Developer's own "Preview as another role," which only
  simulates a role in the abstract for the Developer's own session — a real
  second account is the only way to see what warranty-request notification
  emails, chat as a non-owner, etc. actually look like), or a real account
  handed to a specific person. "Test account" just sets `profiles.is_test`
  — a label (a small "Test" badge next to that row in the Users list below)
  with no effect on access or behavior, there purely so throwaway accounts
  are easy to tell apart from real ones at a glance.
  - **Per-account permission overrides** — every user row also gets a
    **Permissions** button (badge-counted when it has any overrides set)
    opening `UserPermissionsModal`: every tab from `ALL_TABS`, each with a
    Default/Allowed/Blocked selector, auto-saving on change
    (`updateUserTabPermission`) the same way the role-wide matrix above
    auto-saves its own checkboxes. "Default" defers to whatever that role's
    row in the Tab permissions matrix says; "Allowed"/"Blocked" pins this
    one tab for this one account regardless of future changes to that
    matrix or what every other account of the same role sees — this is
    what actually answers "specific permissions for this account," letting
    a test account try a narrower or wider slice of a role's tabs (or a
    real person get one extra/fewer tab) without touching the shared
    matrix everyone else of that role relies on. Backed by a new
    `user_tab_permissions (user_id, tab, allowed)` table —
    `getAllowedTabSlugs` (`lib/permissions-server.ts`) now takes an
    optional `userId` and, when passed (every call site passes the real
    signed-in user's own id — not a Developer's previewed role, since
    per-user overrides only matter to the actual account they're set on),
    computes the role's own baseline exactly as before, then layers any
    per-tab override from `user_tab_permissions` on top *of that baseline*
    rather than recomputing the whole allow/deny decision from a merged
    dataset — this matters specifically so a single override for one tab
    can never accidentally flip the existing "role has zero configured
    rows → deny everything" fail-closed guard open for every *other* tab
    the account wasn't explicitly granted. A Developer account is
    unaffected by any of this and always has every tab, same invariant as
    the role matrix.
  - **Assigning an account (created or pre-existing) to a construction** —
    `app/projects/[id]/invite-actions.ts`'s `addProjectMember` grants an
    existing account access to a specific construction directly: no invite
    token, email, or acceptance step, since (unlike the "Projects &
    invites" section's `sendProjectInvite`, built for someone who may not
    have an account yet) this account already exists with known
    credentials, and a Developer choosing to assign it here has already
    made the access decision — the same `is_developer()` check that
    already lets `project_members_insert`'s RLS policy bypass its normal
    "must accept your own pending invite" rule. Reachable two ways: an
    "Assign to construction (optional)" picker right on the Create account
    form itself (assigns immediately after the account is made, using that
    same role, so a test/managed account can be fully set up — credentials
    plus construction access — in one step), and a **Projects** button on
    every existing user row opening `UserProjectsModal`
    (`listMembershipsForUser` for the reverse lookup — every construction
    a given account belongs to, complementing `listProjectInvitesAndMembers`'s
    per-*project* member list used by "Projects & invites" below) to assign
    or remove constructions for that account at any time afterward, with
    its own role picker per assignment (independent of the account's own
    `profiles.role` — a `project_members.role` can differ per project, same
    as an emailed invite always could). `addProjectMember` upserts on
    `(project_id, user_id)` rather than a bare insert, so re-assigning
    someone already a member just updates their role instead of erroring
    on the unique constraint.
- **Preview as another role** — a "Preview as another role" picker on the
  **Admin** page (`app/admin/admin-client.tsx`'s `PreviewRoleSection`),
  visible only to a real Developer account, lets you browse the rest of
  the app as Owner/PM/Contractor would see it (which tabs render, whether
  Buyers Guide/Interior Design even show up in the nav) without creating a
  second test account or touching your real role. It's a session cookie
  (`PREVIEW_ROLE_COOKIE` in `lib/permissions.ts`, set by
  `app/admin/preview-actions.ts`'s `setPreviewRole`, only honored server-side
  for a caller whose real `profiles.role` is already "developer") that
  `getCurrentUser()` (`lib/permissions-server.ts`) swaps in for the
  effective role everywhere tab visibility is computed. It's UI-only:
  RLS/`has_project_access()` still check the real stored `profiles.role`,
  so a previewing Developer keeps full underlying data access regardless
  of what's shown — this tests *visibility*, not a real security boundary.
  The Admin page's own guard deliberately checks the real account role
  (`currentUser.isDeveloper`), not the previewed one, so Admin — and the
  picker itself — always stays reachable no matter what you're previewing;
  otherwise turning on a preview from Admin would immediately lock you out
  of the one page that can turn it back off. Clears itself when the
  browser session ends, or by picking "Not previewing" in the same
  section.
  - **Fixed: the nav's own Admin link used to disappear while previewing,**
    even though the page itself was always reachable by URL. Every other
    page passed `showAdmin={currentUser?.role === "developer"}` to
    `TopNav` — reading the *effective* (possibly previewed) role, not
    `isDeveloper` like the Admin page's own guard does — so as soon as a
    Developer previewed as Owner/PM/Contractor, the Admin link vanished
    from every page's nav except Admin itself. A Developer who navigated
    away after starting a preview (or landed on any other page first) had
    no visible way back to turn it off, only the fix of knowing to type
    `/admin` directly. All five call sites (`app/projects/page.tsx`,
    `app/deals/page.tsx`, `app/interior-design/page.tsx`,
    `app/construction-cost/page.tsx`, `app/subcontractors/page.tsx`) now
    pass `showAdmin={currentUser?.isDeveloper}` instead, matching what the
    Admin page's own guard already did — so the one page that can exit a
    preview is reachable from the nav on every page, always, regardless of
    what's being previewed. The Admin page's header was also missing a
    Sign out button entirely (every other top-level page has one) — added
    to match, so getting stuck previewing on that page specifically no
    longer also meant being unable to sign out from it.
- **Access requests** — signing up at `/login` no longer grants access by
  itself. `profiles.status` (`pending` / `approved` / `rejected`, migration
  `016_access_requests.sql`) gates the whole app: `handle_new_user()`
  inserts every new self-service signup as `pending`, and
  `lib/supabase/middleware.ts` — the one place every route already passes
  through for the signed-in-or-not check — redirects any signed-in user
  whose status isn't `approved` to `/pending-approval` (a simple "awaiting
  approval"/"declined" holding page with just a sign-out button) before
  they can reach anything else, `/admin` included. A Developer reviews the
  queue from a new **Access requests** section at the top of the Admin page
  (`app/admin/admin-client.tsx`'s `AccessRequestsSection`) — it only
  renders when there's something to review, listing each pending signup's
  email and chosen login type with **Approve**/**Decline** buttons
  (`app/admin/actions.ts`'s `updateUserStatus`, Developer-only both in the
  action and via the `profiles_update` RLS policy). The Users section below
  it also gets a status column/dropdown so a Developer can revoke access
  from someone already approved (set them back to Pending or Declined) —
  disabled for your own row so you can't lock yourself out. Two paths skip
  the queue entirely and land straight on `approved`: the bootstrap
  Developer email (`imranyousuf86@gmail.com`, same special-case the schema
  already had for the `role` column), and anyone brought in through the
  existing **Admin → Projects & invites** flow — a Developer sending that
  invite (`app/projects/[id]/invite-actions.ts`'s `sendProjectInvite`) is
  itself the access decision, so it now passes `data: { status: "approved"
  }` into `admin.inviteUserByEmail`, which `handle_new_user()` reads out of
  `raw_user_meta_data` before falling back to `pending`. Existing accounts
  from before this migration are grandfathered straight to `approved` so
  nobody already using the app gets locked out by it.
- **Finish ID's product search** — sends the actual scan photo alongside the
  text description to Claude (vision + web search in one call), and is
  explicitly instructed to cross-check each search result's own product
  photos against the real photo rather than matching on the text label
  alone, downgrading or dropping results that don't actually look right.
  Adding a matched product with a price to a room auto-creates a budget line
  for it (`budgeted` = found price, `actual` = 0, linked via
  `budget_items.finish_id`), marked with a "finish" badge on the Budget tab;
  deleting that finish removes the budget line it created.
- **Numeric text fields no longer stick a leading zero when you type over a
  0.** Several `type="number"` fields keep their value as a plain string
  rather than a parsed number — deliberately, so an empty field can mean
  "no value" instead of being coerced to 0, and so typing a trailing decimal
  point mid-entry doesn't get stripped. That's most editable dollar/measure
  fields seeded from an existing 0 (a budget item's "Actual" before any
  money's spent, a bid review's total when extraction found nothing, a
  finish price, beds/baths/etc. on a manually-entered deal): the field
  displays "0", and typing a digit after it without first clearing it
  produces "05" at the DOM level — since the state was a raw un-reparsed
  string, nothing ever cleaned that back up, so it stuck permanently
  instead of being a one-frame glitch. Fixed with a shared
  `stripLeadingZero` helper (`lib/numberInput.ts`) run on every keystroke
  in the affected fields' `onChange` — strips a redundant leading zero
  before another digit while leaving a deliberate one before a decimal
  point ("0.5") alone — plus `onFocus={(e) => e.target.select()}` added to
  every numeric input in the app (including the ones already storing a
  parsed `Number`, which weren't actually sticking but benefit from the
  same "typing replaces the old value" UX) so clicking into a prefilled
  number field selects it for overwriting instead of inserting at a cursor
  position next to existing digits.
- **`getAllowedTabSlugs` fails closed, not open** (`lib/permissions-server.ts`)
  — a role with zero configured `tab_permissions` rows (a query error, or a
  seeding migration that never ran) used to fall through to "nothing
  disallowed," silently granting that role every tab. `data` being `[]` is
  truthy, so `if (!data)` never caught it. Now both `null` and `[]` return
  no allowed tabs. Regression-tested in `lib/permissions-server.test.ts`.
- **Test suite** (`vitest`, `npm run test`) — this project had zero
  automated tests until now. `vitest.config.mts` resolves the `@/` path
  alias the same way `tsconfig.json` does; tests live next to the code
  they cover (`lib/anthropic.test.ts`, `lib/storage.test.ts`,
  `lib/permissions-server.test.ts`) rather than in a separate `__tests__`
  tree. This is a starting point, not full coverage — it covers `extractJson`
  (including a regression test for the brace-in-a-string bug fixed in
  commit `a1c223f`), the new signed-URL bucket/path parser, and the
  tab-permissions fail-closed fix above. Server Actions and RLS policies
  still have no automated coverage.
- **`npm run migrate`** (`scripts/migrate.mjs`) — every schema change up to
  this point required copying a `supabase/migrations/*.sql` file into the
  Supabase SQL editor by hand, which is exactly how migration 034 went
  unapplied and surfaced as a runtime "Could not find the table" error
  instead of a build-time one. This script connects directly to the
  project's Postgres database (`DATABASE_URL` — the direct connection on
  port 5432, not the pgbouncer pooler, since it wraps each file in a
  transaction) and applies whichever files in `supabase/migrations/` aren't
  yet recorded in a new `schema_migrations` table, in filename order.
  Leans on every migration in this project already being written
  idempotently (`create table if not exists`, `on conflict do nothing`,
  `drop constraint if exists` before re-adding it) rather than trying to
  guess which ones already ran on a project that predates
  `schema_migrations` existing at all — on first run it just replays
  everything, which is a safe no-op for anything already applied by hand.
  Still requires a one-time `DATABASE_URL` (see `.env.example`) and doesn't
  replace `supabase/schema.sql` for a brand-new project.
- **Rate limiting on the paid AI/image-gen routes** (`lib/rateLimit.ts`,
  migration `036_api_rate_limits.sql`) — nothing previously capped how many
  times a signed-in user could call an expensive route (image generation,
  web-search-grounded estimates), so a buggy client or a bad actor could
  run up real API bills with no limit. `enforceRateLimit(userId, route)`
  is a two-line guard dropped into every `app/api/claude/*` and
  `app/api/gemini/*` route (plus the House Book PDF's AI closing note)
  right after the existing `auth.getUser()` check; it counts each user's
  hits per route in a rolling hour window via the service-role admin
  client (backed by a table, not in-memory state, since serverless route
  handlers don't reliably share memory across instances) and returns a 429
  with a `Retry-After` header once the per-route limit is hit. Limits are
  generous for normal use (15-30 requests/hour depending on the route's
  cost) — see `RATE_LIMITS` in `lib/rateLimit.ts` to tune them. Fails open
  on a DB error, so an outage in the limiter itself never takes down the
  feature it's protecting. `app/api/subcontractors/check-license` and the
  Files Library's download/zip routes are deliberately excluded — no paid
  API call behind them.
- **Storage buckets are private; every file/photo URL is now signed**
  (`lib/storage.ts`, `lib/storageClient.ts`, migration
  `037_private_storage_buckets.sql`) — every one of the app's 8 Storage
  buckets (plan pages, room renderings, checklist/warranty photos, bid
  files, finish scans, the Files Library's generic uploads, interior
  design and landscape renders) was public, meaning anyone with a stored
  file's URL could read it with no authentication at all — a "public"
  bucket serves objects directly and never checks the storage.objects RLS
  policies for reads, so those policies (scoped to `(storage.foldername
  (name))[1] = auth.uid()`, the uploader's own folder) were silently doing
  nothing for anyone browsing the app normally. For a tool holding photos
  and documents of someone's home construction, that was real exposure.
  Every bucket is now private; a stored `storage_url` column still holds
  the exact same string an upload's `getPublicUrl(path)` call always
  produced — it's just a bucket+path encoder now, since that URL no longer
  resolves on its own. `lib/storage.ts`'s `signStorageUrl`/`signStorageUrls`/
  `signRowsUrl` parse the bucket+path back out of that string (`sign`-shaped
  URLs work too, so nothing needs to change if a value already came from a
  signed-URL call) and exchange it for a 24-hour signed URL, called from
  every Server Component/Server Action/API route that reads one of these
  columns before handing it to a client or fetching it server-side (the
  Files Library's ZIP/download proxy routes, the House Book PDF generator,
  the public `/share/[token]` page). Signing always uses the service-role
  admin client rather than the caller's own session — access control
  already happened at the DB row level (`has_project_access` RLS on
  whatever table the URL came from) by the time signing runs, and the
  per-bucket "owner" storage policies would otherwise lock every project
  member other than the original uploader out of a co-member's upload the
  moment the bucket went private. Every upload call site
  (`getPublicUrl` → `createSignedUrl`) was updated the same way, for the
  same reason applied in reverse: the uploader can always sign their own
  just-uploaded object (it's in their own folder), so the value saved to
  the DB and used for the immediate optimistic UI preview is a working URL
  from the moment it's created, not a broken image until the next full
  page load. Run migration 037 *after* deploying this app code — flipping
  the buckets first would break every image/file link in a still-running
  old deployment.
- **Append-only activity log** (`activity_log`, migration
  `038_activity_log.sql`, `lib/activityLog.ts`) — a "who did that?" trail
  for the actions most likely to matter in a dispute: deleting a warranty
  item or inspection report, approving/rejecting a warranty item request,
  accepting/declining/deleting a bid, removing a team member or revoking
  an invite, and deleting a file from the Files Library. Not a full audit
  of every mutation in the app (there are ~30 delete-shaped actions across
  every tab) — just the money/warranty/access-related ones, scoped
  deliberately rather than instrumenting everything. `logActivity` never
  throws (a logging failure shouldn't block the action it's describing)
  and there's no update/delete RLS policy on the table at all — only
  select/insert — since an audit log editable or erasable by its own
  author isn't an audit log. Deleting the construction itself isn't logged
  here: `activity_log.project_id` cascades on delete, which would take the
  project's own log entries down with it at the exact moment they'd matter
  most, and there's no separate account-level log this pass adds to fix
  that. No dedicated viewer UI yet — the table is there to query directly
  or build a page against later.
- **One-click unsubscribe on alert emails** (`app/api/alerts/unsubscribe/route.ts`)
  — every alert email now ends with an unsubscribe link scoped to that one
  subscription, using the subscription row's own id (a random uuid) as the
  token, the same "unguessable id in a public link" pattern
  `project_shares`/`project_invites` already use for their own tokens.
  Needs no sign-in (`middleware.ts` exempts this one path from the
  auth/approval gate, same as the public `/share/[token]` page) since
  whoever clicks it from their inbox is very likely not signed into that
  browser at all. What this pass didn't build: a scheduled digest/batching
  mode (an hourly or daily rollup instead of one email per event) — that
  needs a queue table and a scheduled job (Vercel Cron or a Supabase
  `pg_cron` job calling a new route), which is a bigger feature than an
  unsubscribe link. Today's mitigation is narrower: a bulk action (e.g.
  `addWarrantyItemsFromReport`) already sends one email per batch rather
  than one per item, which is the main realistic source of a rapid-fire
  sequence.
- **Chat and the Files Library are paginated, not fully loaded** — Chat's
  initial page load previously had a comment claiming "last 200 messages"
  but actually fetched the *oldest* 200 (`.order("created_at", {ascending:
  true}).limit(200)` returns the first 200 rows of that ascending order,
  not the most recent ones) — a real bug, fixed alongside adding
  pagination. The chat page now fetches the newest `CHAT_PAGE_SIZE` (50)
  messages, newest-first then reversed for display, with a "Load older
  messages" button (`loadOlderMessages` in `chat/actions.ts`) that
  cursor-paginates further back by `created_at` and restores scroll
  position relative to what was just prepended, rather than jumping the
  view. The Files Library similarly now loads the newest `FILES_PAGE_SIZE`
  (100) files with a "Load more files" button
  (`loadMoreProjectFiles`) appending older ones to the same list — its
  existing filter/search/bulk-select logic works unchanged since it
  operates over whatever's currently loaded into state. Page sizes live in
  `lib/pagination.ts` rather than the routes' own `"use server"` actions
  files, since a Server Actions module may only export async functions,
  not plain constants. Every other list in the app (checklist/warranty
  items, the projects list, room/finish lists) stays unpaginated — those
  are naturally bounded by the physical scope of one house or how many
  constructions a single account manages, not a realistic growth risk the
  way an ever-accumulating chat thread or file library is.
- **Room/exterior image generation moved from OpenAI to Google Gemini**
  (`lib/gemini.ts`, replacing `lib/openai.ts`) — swapped `gpt-image-1` for
  Gemini 3.1 Flash Image ("Nano Banana 2"): stronger photorealism and
  edit-consistency (preserving a real room/house photo's architecture
  while restyling it) at a lower per-image cost. Same two functions, same
  signatures (`generateRoomImage(prompt)`, `editRoomImage(imageUrl,
  prompt)`, both still returning `{ base64, mimeType: "image/png" }`), so
  every caller — the Rooms tab's "Generate image", Interior Design's
  photo-optional room design, Landscape's required-photo yard redesign —
  needed no changes beyond the import path. Under the hood this is a
  `generateContent` call (`POST .../models/gemini-3.1-flash-image:generateContent`,
  auth via an `x-goog-api-key` header) with `responseModalities: ["TEXT",
  "IMAGE"]`; editing sends the source photo as an `inlineData` part
  alongside the text instruction rather than using a separate edit
  endpoint the way OpenAI's API did. The API routes moved with it —
  `app/api/openai/{generate,edit}-room-image` are now
  `app/api/gemini/{generate,edit}-room-image` — and the env var is
  `GEMINI_API_KEY` (get one at aistudio.google.com/apikey), not
  `OPENAI_API_KEY`. The prompt-building logic itself
  (`lib/interiorDesignPrompt.ts`, `lib/landscapePrompt.ts`, the Rooms tab's
  Claude-written prompt) didn't need to change — both providers take a
  plain natural-language instruction, no provider-specific prompt syntax
  was in play.
- **Custom prompts and chained "add to this image" edits, across all three
  image-generation surfaces** (Rooms, Interior Design, Landscape) — two
  related capabilities layered on top of the Gemini swap above:
  - **Editable prompt, not a locked auto-composed one.** Each surface's
    prompt (Claude-written for Rooms, template-built by
    `buildInteriorDesignPrompt`/`buildLandscapePrompt` for the other two) is
    shown in a `<textarea>` seeded with that auto-composed suggestion but
    freely overridable before generating — the auto text keeps tracking
    form changes live until you actually type in the box (Interior
    Design/Landscape's `promptDraft`/`promptEdited` state, with a "Reset to
    auto-generated" button to go back), at which point your edit wins and
    is sent to Gemini as-is. Rooms already had a per-rendering saved prompt
    to edit in place (`promptOverrides` in `rendering-panel.tsx`), so it
    didn't need the auto/edited split.
  - **"Add to this image"** — a further edit pass chained onto the
    CURRENTLY generated/uploaded image rather than the original "before"
    photo, so edits stack (e.g. generate a room, then separately ask to
    "add a rug and a floor lamp" onto that result, then ask again). All
    three surfaces call the same `/api/gemini/edit-room-image` route with
    `imageUrl` set to the current image and a freeform instruction typed
    into an inline textarea. Rooms reuses its existing
    `saveRenderingPhoto` action (it already updates `uploaded_photo_url` in
    place); Interior Design and Landscape needed new
    `updateInteriorDesignImage`/`updateLandscapeDesignImage` actions since
    those designs store `generated_image_url` as a column on an
    insert-once row — both update that column and re-call
    `recordProjectFile` with the same `source_id` the design was created
    with, so the Files Library entry is replaced in place rather than
    duplicated.
  - **Style presets removed everywhere.** Rooms' style `<datalist>`
    suggestions, Interior Design's 5 quick-style buttons, and Landscape's 5
    style preset buttons are all gone — style is plain free text on every
    surface now (see the dedicated bullets above and below for each).

## Warranty request delete + account display names

- **Contractor/Developer can delete a warranty request outright**
  (migration `049_warranty_request_delete_by_manager.sql`) — reject just
  flips `status` to `'rejected'` and keeps the row for the record; delete
  now removes it entirely (e.g. for a duplicate or spam submission). Scoped
  to Contractor/Developer only (not PM, unlike approve/reject/progress/
  subcontractor/comments) — `requireCanDeleteRequest` in
  `app/projects/[id]/warranty-request/actions.ts` guards the new
  `deleteWarrantyItemRequest` action, and `warranty_item_requests_delete`'s
  RLS policy backs it the same way (the account that filed a request can
  still delete its own, unchanged). Comments cascade-delete with the
  request; attached inspection reports fall back to unattached
  (`warranty_item_request_id ... on delete set null`, unchanged from
  migration 045) rather than being deleted; an approved request's already-
  created `checklist_items` row is untouched — only the request/ticket
  itself goes away. `WarrantyRequestCard` (`warranty-request-client.tsx`,
  now exported) gained a `canDeleteRequests` prop and a "Delete" button
  behind a `ConfirmDialog`, independent of the request's `status` (unlike
  Approve/Reject, which only show while `status === 'pending'`).
- **Account display names** (migration `050_user_display_names.sql`) — a
  Developer can set a friendly name per account from Admin's Users list
  (a new inline `<input>` above each row's email, saving on blur via a new
  `updateUserDisplayName` action), shown in chat and warranty-request
  comments instead of the raw email. `profiles.display_name` is nullable;
  unset falls back to email everywhere. Denormalized onto each
  `project_messages`/`warranty_item_request_comments` row at write time
  (`sender_name`, alongside the existing `sender_email`) rather than
  joined at render time — `profiles_select`'s RLS only lets a user read
  their own profile row, so a live join to resolve another member's name
  wouldn't work without loosening that policy app-wide; `sendMessage`/
  `addWarrantyRequestComment` look up the *sender's own* `display_name`
  (allowed) and store it alongside `sender_email`, same reasoning
  `sender_email` itself already follows. A name change only affects new
  messages/comments going forward, not past ones — same tradeoff
  `sender_email` already has today. `getCurrentUser()`
  (`lib/permissions-server.ts`) and `CurrentUser` (`lib/permissions.ts`)
  gained a `displayName` field for anywhere else that might want it later.

## Warranty request subcontractor assignment: any sub, not just project-linked ones

- **Contractor/Developer/PM can now assign any subcontractor from the
  shared directory to a warranty request** — the assignment dropdown was
  previously scoped to only subcontractors already linked to that specific
  construction (via `project_subcontractors`), so a sub who'd never worked
  that project before couldn't be picked at all, even though nothing in
  `warranty_item_requests_update`'s RLS or the `subcontractor_id` foreign
  key ever required that link. `app/projects/[id]/warranty-request/page.tsx`
  now fetches the whole `subcontractors` directory (`subcontractors_select`
  already lets any signed-in user read all of it) instead of filtering
  through `project_subcontractors`. The warranty role's own request-
  tracking query was fixed the same way — it now resolves names from
  whichever `subcontractor_id`s are actually set on that account's own
  requests, rather than from the project's linked-subs list, so an
  assigned sub's name always resolves correctly for the submitter
  regardless of whether that sub has a `project_subcontractors` row for
  this construction.

## Bulk select on every checklist-style list

- **Checklist tab, Warranty items, Room tasks, and Payment schedule lines
  all now support bulk select + bulk actions** — the only place with this
  before was the Files tab library. Each list gets a header row with a
  "select all"/count checkbox and, once something's selected, inline
  action links (Mark done/not done or Mark paid/not paid, Delete/Remove
  selected, Clear), backed by `lib/usePersistedSelection.ts` (the same
  sessionStorage-backed `Set<string>` hook the Files tab already used) so
  a selection survives switching tabs and back. Each row also gets a
  second checkbox specifically for selection, separate from its existing
  done/paid checkbox.
  - **Checklist tab** (`app/projects/[id]/checklist/checklist-client.tsx`) —
    selection is scoped per phase column (Rough-in/Finish each get their
    own `checklist-selected:${projectId}:${phase}` key), backed by new
    `toggleChecklistItems`/`deleteChecklistItems` bulk actions
    (`app/projects/[id]/checklist/actions.ts`) mirroring
    `deleteProjectFiles`'s shape — one `.in("id", ids)` query, returns
    `deletedIds` for reconciliation.
  - **Warranty Request's checklist items** (same `checklist_items` table,
    `phase = 'warranty'`, in `warranty-request-client.tsx`) — same
    treatment, gated behind `canManage` (Contractor/Developer/PM/Owner;
    the 'warranty' role never reaches this dashboard). New
    `toggleWarrantyItems`/`deleteWarrantyItems` bulk actions in
    `warranty-request/actions.ts`, guarded by the same
    `requireCanManageWarrantyItems()` every other mutation there uses.
  - **Room & Tasks** (`app/projects/[id]/rooms/room-card.tsx`) — scoped
    per room (`room-tasks-selected:${projectId}:${room.id}`). New
    `toggleTasks`/`deleteTasks` bulk actions in `rooms/actions.ts`.
  - **Payments** (`app/projects/[id]/payments/payments-client.tsx`) —
    scoped per bid (`payment-lines-selected:${projectId}:${bid.id}`). New
    `markPaymentsPaid`/`deletePaymentLines` bulk actions in
    `payments/actions.ts` — bulk delete sums every selected line's
    `amount` and adjusts the bid's `total_amount` once via the existing
    `adjustBidTotal` helper, rather than one adjustment per line.

## Chat notifications now include the sender

- **A subscribed account now gets emailed about its own chat messages
  too** — every other alert (checklist, warranty item, etc.) still
  excludes whoever triggered it via `excludeUserId`, but chat's
  `sendMessage` (`app/projects/[id]/chat/actions.ts`) no longer passes
  that, so someone watching a project's chat by email sees a complete
  thread instead of one missing their own replies. Also reworded the
  notification body from "wrote:" to "sent a chat message:" for clarity
  in the inbox.

## Clear chat (Developer only)

- **A Developer can wipe an entire construction's chat thread** — a
  "Clear chat" link above the message list (only visible to a Developer,
  and only when there's something to clear) opens a `ConfirmDialog`
  ("this cannot be undone") before calling a new `clearChat(projectId)`
  action (`app/projects/[id]/chat/actions.ts`), which deletes every
  `project_messages` row for that project in one query. Guarded to
  `profiles.role === 'developer'` server-side, matching
  `project_messages_delete`'s existing RLS (`auth.uid() = user_id or
  is_developer()`), which already let a Developer delete any single
  message — this just extends that to "all of them at once." Every other
  viewer's chat clears live through the Realtime `DELETE` listener
  `chat-client.tsx` already had (one event per deleted row), so no new
  Realtime wiring was needed. `app/projects/[id]/chat/page.tsx` now also
  fetches `getCurrentUser()` to pass `isDeveloper` down to `ChatClient`.

## One-time welcome animation after login

- **A "Welcome to Alaia Homes" overlay shows once, right after a real
  sign-in** — never on an ordinary page load or refresh of `/projects`.
  New `components/WelcomeOverlay.tsx`: a full-screen animated splash
  (backdrop `animate-fade-in`, card `animate-scale-in`, heading/message/
  button staggered with `animate-fade-in-up` + `animationDelay`, same
  tokens the rest of the app already uses) with the app's logo and a
  message about managing plans, budgets, checklists, payments, and the
  whole team in one place. Auto-dismisses after 6 seconds, or on a click
  anywhere (backdrop or the "Let's get started" button).
  - Triggered by a one-shot `?welcome=1` query flag, not a persisted
    "seen it before" flag — set right before the redirect to `/projects`
    on every successful sign-in path: the password login's client-side
    `window.location.href` in `app/login/page.tsx`, and the magic-link/
    sign-up server-side `redirect()` in `app/auth/confirm/route.ts`.
    `app/projects/page.tsx` reads it via its `searchParams` prop and
    passes `show` to `WelcomeOverlay`, which immediately strips the flag
    from the URL (`router.replace(pathname)`) so refreshing the same page
    never re-triggers it.

## Fixed: sign out redirecting to a broken page

- **`/auth/signout` was returning a 307, not a 303** — `redirect("/login")`
  from `next/navigation`, called in a plain Route Handler, defaults to a
  307 Temporary Redirect, which preserves the original request's HTTP
  method. Since sign-out is triggered by a raw `<form method="post">`
  (`app/projects/page.tsx` and the project layout), the browser was
  re-issuing a **POST to `/login`** on that redirect — a page with no POST
  handler — so sign-out silently succeeded server-side (the Supabase
  session really was cleared) while the user's browser landed on a broken
  request instead of the login page. Switched to a manual
  `NextResponse.redirect(new URL("/login", request.url), { status: 303 })`,
  which forces the browser to follow up with a GET regardless of the
  original method — the standard fix for this exact class of bug in
  Route Handlers (Server Actions get this right automatically; plain
  Route Handlers don't).

## Fixed: welcome animation never actually appearing

- **`WelcomeOverlay` was hiding itself almost as soon as it mounted** — it
  stripped the one-shot `?welcome=1` flag with `router.replace(pathname)`
  (next/navigation), which on `/projects` (`export const dynamic =
  "force-dynamic"`) re-fetches the page's server data. That re-render can
  remount the overlay with the now-gone query flag, resetting its
  `visible` state back to `false` — often fast enough that the animation
  was never actually perceived, which is why it looked like it "never
  showed" despite the `?welcome=1` flag correctly reaching the page every
  time. Switched to `window.history.replaceState(null, "", ...)` — a
  plain browser History API call that only rewrites the address bar text,
  triggering no Next.js navigation, re-fetch, or re-render at all, so the
  component's own state is left completely alone.

## Fixed: sign-out doing nothing at all (the real cause)

- **Middleware was redirecting an authenticated user's sign-out request
  back to `/projects` before the sign-out route ever ran** —
  `isAuthRoute` in `lib/supabase/middleware.ts` matched any path starting
  with `/auth` (meant to catch `/auth/confirm`), which also matched
  `/auth/signout`. Since a signed-in user's `if (user && isAuthRoute)`
  rule fires for exactly that case, their POST to `/auth/signout` was
  being redirected straight back to `/projects` — `supabase.auth.signOut()`
  never executed, so the session was never actually cleared, which is why
  tapping "Sign out" appeared to do nothing and a fresh tab still showed
  the same account logged in. The earlier 307-vs-303 redirect fix on the
  route itself was a real, separate bug, but never actually mattered in
  practice since requests never reached that code at all. `/auth/signout`
  now bypasses `updateSession` entirely (same early-return pattern as
  `/share` and the alert-unsubscribe link), so it always reaches the
  route regardless of auth state.

## Fixed: welcome animation depending on Safari's popup-blocker setting

- **Password login's post-sign-in redirect used `window.location.href`,
  reassigned after an `await` (the `signInWithPassword` call) — outside
  the split-second window Safari treats as a "direct user gesture."**
  With "Block Pop-ups" enabled, Safari could silently treat that delayed
  navigation like a blocked pop-under, which is why the welcome overlay
  (and the fresh `/projects` load generally) only worked with the setting
  turned off. `app/login/page.tsx` now uses Next.js's `useRouter().push()`
  instead — a pure client-side SPA transition that never goes through the
  browser's navigation/popup-blocking path at all. `/projects`'s server
  component is already `force-dynamic`, and `@supabase/ssr`'s browser
  client writes the session to real cookies (not just localStorage), so
  it still sees the fresh session on this navigation without needing a
  full page reload.

## Construction Cost: upload a plan directly, and a Standalone Plan mode

- **Added the ability to upload a plan right on the Construction Cost
  page.** Previously the only way to get a plan in front of the cost
  estimator was a detour through the Plan tab first — Construction Cost
  just linked out to it. `CostClient` now has its own "Upload plan"
  button (same PDF-per-page rendering and image upload as the Plan tab)
  and its own thumbnail grid with a per-page "Remove," so uploading and
  estimating happen in one place. A page uploaded this way is still a
  normal `plan_pages` row, so it shows up on that construction's Plan tab
  too — one source of truth either way.
- **Generalized away from requiring one of the tracked "Constructions."**
  A new "Standalone Plan" mode sits next to "By Construction" (same tab
  shape as Landscape's "Standalone Photos") for pricing a plan that isn't
  tied to any construction in this app at all — an addition, an ADU, a
  renovation, or anything else you want a number on before it's ever
  added here. It gets its own optional label and location (used the same
  way a construction's address already was, to ground the estimate's
  $/sqft in real regional data) and its own private plan pages + estimate
  history — private to whoever created it, not a shared directory, since
  unlike a single reference photo this is a whole working plan set plus a
  running estimate history.
- **Migration 051** makes `plan_pages.project_id` and
  `cost_estimates.project_id` optional, adds `created_by` to both (same
  shape as Finish ID/Landscape's earlier universal migrations), and adds
  `title`/`location` to `cost_estimates` for a standalone row to display
  in place of a construction's name/address.
- The cost-estimation prompt itself no longer assumes a full single-family
  house — it now reasons about whatever scope the plan actually shows
  (an addition, ADU, renovation, or commercial buildout included).

## One checkbox column instead of two, on every bulk-select list

- **Checklist items, warranty items, room tasks, and payment schedule
  lines each showed two checkboxes per row** — one to select the row for
  a bulk action, one to toggle it done/fixed/paid — which read as a
  confusing double column of checkboxes, especially on a narrow phone
  screen. Replaced with a single checkbox per row plus an explicit
  "Select" toggle above the list: tapping "Select" switches that same
  checkbox to selection mode (with "Select all" and the bulk actions
  appearing alongside it); tapping "Done" switches it back to its normal
  job of marking the item done/fixed/paid. Nothing about the underlying
  bulk actions changed — same select-all, mark-done/paid, and
  delete-selected behavior — just one checkbox doing one job at a time
  instead of two checkboxes always showing side by side.

## Per-project Activity tab

- **The `activity_log` audit trail (recorded since migration 038) never
  had anywhere to actually view it.** Added a new "Activity" tab, visible
  to every role except `warranty` (same visibility rule as the
  management-facing tabs), that lists the highest-stakes actions on a
  construction — bid accept/decline/delete, warranty item/request
  delete/approve/reject, removing a team member, revoking an invite, and
  file deletes — newest first.
- **Migration 052** adds `activity_log.actor_name`, a denormalized display
  name/email captured at write time (same reasoning as
  `project_messages.sender_name` — `profiles_select`'s RLS only lets a
  user read their own row, so the tab can't resolve another member's name
  via a live join), and the usual `tab_permissions`/`user_tab_permissions`
  row for a new tab. `lib/activityLog.ts`'s `logActivity` now looks the
  actor's name up itself (using the caller's own session, reading their
  own profile row) rather than requiring every call site to pass it in.

## Global search

- **New "Search" link in the top nav** (`/search`) — a single box that
  searches across every construction you have access to at once: the
  constructions themselves, checklist items, warranty items, rooms, room
  tasks, bids, payment schedule lines, subcontractors, and Buyers Guide
  deals. Debounced as you type, results grouped by category, each one a
  direct link to the tab it lives on.
- `app/api/search/route.ts` queries each table with the caller's own
  session client, not the admin client — every table's existing RLS
  (`has_project_access`, subcontractors' shared-directory policy, deals'
  `auth.uid() = user_id`) already scopes results to exactly what that
  user can see, so there's no separate authorization step needed. A
  multi-column match (constructions by name/address, subcontractors by
  company/trade/contact) runs as separate per-column queries merged by
  id rather than a single `.or(...)` filter — `.or()` takes one PostgREST
  filter string where commas separate conditions, so a search term
  containing a literal comma would otherwise corrupt that string and
  silently break the filter.
- No new tables or migration — this only reads what already exists.

## Calendar view

- **New "Calendar" link in the top nav** (`/calendar`) — every open room
  task with a due date, across every construction you have access to,
  grouped into Overdue, Due this week, and Later. A dropdown narrows it
  to one construction, same picker pattern as Construction Cost/Interior
  Design. Room tasks (`tasks.due_date`) are the only genuinely
  forward-looking due date anywhere in the schema — everything else is a
  timestamp of when something already happened — so that's what this
  aggregates; each row links back to that construction's Rooms tab.
- No migration — read-only against the existing `tasks` table, scoped by
  its existing RLS the same way every other query in the app is.

## PWA + Web Push notifications

- **The app is now installable** — `public/manifest.json` (name, icons,
  standalone display, brand theme color) and `app/layout.tsx`'s new
  `manifest`/`appleWebApp`/`viewport` metadata mean "Add to Home Screen"
  on mobile (and desktop Chrome's install prompt) gives it its own icon
  and a standalone window with no browser chrome, the way a native app
  would look.
- **"Enable notifications" on the Constructions page**
  (`components/PushNotificationToggle.tsx`) registers `public/sw.js` and
  subscribes the browser to Web Push, saving the subscription via
  `app/push/actions.ts`. Renders nothing if the server has no VAPID key
  configured or the browser doesn't support Push (notably Safari on iOS
  before 16.4, and only once added to the home screen even after).
- **Push rides alongside the existing email alert**, not instead of it —
  `lib/alerts.ts`'s `notifyProjectSubscribers` (already the one place
  every chat/checklist/warranty notification funnels through) now also
  pushes to every recipient's enabled devices, using `lib/webPush.ts`.
  Getting push still requires being subscribed to that construction's
  alerts in the first place — enabling push on a device doesn't change
  who gets notified about what, only how they're reached.
- **Migration 053** adds `push_subscriptions` (one row per browser/device),
  RLS-scoped to its own owner for self-service, read via the service-role
  admin client for dispatch — same shape as `project_alert_subscriptions`.
- A 404/410 from a push send means the browser/OS permanently invalidated
  that subscription (uninstalled, permission revoked) — those rows get
  deleted automatically rather than retried forever.
- `lib/supabase/middleware.ts` also had to add `/manifest.json` and
  `/sw.js` to its early-bypass list: the root layout's manifest link
  means the browser fetches both on every page load, including the
  logged-out `/login` screen, and the root `middleware.ts` matcher only
  excludes image extensions — without this bypass both were getting
  redirected to `/login` instead of served.
- New env vars (see `.env.example`): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`. Generate a keypair with
  `npx web-push generate-vapid-keys`.

## Warranty request submitted: notifies Contractor/Developer directly, push suppresses email

- **A new warranty item request now always notifies the Contractor(s) and
  Developer(s) on that construction**, regardless of whether they've
  opted into "Get alerts" — a request awaiting review isn't optional the
  way a general project update is. New `notifyProjectRoles(projectId,
  roles, ...)` in `lib/alerts.ts` finds every account with a matching
  `profiles.role` that actually has access to that specific construction
  (its owner, a `project_members` row on it, or any Developer — a
  Developer always has access to everything). `requestWarrantyItem`
  (`app/projects/[id]/warranty-request/actions.ts`) now calls this
  instead of the general opt-in `notifyProjectSubscribers`, narrowed to
  just `contractor`/`developer` (not PM).
- **When push is enabled, email is suppressed for that person** — both
  `notifyProjectSubscribers` and `notifyProjectRoles` now share one
  delivery path (`deliverAlert`) that checks each recipient for an
  enabled push subscription first; only recipients with none still get
  the email. No more double notification once you've turned push on.
- No migration — this only changes how existing tables are queried.

## Admin-configurable notification settings ("who gets notified for what")

- **New "Notifications" section on the Admin page** lists every event
  that can trigger a project notification (chat message, checklist item
  added/done, warranty item added/done/status changed, warranty items
  bulk-added from an inspection report, warranty request submitted/
  approved/rejected/status changed/commented on — see
  `lib/notificationCatalog.ts`). For each one, a Developer can:
  - **Toggle it off entirely** — no email or push fires for that event
    at all, even for someone personally subscribed via "Get alerts."
  - **Force-notify specific roles** — check a role to have everyone with
    that role (and access to the construction) get notified
    automatically, regardless of their own opt-in. Unchecking a role
    doesn't block anyone who's personally subscribed; it only removes
    the automatic notice for that role.
- **`lib/alerts.ts`'s `notifyForAction(projectId, actionKey, ...)`**
  replaces the previous `notifyProjectSubscribers`/`notifyProjectRoles`
  split with one unified path: recipients are the union of (a) anyone
  personally subscribed to that construction's alerts and (b) anyone
  whose role is force-listed for that action and who has access to that
  construction. Both still go through the same push-suppresses-email
  delivery. Every call site across chat/checklist/warranty-request
  actions now passes an action key from the catalog.
- **Migration 054** adds `notification_settings` (Developer-only RLS,
  read and written), seeded with every catalog action enabled and purely
  opt-in (empty forced-roles list) except `warranty_request_submitted`,
  which defaults to forcing Contractor/Developer — the existing behavior
  from the previous change, now configurable instead of hardcoded.

## Concise navigation: tabs grouped into dropdowns

- **The per-project tab strip had grown to 13 tabs** (Plan, Rooms & Tasks,
  Checklist, Budget, Bids, Payments, Accounting, Files, Certificate of
  Occupancy, House Book, Chat, Warranty Request, Activity) — all spread
  across the header at once. It's now grouped into `Plan`/`Rooms & Tasks`/
  `Checklist` staying flat, plus three dropdowns: **Money** (Budget, Bids,
  Payments, Accounting), **Docs** (Files, Certificate of Occupancy, House
  Book), and **Team** (Chat, Warranty Request, Activity) — 6 nav items
  instead of 13. The grouping (`PROJECT_NAV` in `lib/permissions.ts`) is
  purely presentational — it doesn't touch `tab_permissions` at all, a
  group just disappears if none of its tabs are allowed for that role, and
  a single remaining tab in an otherwise-hidden group renders as a plain
  link instead of a one-item dropdown.
- **Adaptive, not forced** — a role that only ever sees a handful of tabs
  (a `warranty` account's fixed Chat + Warranty Request, or any narrowly
  scoped role) still gets the old flat list with zero dropdowns; grouping
  only kicks in once there are more than 6 visible tabs, so it never adds
  an extra click for a nav that was never crowded to begin with.
- **The top nav** (Constructions, Calendar, Search, Buyers Guide, Interior
  Design, Construction Cost, Landscape, Subcontractors, Admin) got the
  same treatment — Buyers Guide/Interior Design/Construction Cost/
  Landscape/Subcontractors now live under one "Design & Tools" dropdown,
  leaving Constructions/Calendar/Search/[Design & Tools]/Admin flat.
- No migration — this only changes how existing, unchanged permissions
  render.

## Mobile responsiveness pass

- **List rows that crowded together on narrow screens** (Payments lines,
  Checklist items, Room tasks, Warranty items) were missing `min-w-0` on
  their flexible title text, so a long item name refused to shrink and
  pushed against the amount/status/action buttons next to it instead of
  wrapping. Those rows now use `flex flex-wrap` with `min-w-0 flex-1` on
  the title and `shrink-0` on the fixed-width bits (amount, due date,
  status), so a long title wraps onto its own line instead of squeezing
  everything else off-screen.
- **Row action buttons hidden behind `opacity-0`/`group-hover:opacity-100`**
  (Edit/Remove/Delete on payments, room tasks, bank transactions, warranty
  comments, chat messages) were invisible on touch — there's no hover
  state on a phone, so there was no way to tap them at all. They're now
  always visible.
- **The repeated page-header row** (logo/title/email on the left, Sign out
  on the right) across Constructions, Calendar, Subcontractors, Search,
  Landscape, Construction Cost, Buyers Guide, Interior Design, Admin, and
  the per-project header now wraps (`flex-wrap`) instead of overflowing,
  with `min-w-0`/`truncate` on the left text block so a long email doesn't
  push the Sign out button off the right edge of a phone screen.
- **Wide tables** (budget line items, finishes, bank transaction CSV
  preview, the public share page's finishes/budget tables) are now wrapped
  in `overflow-x-auto` containers with `whitespace-nowrap` cells where
  needed, so they scroll horizontally on a narrow screen instead of
  squashing columns unreadably or breaking the page layout.
- No migration — this is a CSS/layout-only pass across existing pages.

## Warranty visit scheduling + Calendar integration

- **The Calendar page previously only showed open room task due dates** —
  for a project that mostly tracks warranty work rather than room tasks,
  that made it look like it "did nothing." It now also shows every
  scheduled warranty visit, marked with a 🔧, merged into the same
  overdue/this-week/later grouping and the same per-construction filter.
- **A Contractor, Developer, or PM can now set a date and time window on a
  warranty request** ("Scheduled visit" under Status/Subcontractor on each
  request card) — when the assigned subcontractor is expected to show up.
  Saving it always notifies the homeowner who filed the request (even if
  they never personally clicked "Get alerts" — see
  `notifyForAction`'s new `alwaysIncludeUserId` option in `lib/alerts.ts`),
  and it's Admin-configurable like every other notification (new
  `warranty_request_scheduled` catalog entry). A visit marked "Complete"
  drops off the Calendar the same way a done task does.
- **The homeowner's own request view now shows the assigned subcontractor's
  contact info** (contact name, phone as a tap-to-call link, email as a
  mailto link) and the scheduled visit date/time window, read-only — so
  they know who's coming and when without having to ask.
- **Migration 055** adds `scheduled_date`/`scheduled_time_start`/
  `scheduled_time_end` to `warranty_item_requests` (no new RLS — the
  existing Contractor/Developer/PM update policy already covers these
  columns) and seeds the new notification action.

## Fix: warranty request file attachments silently dropping

- **"Photos or files" on the Create a Warranty Request form did nothing** —
  picking a file never showed up in the attached-files list. Cause:
  `e.target.files` is a *live* `FileList`; it was handed straight into a
  `setFiles` updater function, but the very next line reset the input's
  `value`, which in WebKit clears that same live list before React gets
  around to reading it. Every other file input in the app was unaffected —
  they all extract the actual `File` object(s) synchronously in the change
  handler itself rather than deferring through a closure. Fixed by
  snapshotting into a plain `File[]` array synchronously, before the reset.
- No migration.

## Manual calendar items (meetings, site visits) + Calendar page updates

- **Calendar previously only showed two machine-generated kinds of dates**
  (open room task due dates, and — as of the entry above — scheduled
  warranty visits). There was no way to just write something into it, like
  a meeting or a site walkthrough. A "+ Add calendar item" button now lets
  anyone with access to a construction (every role except the read-only
  'warranty' homeowner role) add one directly: a title, the construction it
  belongs to, a date, an optional time window, and optional notes.
- **Visible to everyone assigned to that construction** — same
  `has_project_access` read boundary every other per-construction table in
  this app uses, marked with a 📅 in the combined list (🔧 stays for
  warranty visits). Only whoever added an item (or a Developer) can remove
  it.
- **Migration 056** adds the `calendar_events` table (project_id, title,
  notes, event_date, time_start, time_end, created_by) with RLS: read
  requires project access, insert requires project access and not the
  'warranty' role, update/delete requires being the creator or a Developer.

## Warranty requests: AI-extracted trade grouping, manual bulk filing, delegation, rejection notes

- **A homeowner can now upload an inspection report themselves** ("Upload
  an Inspection Report" on the Warranty Request tab) — read with the same
  Claude extraction route the Contractor/Developer/PM dashboard already
  used, but now each finding is also classified by trade (Electrical,
  Plumbing, Roof/Leaks, etc. — see `lib/warrantyRequestCategories.ts`) and
  filed as a pending request automatically, instead of the homeowner
  retyping every issue by hand.
- **Multiple tasks under the same trade become one request, not several.**
  If a report turns up 4 electrical issues, that's one "Electrical" ticket
  with 4 individually-approvable tasks inside it — not 4 separate tickets
  each needing its own subcontractor and schedule. The same applies to
  manually filing a batch: the "Create a Warranty Request" form (and the
  Contractor/Developer/PM "File on behalf of a homeowner" form) now let you
  add several task rows under one category in a single submission. A
  single task by itself still files as an ordinary standalone request,
  exactly as before.
- **Each task is approved or rejected on its own**, and the group ticket
  itself stays regardless of what happens to any one task in it — so
  everyone can see at a glance which tasks in, say, "Plumbing" are
  approved, pending, or rejected. The group carries one shared
  subcontractor assignment and scheduled visit window for the whole trade
  (since in practice one subcontractor visit covers every task in it), one
  inspection-reports thread, and one comment thread.
- **Both dashboards (the Contractor/Developer/PM view and the homeowner's
  own "Your Warranty Requests") are now organized into sections by trade**
  instead of one long list, each section showing a live pending/approved/
  rejected count.
- **A Contractor/Developer/PM can reassign a request's (or a group's)
  category** if it was filed under the wrong trade — the select right next
  to the title, not a separate edit flow.
- **A Contractor/Developer/PM can now file a request on behalf of a
  homeowner** who doesn't know how to use the form themselves — picks the
  homeowner from a dropdown of warranty accounts on that construction, and
  it shows up in that homeowner's own "Your Warranty Requests" exactly as
  if they'd filed it themselves.
- **Rejecting a request now takes an optional reason**, shown to the
  homeowner on that request going forward.
- **Migration 057** adds `rejection_note`, `is_group`, and `group_id`
  (self-referencing, `on delete cascade`) to `warranty_item_requests`, and
  relaxes its insert policy so a Contractor/Developer/PM can set
  `requested_by` to someone else when filing on their behalf (verified
  server-side against that project's actual warranty members — see
  `resolveRequester` in `app/projects/[id]/warranty-request/actions.ts`).

## Warranty visibility: shared by role + construction, not by individual account

- **A 'warranty' account previously only saw the requests it personally
  filed** — every other role already saw everything on a construction it
  had access to, regardless of who created it. Two homeowners (or a
  homeowner and a property manager) both assigned as 'warranty' on the same
  construction would each see only their own half of the picture. Fixed so
  a 'warranty' account now sees every warranty request, comment, and
  inspection report on a construction it's assigned to — the same
  "assigned to this construction" boundary every other role already has,
  not "this is the specific account that filed it." Filing is still
  per-account (each person's own submissions are attributed to them), only
  *visibility* changed.
- **Migration 058** replaces `can_view_warranty_request`'s definition
  (`requested_by = auth.uid() or caller isn't 'warranty'`) with a plain
  `has_project_access(project_id)` check — no new tables or policies, this
  is the one function every warranty-scoped RLS policy and read query
  already goes through.

## Warranty homeowner page: two tabs instead of one stacked page

- **Removed "Upload an Inspection Report"** from the 'warranty' role
  entirely — that AI-extraction upload flow is gone from their page (the
  Contractor/Developer/PM dashboard's own "Generate checklist items" from
  an uploaded report is unaffected; only the homeowner-facing upload was
  removed). Attaching a photo/file to a specific request (on the create
  form, or "+ Attach report" on an existing one) still works as before.
- **The 'warranty' role's page is now two tabs — "Create a Request" and
  "Track Your Requests"** — instead of the form and the shared request
  list stacked on top of each other on one long page. A new client
  component, `WarrantyHomeownerTabs`, switches between them; no new route
  or nav entry, no `tab_permissions` change — it's the same
  `/projects/[id]/warranty-request` page split into two panels client-side.

## Remove Search from warranty accounts + Calendar defaults to your one construction

- **Search is no longer available to the 'warranty' role** — it surfaced
  bids, payments, subcontractors, and other data a homeowner account has no
  reason to browse. `TopNav` gained a `showSearch` prop (every page passes
  `currentUser?.role !== "warranty"`), `/search` itself redirects a
  'warranty' viewer to `/projects`, and `/api/search` now 403s that role
  directly, so this is blocked at the nav, the page, and the API — not just
  a hidden link.
- **Calendar now defaults its construction filter to the one construction
  you have** instead of "All constructions," whenever there's only one to
  pick from — the common case for a 'warranty' account, which is usually
  tracking just the one construction. "All constructions" is still right
  there if a second one is ever added.
- No migration — both changes are application-level only.

## Subcontractor job report (PDF)

- **A Contractor, Developer, or PM can now generate a PDF "job report" for
  a subcontractor** — a "Generate job report" button next to "Warranty Item
  Requests" opens a picker (any subcontractor in the shared directory,
  same as the existing assignment dropdown — no `project_subcontractors`
  link required), and downloads a PDF summarizing everything currently
  assigned to that sub on this construction: the project name/address, the
  sub's own contact info, and every warranty request/trade group assigned
  to them (`subcontractor_id`) grouped by category, each with its status,
  progress, scheduled visit window, comments/rejection notes, a group's
  individual task list, and any attached inspection-report photos.
- **New route:** `app/api/projects/[id]/subcontractor-job-report` (POST,
  `{ subcontractorId }`) — same shape as the existing House Book route:
  auth check, rate-limited (`subcontractor-job-report`, 20/hour), re-scopes
  every id by `project_id`/`subcontractor_id` server-side rather than
  trusting the client, signs storage URLs for any photos, and returns
  `application/pdf`.
- **New renderer:** `lib/subcontractorJobReportPdf.tsx`, mirroring
  `lib/houseBookPdf.tsx`'s `@react-pdf/renderer` pattern exactly — the same
  required pdfkit standard-font force-bundle imports (necessary on Vercel,
  see that file's own comment), base-14 fonts only, and a `sharp`-based
  `toEmbeddablePhoto`/`prepareImages` step so an unsupported photo format
  (HEIC, WEBP, GIF — common from phone-camera uploads) is re-encoded to a
  JPEG data URI rather than crashing the whole PDF.
- No migration — reads only existing columns/tables.
- **Not live-tested** — this sandbox has no network access to the real
  Supabase-backed deployment, so this was verified via `tsc`/`lint`/`build`
  and careful reading only. Worth a real run once deployed: assign a
  subcontractor to a couple of warranty requests (including at least one
  multi-task group) and generate their report to confirm the PDF looks
  right, especially with a photo attached from a phone camera.

## Photos + notes on individual warranty tasks, both flowing into the job report

- **Each task inside a warranty request group can now have its own photos
  and notes**, not just the group as a whole. A "Show photos & notes"
  toggle on each task row (`GroupTaskRow`) expands to a small photo grid
  with a "+ Add photo" upload and a notes thread with an add-note input —
  same underlying mechanism as the request-level "Inspection reports" and
  "Comments & notes" sections that already existed (a photo is just an
  `inspection_reports` row, a note a `warranty_item_request_comments` row,
  both scoped to that specific task's own id instead of the group's). A
  standalone request or a group's own shared evidence already had this at
  the top level — this closes the gap for the individual tasks inside a
  group.
- **The job report PDF now includes notes, not just photos** — previously
  it pulled in image attachments but never the comment threads. Each
  request/group and each task inside a group now shows its own notes
  (author + body) alongside its own photos in the generated PDF, sourced
  from `warranty_item_request_comments` the same way the UI displays them.
  A group's shared photos/notes (attached to the group itself) render once
  at the group level; each task's own photos/notes render under that task,
  rather than everything being flattened together.
- No migration — both changes reuse the existing `inspection_reports` and
  `warranty_item_request_comments` tables and their existing RLS.
- **Not live-tested**, same sandbox limitation as above — worth confirming
  once deployed that a photo/note added to one task in a group shows up
  under that task specifically (not the whole group) in both the app and
  the generated PDF.

## Fix: Calendar showing the wrong subcontractor/construction name

- **A scheduled warranty visit always showed "Subcontractor TBD — Untitled
  construction" on the Calendar, even after assigning a real subcontractor**
  — confirmed live by the user, not just suspected. Root cause:
  `app/calendar/page.tsx` read PostgREST's embedded `projects(name)`,
  `subcontractors(company_name)`, and (for room tasks) `rooms(...)` as
  arrays (`.projects?.[0]?.name`), but these are all "belongs-to" foreign
  keys (a warranty request/task/room belongs to exactly one project or
  subcontractor) — PostgREST returns those as a single object, not an
  array. `?.[0]` on a plain object is always `undefined`, so it silently
  fell through to the placeholder text every time, regardless of what was
  actually assigned. Fixed by reading them as plain objects
  (`.projects?.name`) instead. This is the same class of bug wherever this
  codebase reads a belongs-to embed via `?.[0]` — this pass only touched
  `app/calendar/page.tsx`, the file the user actually hit; worth a wider
  sweep if the same symptom (a name that never fills in even once the
  underlying field is set) shows up elsewhere.
- **A scheduled visit's Calendar line now shows just the subcontractor's
  name**, not `"<sub> — <construction>"` — the construction name was
  redundant with the page's own construction filter/title and made the
  actually-useful part (who's coming) harder to spot at a glance.
- **Added a "Clear" button to a warranty request's/group's "Scheduled
  visit" editor** — a native `<input type="date">` has no way to clear
  itself back to empty on iOS Safari (unlike desktop Chrome's built-in "x"),
  so there was previously no way to remove a visit's date/time once set.
  Clearing removes it from the Calendar too, since a visit only shows up
  there while `scheduled_date` is set.
- No migration — all three fixes are application-level only.

## Calendar reachable from inside a construction, not just the top nav

- **Every construction's own tab strip now has a "Calendar" link** —
  clicking into a construction (Plan, Rooms, Checklist, etc.) previously
  meant leaving to the top-nav's Calendar and re-picking that construction
  from "All constructions" every time. The new link
  (`app/projects/[id]/project-tabs.tsx`) goes to `/calendar?project=<id>`,
  which pre-selects that construction's filter automatically.
- **Not a new `tab_permissions` entry** — Calendar is deliberately kept as
  the same kind of ungated utility view as the top nav's own Calendar/
  Search links (it shows only what each entry's own RLS already scopes to
  the signed-in user), so this needed no schema change, migration, or
  per-role visibility toggle in Admin. It's simply linked from one more
  place.

## Calendar warranty-visit items link straight to that request

- **Clicking a scheduled warranty visit on the Calendar now lands you on
  that specific request/group card**, not just the top of the whole
  Warranty Request page. The visit's href now carries a `#wr-<id>` hash
  (`app/calendar/page.tsx`), each request/group card in
  `warranty-request-client.tsx` carries a matching `id={\`wr-${id}\`}`, and
  a new `useScrollToHash` hook (`lib/useScrollToHash.ts`) scrolls to and
  briefly highlights it on arrival — used by both the Contractor/Developer/
  PM dashboard and the homeowner's own tracking view.
- **A 'warranty' account's page now switches to the "Track Your Requests"
  tab automatically** when arriving via one of these links (a request only
  ever lives there, never on "Create a Request") —
  `warranty-homeowner-tabs.tsx` checks for the `#wr-` prefix on mount.
- No migration — purely a client-side navigation/UX change.

## Delete photos/files attached to a warranty request, group, or individual task

- **A Contractor/Developer/PM can now remove a photo or file** from any of
  the three places one can be attached: a standalone request's or a
  group's own "Inspection reports" list (a "Delete" link next to each
  entry), and an individual task's own photo grid inside a group (hover a
  thumbnail for a "Remove" overlay, same interaction as a checklist item's
  own photos). Previously these lists only ever grew — the only way to
  remove an attachment at all was the separate project-wide inspection
  reports section.
- Reuses the existing `deleteInspectionReport` action end to end (already
  guarded to Contractor/Developer/PM, already cleans up the underlying
  storage file) — this was just wiring a delete button to it in three more
  places (`onReportRemove` threaded through `GroupedRequestCards` →
  `WarrantyRequestCard`/`WarrantyRequestGroupCard`/`GroupTaskRow`). No
  migration.
