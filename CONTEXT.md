# Jottr — Project Context

Product and stack reasoning. See CODING_STANDARDS.md for the conventions that
follow from it.

## What this is

Jottr is a small notes app: create, edit, delete, and organize short text notes
with basic rich text formatting (bold, italic, headings, bullet lists).

## How it's meant to run

- Primary surfaces are iPhone and macOS, both as installed PWAs (Safari's "Add
  to Home Screen" on iOS, "Add to Dock" on macOS) — not native apps, no App
  Store distribution. The web interface (any browser, not installed) is valuable
  but secondary.
- Works offline: notes are stored locally (IndexedDB via Firestore's built-in
  offline persistence) so the app opens and functions with no connection.
- Syncs across a user's devices in real time via Firestore once connectivity
  returns.
- Deploy target: Vercel.

## Auth & data model

- Auth is Google sign-in only, via Firebase Auth. No other providers, no
  email/password, no sign-up flow beyond "sign in with Google."
- Each signed-in user gets their own private notes, scoped by their Firebase
  `uid`. Sharing/collaboration isn't a planned feature right now, but the data
  model must not assume there will only ever be one user.
- Firestore data lives under `/users/{uid}/...` — see CODING_STANDARDS.md.

### Note and folder document shape

```ts
// /users/{uid}/notes/{noteId}
{
  id: string;
  ownerId: string; // Firebase uid
  folderId: string | null; // null = unfiled; id of a /users/{uid}/folders doc
  title: string;
  content: SerializedEditorState; // Lexical's JSON document model, not HTML
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null; // null = live; see "Deletes" below
}

// /users/{uid}/folders/{folderId}
{
  id: string;
  ownerId: string;
  parentId: string | null; // null = root-level; id of a parent folder doc
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
}
```

Folders nest via `parentId`, forming a tree. There's no materialized path or
ancestor array — `useFolders(uid)` already streams the whole live folder set
into memory in one listener (folder counts here are small, dozens not
thousands), so a breadcrumb for any folder is just walking the `parentId`
chain through that in-memory list client-side (`getFolderPath` in
`src/lib/folders.ts`). No extra reads, no per-depth index.

Moving a folder (changing its `parentId`) must not create a cycle. Firestore
rules reject the direct case — setting a folder as its own parent — but can't
walk an arbitrary-depth ancestor chain to catch an indirect one (moving a
folder under its own descendant), so that check is client-side
(`wouldCreateCycle`) and must run before every move. This is safe for a
single-user, non-adversarial app: the worst a bypassed check does is corrupt
that user's own folder tree, not another user's data.

Folder deletion is a tombstone too (see below) and does **not** cascade: a
deleted folder's child folders keep their `parentId`, and a deleted folder's
notes keep their `folderId`. The UI should treat a `parentId` or `folderId`
that doesn't resolve to a live folder (deleted, reaped past its undo window,
or never existed) as root-level / unfiled — this keeps note and folder writes
from needing to know about each other's tombstone state, and it means
restoring a folder within its 30-day window also restores its place in the
tree and its notes' place in it, for free.

`createdAt` / `updatedAt` use client-side `Timestamp.now()`, not
`serverTimestamp()`. A server timestamp resolves to a local estimate while
offline and is rewritten when it lands, which visibly reshuffles a list sorted
by `updatedAt` after each sync. Clock skew between one person's own devices is
the cheaper problem to have.

`deletedAt` is the exception and **must** use `serverTimestamp()` — the rules
require `deletedAt == request.time` on write. The 30-day reap window is measured
from this field, so a client-chosen value could be backdated to make a note
immediately hard-deletable, defeating the undo window. The reshuffling argument
above does not apply: `deletedAt` is not a sort key, and a note leaves the live
list on `deletedAt != null` whatever the value is. Offline deletes are
unaffected, since `serverTimestamp()` resolves when the write lands.

### Deletes are tombstones, not document deletes

Notes are soft-deleted by setting `deletedAt`; the notes list queries
`where('deletedAt', '==', null)`. Hard `deleteDoc` is reserved for reaping
expired tombstones, and `firestore.rules` rejects it otherwise.

This exists because of a specific offline failure. Device B goes offline with a
note open, device A deletes that note, B edits it offline and later reconnects.
Firestore resolves the conflict by **arrival order at the server, not by when
the user acted** — so B's 10:00 edit, flushed at 14:00, beats A's 12:00 delete.
With a hard delete the outcome depends on the write op: `setDoc` resurrects the
deleted note, while `updateDoc` fails `not-found` and silently discards the
user's edits after having shown the note as present the whole time.

Making the delete a field write puts it in the same last-write-wins arena as
the edit. The two writes touch different fields, so they merge rather than
race: the surviving document carries both the tombstone and B's edited content,
and the resolution rule becomes ours to choose instead of the network's.

The rule: **delete wins.** A note is visible iff `deletedAt == null`. Deleting
is a deliberate act; an autosave is a side effect of a cursor sitting in a text
box. If a concurrent edit could undelete, closing a laptop lid would become a
way to resurrect notes. Because the edited content survives on the document,
explicit undelete stays possible — it just never happens implicitly.

Tombstones keep their content for a 30-day undo window (which is most of a
trash feature for free), after which a client-side pass on app start hard-
deletes the expired ones. No Cloud Function, no scheduled job, no cost.

## Stack decisions & reasoning

- **Firestore** — built-in offline persistence (IndexedDB-backed) is a natural
  fit for the offline-first PWA requirement, plus real-time sync, at low/no cost
  for this scale.
- **Lexical** — full control over the editor and its data model, no external
  framework lock-in. Content is persisted as Lexical's own JSON document model
  rather than HTML.
- **Vanilla React + CSS Modules (no component library)** — interactive
  components are built by hand and styled with scoped CSS per component, rather
  than pulling in a primitives or utility-class framework. Keeps dependencies
  minimal and gives full control over behavior and styling; no build-time CSS
  framework to configure or fight.
- **Vite + React** — fast local dev, minimal build config overhead.
- **React Compiler** — auto-memoization so the app can stay simple (no manual
  `useMemo`/`useCallback` sprinkling) while still being fast.

Priorities throughout: UI speed, minimal dependencies, low/no ongoing cost, full
control over the frontend.

## Status

Scaffolding stage: the project skeleton, tooling, and integrations are wired up,
but no app features (notes UI, auth flows, editor toolbar) are built yet.
