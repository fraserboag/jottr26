# Jottr — Project Context

## What this is

Jottr is a small notes app: create, edit, and organize short text notes with
basic rich text formatting (bold, italic, headings, bullet lists).

Initially for personal use, but the architecture should not assume a single
user forever — a friend should eventually be able to sign in with their own
Google account and get their own private space, with no structural rework
required to get there.

## How it's meant to run

- Installed on iPhone as a PWA via Safari's "Add to Home Screen" — not a
  native app, no App Store distribution.
- Works offline: notes are stored locally (IndexedDB via Firestore's built-in
  offline persistence) so the app opens and functions with no connection.
- Syncs across multiple devices (phone, laptop, etc.) in real time via
  Firestore once connectivity returns.
- Deploy target: Vercel.

## Auth & data model

- Auth is Google sign-in only, via Firebase Auth. No other providers, no
  email/password, no sign-up flow beyond "sign in with Google."
- Each signed-in user gets their own private notes, scoped by their Firebase
  `uid`. Sharing/collaboration between users isn't a planned feature right
  now, but the data model must not assume there will only ever be one user.
- Firestore data lives under `/users/{uid}/...` — see CODING_STANDARDS.md.

### Anticipated note document shape

Not yet implemented, but future work should converge on this shape to avoid
churn:

```ts
{
  id: string
  ownerId: string // Firebase uid
  title: string
  content: SerializedEditorState // Lexical's JSON document model, not HTML
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

## Core features (intended, not yet built)

- Create, edit, delete notes.
- Basic rich text formatting: bold, italic, headings, bullet lists.
- Offline-first editing with background sync.
- Real-time sync across devices for the same user.
- Google sign-in, scoped private note collections per user.

## Stack decisions & reasoning

- **Firestore over Convex** — Firestore has built-in offline persistence
  (IndexedDB-backed) that's a natural fit for the offline-first PWA
  requirement, plus real-time sync, at low/no cost for this scale.
- **Lexical over Tiptap** — full control over the editor and its data model,
  no external framework lock-in. Content is persisted as Lexical's own JSON
  document model rather than HTML.
- **Radix UI (unstyled primitives) + CSS Modules over Tailwind/shadcn** —
  Radix supplies accessible, unstyled behavior (Slot, and future primitives
  like Dialog/Dropdown as they're needed); styling is plain, scoped CSS per
  component rather than a utility-class framework. No build-time CSS
  framework to configure or fight.
- **Vite + React** — fast local dev, minimal build config overhead.
- **React Compiler** — auto-memoization so the app can stay simple (no manual
  `useMemo`/`useCallback` sprinkling) while still being fast.
- **No commit hooks / formatter enforcement** — this is a solo project, so
  linting runs via `npm run lint` and formatting is handled by the editor
  (Prettier extension), not enforced by tooling. See CODING_STANDARDS.md.

Priorities throughout: minimal dependencies, low/no ongoing cost, full
control over the frontend.

## Status

This is scaffolding-stage: the project skeleton, tooling, and integrations
are wired up, but no app features (notes UI, auth flows, editor toolbar) are
built yet. See CODING_STANDARDS.md for the conventions feature work should
follow.
