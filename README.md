# Jottr

A small, fast notebook. Nested pages, the formatting you actually use, and sync
that is honest about what it is doing.

Jottr is live, and in daily use on desktop and phone. This README is for working
on it: what is in it, how to change it safely, and how the sync works. That last
part is the one that has to stay right.

It is local-first. Every page is read from and written to IndexedDB, and the
network is a background detail, so opening a page is a render rather than a
request. Page content is a [Yjs](https://yjs.dev) CRDT, not a row one device
wins, so edits made on two offline devices merge instead of overwriting each
other.

- **Stack**: Next.js 16 (App Router, Turbopack), React 19, Tailwind v4,
  Tiptap 3 / ProseMirror, Yjs, Dexie (IndexedDB), Supabase (Postgres, Auth,
  Realtime).
- **Hosted on** Vercel as a fully static client app. There are no server routes
  and no server-rendered view of anyone's notes.
- **Installs** as a PWA on desktop, Android and iOS.

---

## What's in it

- **Pages** nest to any depth in the sidebar tree and can be dragged to
  reorder. **Favourites** get their own list at the top of the sidebar.
- **Blocks** come from the `/` menu: text, bulleted, numbered and to-do lists,
  callouts, accordions, a live list of subpages, code blocks, tables and
  dividers.
- **Tables** have column resizing and an optional per-table *finance mode*,
  which formats numbers as money and adds a row of column totals. The totals are
  worked out on each device and never written into the document.
- **Inline formatting** is bold, italic, underline, strikethrough, inline code
  and links. A link can point to another page, chosen by searching your pages
  from the link picker. The picker searches the local copy, so it works offline.
- **Mobile** gets its own formatting toolbar above the keyboard.
- **Trash** holds deleted pages until you restore them, delete them forever, or
  empty it.
- **Sign-in** uses a six-digit emailed code, with a magic link as a fallback.

---

## Working on it

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(see [`.env.example`](.env.example)). Local development runs against the same
Supabase project as production unless you point it somewhere else, so a page you
write locally lands in your real account. Without the variables the app shows a
setup notice rather than a workspace.

| Command | What it does |
| --- | --- |
| `npm test` | The test suite (`tests/*.test.ts`, run under Node with `tsx`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build, the same one Vercel runs |

The sync tests run two simulated devices against a fake PostgREST server in
[`tests/harness.ts`](tests/harness.ts), with `fake-indexeddb` standing in for the
browser. They prove the merge and cursor logic. They cannot catch a difference
between that fake and real Supabase, so anything that touches RPCs, triggers or
realtime also needs checking against the live project.

Next 16 differs from older versions of Next in ways that matter. Before writing
framework code, read the guides in `node_modules/next/dist/docs/` (see
[`AGENTS.md`](AGENTS.md)).

### Changing the database

[`supabase/schema.sql`](supabase/schema.sql) is the whole schema, and the only
place it is written down. There is no migrations folder. Every statement in it is
idempotent (`create … if not exists`, `add column if not exists`,
`create or replace function`), so rolling out a change means re-running the
whole file.

1. Edit `schema.sql`. Add a new column as its own
   `alter table … add column if not exists` line, so it applies to the existing
   table.
2. Run the whole file against production: Dashboard → **SQL Editor** →
   **New query**, paste, run.
3. Only then deploy client code that relies on the change.

**The order matters.** A client that sends a column the database doesn't have
gets every metadata push rejected, and the sync indicator goes to *Can't sync*
until the schema catches up.

The local database is versioned separately, in
[`lib/db/dexie.ts`](lib/db/dexie.ts). Adding or removing an *index* there needs a
`db.version(n)` bump. A new plain field on a row does not.

### Deploying

Vercel builds and deploys from `main` on GitHub
([`fraserboag/jottr26`](https://github.com/fraserboag/jottr26)), so pushing to
`main` ships to production. The build uses Vercel's Next.js defaults, with no
overrides.

`NEXT_PUBLIC_` variables are inlined at build time, so changing either Supabase
value in Vercel needs a redeploy, not just a restart.

After a deploy, installed copies pick up the new build the next time they load
online. The service worker serves navigations network-first.

---

## How syncing works

This section explains the part of the code that has to stay right.

### Local first, always

Every keystroke is a Yjs update. Updates are written to IndexedDB immediately, one
small row per transaction, and compacted into a single snapshot once a page
has 150 of them. Your work is safe on the device before any request is made. That
is why the status indicator never says your writing is at risk. It only reports
where the *cloud* copy stands.

### Pushing: compare-and-swap, never last-writer-wins

A page's content is pushed as a full Yjs state blob, together with the `version`
the client last saw. `push_page_doc` only writes if the server is still at that
version. If it isn't, nothing is written and the server sends back its current
blob. The client merges that into its own document and pushes again at the new
version.

Yjs merges are commutative and idempotent, so the merge is the *union* of both
devices' edits. No branch of this code discards an edit, and the user never sees
a conflict prompt.

### Pulling: cursors with an overlap window

Clients pull rows whose server `updated_at` is newer than the last one they
received, minus a 30-second overlap. The overlap is there because a transaction
can take its timestamp before a pull runs and commit after it. Without the
overlap, that row would be stuck behind the cursor for good. Re-applying rows
costs nothing.

Document blobs are fetched in two steps: versions first, then only the blobs
whose version has changed. That stops the overlap window from re-downloading this
device's own last upload on every cycle.

### Realtime is a hint, never the truth

Only `pages` is in the realtime publication. Saving a document calls
`page_doc_saved`, which stamps the page's row. So a content change arrives as a
small `pages` event, and realtime never carries a blob. Don't add `page_docs` to
the publication.

A change event triggers a REST pull and is never applied directly. Sockets drop
without warning and large payloads get cut short, so nothing may depend on an
event arriving. A sync also runs when the device comes online, when the tab
becomes visible, after a local edit (debounced), and on a poll: every 45 seconds
while realtime is connected, and every 10 while it isn't.

### Permanent deletes leave tombstones

Emptying the trash or deleting a page forever calls `purge_pages`. That clears
the page's content and marks the row with `purged_at` instead of deleting it, and
the `keep_purged` trigger stops a later upsert from bringing the page back. That
is how other devices learn to drop the page, including ones that were offline
when it was deleted.

### One leader per browser

Tabs elect a sync leader with the Web Locks API, so two open windows never both
push. The tabs stay in step through a `BroadcastChannel` that relays Yjs updates
between them, and through Dexie's cross-tab live queries. A tab that isn't the
leader asks the leader to push as soon as it has saved an edit.

### Titles are part of the document

A page's title is node 0 of its ProseMirror document, not a column one device
overwrites. Renaming the same page on two devices merges like any other text.
The `pages.title` column is a copy kept for the sidebar, refreshed from the
document after every change.

### What the status indicator means

| State | Meaning |
| --- | --- |
| **Synced** | Everything on this device is in your account. |
| **Saving…** | A push is in progress. Only shown after 300 ms, so it doesn't flicker on every keystroke. |
| **Offline** | No network. Edits are saved on the device, and the badge counts pages waiting to sync. |
| **Can't sync** | The last attempt failed. Retries back off up to 30 s, and the panel offers an immediate retry. |

---

## Known limits

These are deliberate.

- **No sharing or collaboration.** Every row belongs to one user. The sync model
  is simple precisely because a second person is never in the same document.
- **Page *metadata* is last-writer-wins.** Favourite, parent and sort order are
  pulled last-writer-wins, but a pull never overwrites a row this device hasn't
  pushed yet. So if two offline devices move the same page, the one that syncs
  second wins. Titles are the exception: they live in the CRDT and merge. Hitting
  this takes two devices reorganising the same page while both are offline.
- **No images or file attachments**, and no headings or block quotes. Bold text
  covers headings, and callouts cover quotes.
- **Trash is emptied by hand.** Nothing is purged automatically.

---

## Layout

```
app/
  page.tsx                Landing page (redirects to /app when signed in)
  app/page.tsx            The workspace shell: reads IndexedDB, opens offline
  login/page.tsx          Six-digit code sign-in
  manifest.ts             PWA manifest
components/
  editor/                 Tiptap editor, slash menu, format bubble, table menu,
                          mobile toolbar, link picker
  editor/extensions/      Title node, callout, accordion, subpages, finance
                          tables, lists, marks
  workspace/              Sidebar, page tree, page menu, trash, sync indicator
  ui/                     Icons, popovers, buttons
lib/
  db/                     Dexie schema, Y.Doc registry, page mutations, search,
                          cross-tab peers
  sync/                   The sync engine
  supabase/               Browser client
  util/                   Small shared helpers
public/sw.js              Service worker, hand-written
supabase/schema.sql       Tables, RLS, triggers, RPCs, realtime publication
tests/                    Node tests; harness.ts is the fake PostgREST server
design/                   Source artwork for the icon and the landing screenshot
```

### Why the service worker is hand-written

Next 16 builds with Turbopack, and webpack-based PWA plugins such as
`@serwist/next` don't run under it. A local-first app also needs very little from
a service worker. The data is already in IndexedDB, so the worker only has to
keep the app shell and its chunks on the device. Navigations are network-first,
falling back to the cached `/app` shell. Hashed build assets are cache-first.

The workspace is one route, with the open page in the query string
(`/app?p=…`). Moving between pages never fetches anything, and one cached
document serves every workspace URL when offline.

---

## Setting up a new instance

You only need this to stand up Jottr from scratch: a new Supabase project, a
fork, or a staging copy. None of it has to be repeated for the production
instance.

1. **Create a Supabase project** at <https://supabase.com/dashboard>. Any region
   and the free tier are fine.
2. **Run the schema.** SQL Editor → New query, paste all of
   [`supabase/schema.sql`](supabase/schema.sql), run.
3. **Put the code in the sign-in email.** Authentication → Emails → Magic Link,
   and include `{{ .Token }}` in the body:

   ```html
   <h2>Sign in to Jottr</h2>
   <p>Your code is <strong>{{ .Token }}</strong></p>
   <p>Or <a href="{{ .ConfirmationURL }}">click here to sign in</a>.</p>
   ```

   The installed app on iOS can't sign in without this. On iOS the emailed link
   opens in Safari, which has separate storage from a home-screen app. Following
   the link signs Safari in and leaves the installed app signed out. The code
   works everywhere.
4. **Add redirect URLs.** Authentication → URL Configuration → Redirect URLs:
   `http://localhost:3000/app` and `https://<your-domain>/app`.
5. **Set the environment.** Copy `.env.example` to `.env.local` and fill in both
   values from Project Settings → API. On Vercel, import the repo, then add the
   same two variables under Settings → Environment Variables for all three
   environments.
