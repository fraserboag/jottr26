# Jottr — Coding Standards

Concrete conventions for this repo. See CONTEXT.md for the product/stack
reasoning behind these rules.

## Data access

- All app data lives under `/users/{uid}/...` in Firestore. Never store app data
  outside a user's own scope — there is no shared/global collection for notes or
  related data.
- Firestore security rules (`firestore.rules`) enforce this at the database
  level: a user may only read/write documents under their own `/users/{uid}`
  subtree. Everything else is denied by default. Treat the rules file as the
  source of truth, not client-side checks.
- Rules are written per collection, not as one broad
  `/users/{uid}/{document=**}` grant. Firestore ORs all matching rules
  together, so a broad write grant would silently re-permit what a narrower
  rule denies. **Adding a subcollection means adding rules for it** — until
  then it is denied.

## Deletes

- Never call `deleteDoc` on a note. Delete by setting `deletedAt`; read live
  notes with `where('deletedAt', '==', null)`. `firestore.rules` rejects hard
  deletes except for tombstones past their 30-day undo window, so a stray
  `deleteDoc` fails loudly rather than silently reintroducing the
  resurrect-on-sync bug. See CONTEXT.md for why.
- Always write `deletedAt: null` when creating a note — never omit the field.
  `where('deletedAt', '==', null)` does **not** match documents missing the
  field, so an absent value makes a note permanently invisible. The rules
  enforce this on create.
- A delete must write only `deletedAt`, and an autosave must not write
  `deletedAt`. The conflict resolution depends on the two touching disjoint
  fields so Firestore merges them instead of one clobbering the other.
- Queries combining the `deletedAt` filter with an `updatedAt` sort need the
  composite index in `firestore.indexes.json`. Missing indexes fail at
  runtime, not at build time.

## Errors

- React Router catches errors thrown by route components itself, so a boundary
  above `RouterProvider` never sees them. Both are wired: `RouteError` as the
  root route's `errorElement` (the one that fires in practice) and
  `ErrorBoundary` around `RouterProvider` for providers above the routes.
  Removing either leaves a real gap.
- The fallback prints the error and offers to copy it. An installed PWA on a
  phone has no console, so an error the UI doesn't surface is unobservable.
- Boundaries catch render errors only — not event handlers, async code, or
  promise rejections (i.e. most Firestore write failures).

## Comments

- Comment sparingly. If code needs explaining, prefer making it clearer. Put
  rationale in CONTEXT.md or here, not in doc blocks in every file.

## Auth

- Use `signInWithRedirect`, not `signInWithPopup`. Safari's installed PWA
  standalone mode handles popups unreliably — redirect is the only method that
  works consistently there.

## Editor content

- Lexical editor content is persisted as its JSON document model
  (`SerializedEditorState`), not as serialized HTML. This avoids sanitization
  concerns and round-trips cleanly through Lexical's own (de)serialization.

## Components & styling

- Components are styled with colocated CSS Modules (`Component.tsx` +
  `Component.module.css`), imported as `styles` and applied via `styles.foo`.
- Shared CSS custom properties (colors, radius, font) live in `src/globals.css`
  under `:root` — reference them from module CSS with `var(--color-foo)` rather
  than hardcoding values, so light/dark and theme changes stay centralized.
- No component/UI library — build interactive components (dialogs, dropdowns,
  etc.) yourself with plain React and CSS Modules.

## Formatting & linting

- Two static analysis tools, with deliberately no overlap between them:
  - **TypeScript** — `strict` mode plus `noUnusedLocals` /
    `noUnusedParameters`. Owns types, undefined names, unused code.
  - **ESLint** — `eslint-plugin-react-hooks` and nothing else. Owns the Rules
    of React (see below). It intentionally does not enable `@eslint/js` or
    `typescript-eslint` rule sets; `typescript-eslint` is installed for its
    parser alone. If tsc already catches it, it doesn't belong in ESLint.
- `npm run check` runs both; run it before committing. `npm run lint` is
  ESLint alone.
- No Prettier dependency, no pre-commit hooks (solo project, editor's Prettier
  extension handles formatting).

## React

- Code must comply with the Rules of React strictly (no conditional hooks, no
  mutating state/props during render, correct dependency treatment, etc.). React
  Compiler depends on these rules holding for correct auto-memoization —
  violations can cause silently incorrect memoization, not just lint warnings.
  This is what ESLint exists for in this repo, and it is the reason the lint
  step is not optional: tsc cannot see any of it.
