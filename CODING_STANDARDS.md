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

## Components

- shadcn components under `src/components/ui` are owned code, not a locked
  dependency. Edit them directly when a feature needs it — don't treat them
  as immutable vendor code.

## Formatting & linting

- Prettier + ESLint + husky/lint-staged run automatically on commit. Don't
  hand-format against the configured rules — if the formatting looks wrong,
  fix the config, don't fight it manually.

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
