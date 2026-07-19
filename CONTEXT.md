# Jottr — Project Context

## What this is

Jottr is a small notes app: create, edit, and organize short text notes with
basic rich text formatting (bold, italic, headings, bullet lists).

## How it's meant to run

- Primary surfaces are iPhone and macOS, both as installed PWAs (Safari's "Add
  to Home Screen" on iOS, "Add to Dock" on macOS) — not native apps, no App
  Store distribution. The web interface (any browser, not installed) is valuable
  but secondary.
- Works offline: notes are stored locally (IndexedDB via Firestore's built-in
  offline persistence) so the app opens and functions with no connection.
- Syncs across multiple devices (phone, laptop, etc.) in real time via Firestore
  once connectivity returns.
- Deploy target: Vercel.

## Auth & data model

- Auth is Google sign-in only, via Firebase Auth. No other providers, no
  email/password, no sign-up flow beyond "sign in with Google."
- Each signed-in user gets their own private notes, scoped by their Firebase
  `uid`. Sharing/collaboration between users isn't a planned feature right now,
  but the data model must not assume there will only ever be one user.
- Firestore data lives under `/users/{uid}/...` — see CODING_STANDARDS.md.

### Anticipated note document shape

Not yet implemented, but future work should converge on this shape to avoid
churn:

```ts
{
  id: string;
  ownerId: string; // Firebase uid
  title: string;
  content: SerializedEditorState; // Lexical's JSON document model, not HTML
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null; // null = live; see "Deletes" below
}
```

`createdAt` / `updatedAt` use client-side `Timestamp.now()`, not
`serverTimestamp()`. A server timestamp resolves to a local estimate while
offline and is rewritten when it lands, which visibly reshuffles a list sorted
by `updatedAt` after each sync. Clock skew between one person's own devices is
the cheaper problem to have.

### Deletes are tombstones, not document deletes

Notes are soft-deleted by setting `deletedAt`; the notes list queries
`where('deletedAt', '==', null)`. Hard `deleteDoc` is reserved for reaping
expired tombstones, and `firestore.rules` rejects it otherwise.

This exists because of a specific offline failure. Device B goes offline with a
note open, device A deletes that note, B edits it offline and later reconnects.
Firestore resolves the resulting conflict by **arrival order at the server, not
by when the user acted** — so B's 10:00 edit, flushed at 14:00, beats A's 12:00
delete. With a hard delete the outcome depends on the write op: `setDoc`
resurrects the deleted note, while `updateDoc` fails `not-found` and silently
discards the user's edits after having shown the note as present the whole time.

Making the delete a field write puts it in the same last-write-wins arena as
the edit. The two writes touch different fields, so they merge rather than
race: the surviving document carries both the tombstone and B's edited content,
and the resolution rule becomes ours to choose instead of the network's.

The rule: **delete wins.** A note is visible iff `deletedAt == null`. Deleting
is a deliberate act; an autosave is a side effect of a cursor sitting in a
text box. If a concurrent edit could undelete, closing a laptop lid would
become a way to resurrect notes. Because the edited content survives on the
document, explicit undelete stays possible — it just never happens implicitly.

Tombstones keep their content for a 30-day undo window (which is most of a
trash feature for free), after which a client-side pass on app start hard-
deletes the expired ones. No Cloud Function, no scheduled job, no cost.

## Core features (intended, not yet built)

- Create, edit, delete notes.
- Basic rich text formatting: bold, italic, headings, bullet lists.
- Offline-first editing with background sync.
- Real-time sync across devices for the same user.
- Google sign-in, scoped private note collections per user.

## Stack decisions & reasoning

- **Firestore** — Firestore has built-in offline persistence (IndexedDB-backed)
  that's a natural fit for the offline-first PWA requirement, plus real-time
  sync, at low/no cost for this scale.
- **Lexical** — full control over the editor and its data model, no external
  framework lock-in. Content is persisted as Lexical's own JSON document model
  rather than HTML.
- **Vanilla React + CSS Modules (no component library)** — interactive
  components are built by hand with plain React and styled with scoped CSS per
  component, rather than pulling in a primitives or utility-class framework.
  Keeps dependencies minimal and gives full control over behavior and styling;
  no build-time CSS framework to configure or fight.
- **Vite + React** — fast local dev, minimal build config overhead.
- **React Compiler** — auto-memoization so the app can stay simple (no manual
  `useMemo`/`useCallback` sprinkling) while still being fast.

Priorities throughout: UI speed, minimal dependencies, low/no ongoing cost, full
control over the frontend.

## Status

This is scaffolding-stage: the project skeleton, tooling, and integrations are
wired up, but no app features (notes UI, auth flows, editor toolbar) are built
yet. See CODING_STANDARDS.md for the conventions feature work should follow.
