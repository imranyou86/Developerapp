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
  - **Style search, not a locked list** — style used to be 5 fixed preset
    buttons (`lib/styles.ts`'s `STYLE_PALETTES`), each with its own baked-in
    color palette. `StyleName` (`lib/types.ts`) is now a plain `string`
    instead of that 5-value union — DB-side `renderings.style` was already
    unconstrained text, so no migration was needed. The panel is now a
    free-text style search (an `<input>` with a `<datalist>` of the old
    preset names as autocomplete suggestions — real suggestions, not a
    restriction, so typing anything else works fine) plus three color
    pickers (wall/floor/accent) that default to the first preset's palette
    but are fully user-adjustable. "+ Add to list" queues a
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
  only one), then pick a room type and a style (5 quick-fill presets from
  the same palette list as Rooms & Tasks, or type your own), and size the
  room either by selecting one of that project's pre-added rooms
  (auto-fills width/depth from `rooms`) or entering dimensions/sqft
  manually.
  - **2D layout editor** (`app/interior-design/room-layout-editor.tsx`) —
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
      `room-layout-editor.tsx`, decoupled from the coarser 1ft visual grid
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
      `room-layout-editor.tsx`) so they don't overlap the fixtures. All
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
    OpenAI's image *edit* endpoint (`editRoomImage` in `lib/openai.ts`,
    POST `/api/openai/edit-room-image`) — image-to-image seeded with the
    real photo so the actual architecture/windows carry through; without
    one, it falls back to the Rooms tab's existing text-to-image endpoint
    (`generateRoomImage`, POST `/api/openai/generate-room-image`) and
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
    `TOP_LEVEL_TABS` in `lib/permissions.ts`. Requires `OPENAI_API_KEY`
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
- **Landscape** (top-level, next to Construction Cost — `landscape` tab,
  same project-picker shape as Interior Design/Construction Cost) — upload a
  photo of the house's exterior, check off which components to add (Grass /
  Lawn, Deck, Pool, Concrete / Patio work — each with an optional freeform
  detail, e.g. "wood deck, 12x16 ft along the back"), pick a style, and
  OpenAI's image-*edit* endpoint (`editRoomImage`, reused as-is from
  Interior Design — it only cares about an image + a prompt, not what
  feature is calling it) redesigns that actual photo's yard in place. Unlike
  Interior Design there's no from-scratch path — a photo is always required,
  since the point is redesigning this specific house rather than generating
  a generic one. `lib/landscapePrompt.ts` builds the prompt the same way
  `lib/interiorDesignPrompt.ts` does (component list first as an explicit
  numbered "add exactly these" block, then an instruction to keep the
  house's architecture/camera angle unchanged). `landscape_designs`
  (migration `025_landscape.sql`) mirrors `interior_designs`'s shape.
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
  which sections each role can see, covering both the 8 per-project tabs
  (Plan, Rooms, Checklist, Budget, Bids, Payments, Files,
  Certificate of Occupancy) and the top-level tabs (Buyers Guide/`deals`, Interior
  Design, Construction Cost, Landscape, Subcontractors) — Finish ID no
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
