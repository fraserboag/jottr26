# Jottr — Coding Standards

Concrete conventions for this repo. See CONTEXT.md for the product/stack
reasoning behind them.

## Data access

- All app data lives under `/users/{uid}/...` in Firestore. Never store app data
  outside a user's own scope — there is no shared/global collection.
- Firestore security rules (`firestore.rules`) enforce this at the database
  level: a user may only read/write documents under their own `/users/{uid}`
  subtree, and everything else is denied by default. Treat the rules file as the
  source of truth, not client-side checks.
- Rules are written per collection, not as one broad
  `/users/{uid}/{document=**}` grant. Firestore ORs all matching rules together,
  so a broad write grant would silently re-permit what a narrower rule denies.
  **Adding a subcollection means adding rules for it** — until then it is denied.

## Deploys

Rules deploys are separate from app deploys. Pushing to git builds and ships the
app via Vercel, but nothing in that pipeline touches Firestore. After editing
`firestore.rules` or `firestore.indexes.json`, deploy it yourself:

```
npx -y firebase-tools@latest deploy --only firestore:rules
```

Skip this and the deployed app runs against the old rules — which shows up as
permission-denied errors against rules that look correct in the repo.

## Deletes

- Never call `deleteDoc` on a note or folder. Delete by setting `deletedAt`;
  read live documents with `where('deletedAt', '==', null)`. `firestore.rules`
  rejects hard deletes except for tombstones past their 30-day undo window, so
  a stray `deleteDoc` fails loudly rather than silently reintroducing the
  resurrect-on-sync bug. See CONTEXT.md for why. This applies to folders too —
  a deleted folder is a tombstone, not a removed document, and it does not
  touch its notes' `folderId` or its child folders' `parentId` (see
  CONTEXT.md).
- Moving a folder (changing `parentId`) must go through `wouldCreateCycle` in
  `src/lib/folders.ts` first. Rules reject a folder becoming its own parent
  but can't detect a move under one's own descendant — that check only exists
  client-side. See CONTEXT.md.
- Always write `deletedAt: null` when creating a note or folder — never omit
  the field. `where('deletedAt', '==', null)` does **not** match documents
  missing the field, so an absent value makes a document permanently
  invisible. The rules enforce this on create.
- A delete must write only `deletedAt`, and an autosave must not write
  `deletedAt`. Conflict resolution depends on the two touching disjoint fields
  so Firestore merges them instead of one clobbering the other.
- Queries combining the `deletedAt` filter with an `updatedAt`/`name` sort need
  the composite index in `firestore.indexes.json`. Missing indexes fail at
  runtime, not at build time.

## Auth

- Use `signInWithRedirect`, not `signInWithPopup`, in anything that ships.
  Safari's installed PWA standalone mode handles popups unreliably — redirect is
  the only method that works consistently there.
- Local dev is the one exception, branched on `import.meta.env.DEV` in
  `src/lib/auth.tsx`. Redirect cannot work on localhost: the SDK builds the
  handler URL as `https://${authDomain}/__/auth/handler`, with the scheme
  hardcoded and no port, so it can never point at a `http://localhost:5173` dev
  server. Popup can, because it returns its result via `postMessage` rather than
  a cross-site cookie. Two consequences:
  - **Dev does not exercise the redirect path**, so redirect regressions are
    invisible locally and only show up on a deployed build — check sign-in on
    `jottr26.vercel.app` after touching auth.
  - Local sign-in uses `jottr26.firebaseapp.com` and is therefore cross-site, so
    it may fail in desktop Safari while working in Chrome. Not worth chasing:
    the Safari case that matters is the installed PWA, which can only be tested
    against a deployed build anyway.
- On deployed builds `VITE_FIREBASE_AUTH_DOMAIN` is **not** the value from the
  Firebase console — it must be the domain the app is served from, with
  `vercel.json` proxying `/__/auth/*` to `jottr26.firebaseapp.com`. Pointing it
  straight at `firebaseapp.com` makes the redirect round-trip cross-site, which
  Safari's ITP blocks — so sign-in silently fails on the installed iPhone PWA
  while still working in desktop browsers. The value lives in Vercel's env vars,
  not in git.
- Changing the served domain means updating **three** separate places. Missing
  any one breaks sign-in, each with a different symptom:
  1. `VITE_FIREBASE_AUTH_DOMAIN` in Vercel's env vars — then redeploy, since
     Vite bakes the value in at build time and an env var change alone does
     nothing to the running deployment.
  2. Firebase console > Auth > Settings > Authorized domains.
  3. Google Cloud console > APIs & Services > Credentials > the auto-created Web
     client > Authorized redirect URIs (`https://DOMAIN/__/auth/handler`) and
     Authorized JavaScript origins (`https://DOMAIN`). Easy to miss because it
     lives outside the Firebase console entirely; skipping it gives Google's
     `Error 400: redirect_uri_mismatch` after the consent screen. Google's
     changes take a few minutes to propagate.
