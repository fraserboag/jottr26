# Jottr

A small notes app: create, edit, and organize short text notes with basic
rich text formatting (bold, italic, headings, bullet lists).

Primary surfaces are iPhone and macOS as installed PWAs (Safari's "Add to
Home Screen" / "Add to Dock"); the web interface is valuable but secondary.
Works offline (notes stored locally via Firestore's offline persistence) and
syncs across devices in real time once connectivity returns.

See [CONTEXT.md](./CONTEXT.md) for the full product/stack reasoning and
[CODING_STANDARDS.md](./CODING_STANDARDS.md) for conventions to follow when
working on this repo.

## Stack

- Vite + React + TypeScript, React Compiler
- Firebase (Auth: Google sign-in only; Firestore for data + offline
  persistence)
- Lexical for rich text editing
- Vanilla React + CSS Modules (no component library)
- Deployed on Vercel

## Development

```bash
npm install
npm run dev      # start dev server
npm run lint     # lint
npm run build    # typecheck + production build
npm run preview  # preview a production build locally
```

## Status

Scaffolding stage: project skeleton, tooling, and integrations are wired up,
but no app features (notes UI, auth flows, editor toolbar) are built yet.
