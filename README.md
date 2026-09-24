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