- Vercel preview deploys get generated per-deploy domains that will never be in
  any of those lists, so redirect sign-in cannot be verified on a preview — test
  it against the production deployment.
- `getRedirectResult` is called only to surface sign-in errors. Session state
  comes from `onAuthStateChanged`; nothing should block rendering on the
  redirect result resolving.

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

## Editor content

Lexical editor content is persisted as its JSON document model
(`SerializedEditorState`), not as serialized HTML. This avoids sanitization
concerns and round-trips cleanly through Lexical's own (de)serialization.

## Components & styling

- No component/UI library — build interactive components (dialogs, dropdowns,
  etc.) yourself with plain React and CSS Modules.
- Components are styled with colocated CSS Modules (`Component.tsx` +
  `Component.module.css`), imported as `styles` and applied via `styles.foo`.
- Shared CSS custom properties (colors, spacing, radius, font) live in
  `src/styles/theme.css` under `:root` — reference them from module CSS with
  `var(--color-foo)` rather than hardcoding values, so light/dark and theme
  changes stay centralized. Tokens are semantic (`--color-text-muted`, not
  `--grey-600`); add a token rather than a one-off value in a component.
- `src/globals.css` is the single stylesheet imported by the app (first import
  in `src/main.tsx`, so module CSS always loses ties on specificity). It pulls in
  `styles/reset.css` and `styles/theme.css` and holds document-level element
  defaults only — nothing that belongs to one component.
- CSS module class names are written in **camelCase in the CSS itself**
  (`.noteCard`, not `.note-card`), so the class name and the accessor are the
  same string and no build-time transform sits between them. Vite's
  `localsConvention` is deliberately left at its default. Turning on
  `camelCaseOnly` would let you keep kebab-case in CSS, but then only the
  camelCase key exists at runtime and `styles['note-card']` silently evaluates to
  `undefined` — Vite types CSS modules as an index signature, so tsc cannot catch
  it and the element just renders unstyled. One spelling everywhere removes the
  failure mode instead of documenting it.
- Dark mode follows `prefers-color-scheme` and nothing else — there is
  deliberately no in-app theme switch, so no JS, no persisted preference, and no
  flash of the wrong theme on load. Both scheme blocks set `color-scheme`, which
  is what makes native controls, scrollbars and form widgets follow along. Adding
  a manual override later means reintroducing the duplicate palette this decision
  removed; don't add one casually.
- The background colour is encoded in **three** places, none of which are linked
  automatically. Changing `--color-bg` means changing all three:
  1. `--color-bg` in `src/styles/theme.css` — what the app actually paints.
  2. The two `theme-color` meta tags in `index.html`, one per scheme. A single
     static value leaves the iOS status bar the wrong colour in one scheme.
  3. `theme_color` / `background_color` in the PWA manifest (`vite.config.ts`).
     The manifest has no per-scheme form, so both track the **light** value and
     the metas cover dark where the platform honours them. `background_color` is
     the standalone launch splash, so a dark-mode launch flashes light before the
     app paints. That is unavoidable without a per-scheme manifest; don't "fix"
     it by reintroducing a value that matches neither scheme.

## Formatting & linting

- Two static analysis tools, with deliberately no overlap between them:
  - **TypeScript** — `strict` mode plus `noUnusedLocals` / `noUnusedParameters`.
    Owns types, undefined names, unused code.
  - **ESLint** — `eslint-plugin-react-hooks` and nothing else. Owns the Rules of
    React (see below). It intentionally does not enable `@eslint/js` or
    `typescript-eslint` rule sets; `typescript-eslint` is installed for its
    parser alone. If tsc already catches it, it doesn't belong in ESLint.
- `npm run check` runs both; run it before committing. `npm run lint` is ESLint
  alone.
- No Prettier dependency, no pre-commit hooks (solo project, editor's Prettier
  extension handles formatting).

## React

Code must comply with the Rules of React strictly (no conditional hooks, no
mutating state/props during render, correct dependency treatment, etc.). React
Compiler depends on these rules holding for correct auto-memoization —
violations can cause silently incorrect memoization, not just lint warnings.
This is what ESLint exists for in this repo, and it is why the lint step is not
optional: tsc cannot see any of it.

## Comments

Comment sparingly. If code needs explaining, prefer making it clearer. Put
rationale in CONTEXT.md or here, not in doc blocks in every file.
