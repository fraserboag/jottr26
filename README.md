# Jottr

A small, fast notebook. Nested pages, the formatting you actually use, and sync
that is honest about what it is doing.

Built to be local-first: every page is read from and written to IndexedDB, and
the network is a background detail. Opening a page is a render, not a request.
Editing on two offline devices merges rather than overwrites, because page
content is a [Yjs](https://yjs.dev) CRDT rather than a row that one device wins.

- **Stack** — Next.js 16 (App Router, Turbopack), React 19, Tailwind v4,
  Tiptap 3 / ProseMirror, Yjs, Dexie (IndexedDB), Supabase (Postgres + Auth).
- **Deploys to** Vercel as a fully static client app. There are no server routes
  and no server-rendered view of your notes.
- **Installs** as a PWA on desktop, Android and iOS.

---

## Setting it up

### 1. Create a Supabase project

<https://supabase.com/dashboard> → **New project**. Any region and the free tier
are fine.

### 2. Run the schema

Dashboard → **SQL Editor** → **New query**, paste all of
[`supabase/schema.sql`](supabase/schema.sql), and run it. It is idempotent, so
re-running it later to pick up changes is safe.

That file creates two tables (`pages` for metadata, `page_docs` for the CRDT
blob), turns on row level security with `auth.uid() = user_id` on every policy,
adds the `push_page_doc` compare-and-swap function, and puts both tables in the
realtime publication.

### 3. Put the six-digit code in your sign-in email

Jottr signs people in with a code rather than only a link. Supabase's default
email template contains only the link, so add the token:

Dashboard → **Authentication** → **Emails** → **Magic Link**, and include
`{{ .Token }}` somewhere in the body. For example:

```html
<h2>Sign in to Jottr</h2>
<p>Your code is <strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">click here to sign in</a>.</p>
```

**This step is not optional if you want the installed app to work on iOS.** On
iOS the emailed link opens in Safari, which has separate storage from a
home-screen app — so following the link signs you into Safari and leaves the
installed app signed out. The code works everywhere.

### 4. Add the redirect URL

Dashboard → **Authentication** → **URL Configuration** → **Redirect URLs**, add:

```
http://localhost:3000/app
https://your-domain.vercel.app/app
```

### 5. Run it

```bash
cp .env.example .env.local   # then fill in the two values
npm install
npm run dev
```

Both values come from Dashboard → **Project Settings** → **API**.

---

## Deploying to Vercel

1. Push this repo to GitHub and import it at <https://vercel.com/new>. The
   defaults are correct — Next.js, `npm run build`, no overrides.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` under
   **Settings → Environment Variables**, for all three environments.
3. Add `https://<your-domain>/app` to the Supabase redirect URLs (step 4 above).

`NEXT_PUBLIC_` variables are inlined at build time, so a change to either needs a
redeploy, not just a restart.

---

## How syncing works

The part worth understanding, because it is the part that has to be right.

### Local first, always

Every keystroke is a Yjs update. Updates are appended to IndexedDB immediately —
one small row per transaction — and compacted into a single snapshot once a page
accumulates 150 of them. Your work is durable on the device before any request is
made, which is why the status indicator never claims your writing is at risk; it
only ever reports where the *cloud* copy stands.

### Pushing: compare-and-swap, never last-writer-wins

A page's content is pushed as a full Yjs state blob together with the `version`
the client last saw. `push_page_doc` only writes if the server is still at that
version. If it is not, nothing is written and the server's current blob comes
back instead; the client merges it into its own document and pushes again at the
new version.

Because Yjs merges are commutative and idempotent, that merge is the *union* of
both devices' edits. There is no branch of this code where an edit is discarded,
and no conflict prompt for the user to resolve.

### Pulling: cursors with an overlap window

Clients pull rows whose server `updated_at` is newer than the last one they
received, minus a 30-second overlap. The overlap exists because a transaction can
take its timestamp before a pull runs and commit after it, which would otherwise
leave a row permanently behind the cursor. Re-applying rows costs nothing.

Document blobs are fetched in two steps — versions first, then only the blobs
whose version actually differs — so the overlap window does not re-download this
device's own last upload on every cycle.

### Realtime is a hint, never the truth

Postgres change events trigger a REST pull; they are never applied directly.
Sockets drop silently and large payloads get truncated, so nothing is allowed to
depend on one arriving. Syncs are also triggered by coming online, by the tab
becoming visible, by a local edit (debounced), and by a 45-second poll.

### One leader per browser

Tabs elect a sync leader with the Web Locks API, so two open windows do not both
push. They stay in step through a `BroadcastChannel` that relays Yjs updates
between them, and through Dexie's cross-tab live queries.

### Titles are part of the document

The page title is node 0 of the ProseMirror document, not a column that one
device overwrites. Renaming the same page on two devices merges like any other
text. The `pages.title` column is a denormalised copy for the sidebar, refreshed
from the document after every change.

### What the status indicator means

| State | Meaning |
| --- | --- |
| **Synced** | Everything on this device is in your account. |
| **Saving…** | A push is in flight. Only shown after 300 ms, so it does not flicker on every keystroke. |
| **Offline** | No network. Edits are saved locally; the badge counts pages waiting. |
| **Can't sync** | The last attempt failed. Retries back off to 30 s, and the panel offers an immediate retry. |

---

## Known limits

Deliberate, and worth stating plainly.

- **No sharing or collaboration.** Every row is scoped to one user. The sync
  model is simple precisely because there is never a second person in a document.
- **Page *metadata* resolves in favour of whichever device has unpushed
  changes.** Icon, parent and sort order are pulled last-writer-wins, except that
  a pull never overwrites a row this device has not yet pushed — so if two
  offline devices move the same page, the one that syncs second wins. Titles are
  exempt; they live in the CRDT and merge. In practice this needs two devices to
  reorganise the same page while both are offline.
- **Search covers pages this device has opened.** The searchable text is derived
  locally from documents that have been loaded or pulled; it is never uploaded.
- **No images or file attachments**, no tables, no databases, no templates.
- **Trash is manual.** Deleted pages stay until you empty the trash.

---

## Layout

```
app/                      Routes. All static; the workspace is client-rendered.
  app/page.tsx            The workspace shell (reads IndexedDB, opens offline)
  login/page.tsx          Six-digit code sign-in
  manifest.ts             PWA manifest
components/
  editor/                 Tiptap: title node, slash menu, format bubble
  workspace/              Sidebar, page tree, search, trash, sync indicator
lib/
  db/                     Dexie schema, Y.Doc registry, page mutations
  sync/                   The sync engine
  supabase/               Browser client
public/sw.js              Service worker, hand-written
supabase/schema.sql       Tables, RLS, the compare-and-swap function
```

### Why the service worker is hand-written

Next 16 builds with Turbopack, where webpack-based PWA plugins such as
`@serwist/next` do not run. A local-first app also needs very little from a
service worker: the data is already in IndexedDB, so it only has to keep the
shell and its chunks on the device. Navigations are network-first falling back to
the cached `/app` shell; hashed build assets are cache-first.

The workspace is one route with the open page in the query string (`/app?p=…`),
which means navigation between pages never fetches anything, and one cached
document serves every workspace URL when offline.
