# Jottr — Coding Standards

Concrete conventions for this repo. See CONTEXT.md for the product/stack
reasoning behind these rules.

## Data access

- All app data lives under `/users/{uid}/...` in Firestore. Never store app
  data outside a user's own scope — there is no shared/global collection for
  notes or related data.
- Firestore security rules (`firestore.rules`) enforce this at the database
  level: a user may only read/write documents under their own `/users/{uid}`
  subtree. Everything else is denied by default. Treat the rules file as the
  source of truth, not client-side checks.

## Auth

- Use `signInWithRedirect`, not `signInWithPopup`. Safari's installed PWA
  standalone mode handles popups unreliably — redirect is the only method
  that works consistently there.

## Editor content

- Lexical editor content is persisted as its JSON document model
  (`SerializedEditorState`), not as serialized HTML. This avoids
  sanitization concerns and round-trips cleanly through Lexical's own
  (de)serialization.

## Components & styling

- Components are styled with colocated CSS Modules (`Component.tsx` +
  `Component.module.css`), imported as `styles` and applied via
  `styles.foo`.
- Shared CSS custom properties (colors, radius, font) live in `src/index.css`
  under `:root` — reference them from module CSS with `var(--color-foo)`
  rather than hardcoding values, so light/dark and theme changes stay
  centralized.
- No component/UI library — build interactive components (dialogs, dropdowns,
  etc.) yourself with plain React and CSS Modules. Handle accessibility (ARIA
  roles, keyboard interaction, focus management) directly rather than pulling
  in a primitives or wrapper library.

## Formatting & linting

- No ESLint. TypeScript's `strict` mode plus `noUnusedLocals` /
  `noUnusedParameters` (run via `npm run build`) are the only static analysis.
  Don't reintroduce ESLint without raising it first.
- No Prettier dependency, no pre-commit hooks (solo project, editor's
  Prettier extension handles formatting). Don't reintroduce husky/lint-staged
  without raising it first.

## React

- Code must comply with the Rules of React strictly (no conditional hooks,
  no mutating state/props during render, correct dependency treatment,
  etc.). React Compiler depends on these rules holding for correct
  auto-memoization — violations can cause silently incorrect memoization,
  not just lint warnings.

## Explicitly out of scope (for now)

These are intentional scope decisions, not oversights. Don't add them
without raising it first:

- No testing libraries (Vitest, Testing Library).
- No form libraries (React Hook Form, Zod).
