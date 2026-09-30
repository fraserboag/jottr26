# Jottr

A small, fast notebook with nested pages. It runs in the browser and installs as
an app on desktop and phone.

Pages are saved to IndexedDB on the device first, and synced to Supabase in the
background. Page content is stored as a [Yjs](https://yjs.dev) document, so edits
made offline on two devices merge when they reconnect. Neither one overwrites the
other.

Built with Next.js 16, React 19, Tailwind v4, Tiptap, Yjs, Dexie and Supabase.
Hosted on Vercel as a static client app.

## Running it

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the Supabase URL and anon key.
By default this points at the production project, so anything you write locally
goes into your real account.

`npm test`, `npm run typecheck` and `npm run lint` do what you'd expect.

## Worth knowing

- The database schema is all in `supabase/schema.sql`. It's safe to re-run, so
  to change the schema you edit that file and run the whole thing in the
  Supabase SQL editor. Do that before you deploy code that depends on the change.
- Pushing to `main` deploys to production.
- The sync code is in `lib/sync/`. Changes there need care, because it's the
  part that keeps notes from getting lost.
- Production builds generate an offline dependency manifest from Next's lazy
  chunk list. The service worker caches the editor before adopting a new shell,
  while the editor remains deferred during startup. `npm run build` also checks
  the emitted shell and its offline assets before the build can be deployed.

## Inspecting startup

The editor warms up after the local page list has loaded, had a paint opportunity,
and the browser is idle. Browsers without idle callbacks wait another 500 ms.
Opening a note starts loading its editor immediately and cancels queued warmup.

Startup measurements stay in the browser's Performance timeline, with labels
only and no analytics requests. After launching `/app`, run this in DevTools:

```js
console.table(
  performance.getEntriesByType('measure')
    .filter(entry => entry.name.startsWith('jottr:'))
    .map(entry => ({ stage: entry.name.slice(6), ms: Math.round(entry.duration) }))
)
```

`startup` runs from browser navigation to the local workspace's paint opportunity;
it does not include native app launch time. `shell-response` measures time to the
first response byte. Other stages cover hydration, session lookup, local pages,
and paint. Editor code, document loading and editor rendering are measured on
their first use; time spent waiting for the user to open a note is excluded from
document loading. Paint measurements use two animation frames as an approximation.
