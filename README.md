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
- **Interior Design** (top-level, next to Buyers Guide — not a per-project
  tab) — designs a room, optionally starting from a real photo of it
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
    rotates 90° or deletes the selected item. Positions clamp to stay
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
    same layout-marked plan sheets the Plan/Cost tabs use (vision, low
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
  (Plan, Rooms, Finish ID, Checklist, Budget, Cost, Payments, Files) and the
  top-level tabs (Buyers Guide/`deals`, Interior Design, Subcontractors);
  Developer itself always has every tab regardless of that table. Every RLS policy that used to check
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
  just their profile.
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
