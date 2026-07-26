# Jottr

A small notes app: create, edit, and organize short text notes with basic rich
text formatting (bold, italic, strikethrough, links, quotes, bullet lists).
Headings are deliberately out — bold text carries that weight instead.

Primary surfaces are iPhone and macOS as installed PWAs (Safari's "Add to Home
Screen" / "Add to Dock"); the web interface is valuable but secondary. Works
offline (notes stored locally via Firestore's offline persistence) and syncs
across devices in real time once connectivity returns.

## Stack

- Vite + React + TypeScript, React Compiler
- Firebase — Auth (Google sign-in only) and Firestore (data + offline
  persistence)
- Lexical for rich text editing
- Vanilla React + CSS Modules (no component library)
- Deployed on Vercel

## Editor

Formatting is available three ways, and they all go through the same Lexical
commands: the toolbar, the standard shortcuts (cmd+B, cmd+I) that Lexical
handles in core, and Markdown shortcuts as you type. The transformer set is
`NOTE_TRANSFORMERS` in `src/components/NoteEditor.tsx` — the stock list minus
headings and inline code, with strikethrough rebound to a single tilde
(`~text~`).

The toolbar in `src/components/FormattingToolbar.tsx` has two presentations
over one set of state, chosen by `(pointer: coarse)`:

- **Mouse** — a popover floating over the selection, shown only when there is
  one.
- **Touch** — a bar docked above the keyboard, shown whenever the editor has
  focus, positioned from `visualViewport` since that is the only thing that
  reports where the keyboard's top edge is.

Touch is docked rather than floating because iOS puts its own Cut/Copy/Paste
callout directly over a selection and will not yield that space to a
contenteditable. Docking also means the bar can act on a collapsed cursor —
tapping Bold with nothing selected sets the format for what you type next,
which a selection-anchored bar cannot do. The link button is the one control
that still needs a selection, and disables itself without one.

Paste is handled in three layers, ordered by command priority so each gets
first refusal before the next:

| Handler | Priority | Behaviour |
| --- | --- | --- |
| `PasteLinkPlugin` | `HIGH` | A bare URL pasted onto selected text links that text rather than replacing it |
| `MarkdownPastePlugin` | `LOW` | Plain text that looks like Markdown is parsed and inserted at the cursor |
| Lexical rich text | `EDITOR` | Everything else, including HTML from other apps |

Markdown detection is deliberately conservative — a handful of high-confidence
markers (list, quote and fence at line start, `**bold**`, `[text](url)`) decide
whether the text is Markdown at all, after which the full transformer set
applies. Prose containing a stray asterisk is not reinterpreted.

Two consequences of that layering:

- Clipboard content carrying `text/html` skips the Markdown path entirely,
  since Lexical's HTML import handles it better than re-reading the plain-text
  fallback would. Editors that copy syntax-highlighted HTML (VS Code) therefore
  paste Markdown source as styled text rather than converting it.
- Headings are not in the transformer set, so a pasted `# Title` stays literal
  — the same as typing it.

## Autosave

Notes save themselves; there is no save button. The policy, implemented in
`src/lib/useAutosave.ts`:

| Lever | Value | Effect |
| --- | --- | --- |
| Trailing debounce | 1000 ms | Continuous typing writes nothing until it stops |
| Post-write cooldown | 5000 ms per note | Ceiling of 12 writes/min/note while editing |
| Explicit flush | Bypasses the cooldown | Blur, unmount, and page-hide always write |

The cooldown is the write ceiling, and it is the part that matters for keeping
running costs near zero. A debounce alone is not a cap: a pause longer than the
debounce produces a write, and pausing to think mid-sentence is the normal
rhythm in a notes app, so the naive version lands ~60 writes/min on a single
note. The ceiling is per note because the hook instance is per note — the
editor is keyed on the note id, so no shared bookkeeping is needed.

Explicit flushes ignore the ceiling on purpose. A cap that swallows the last
edit before you navigate away is worse than the writes it saves, and flushes
triggered by a human are self-limiting anyway.

Two consequences worth knowing:

- Status can sit at `pending` for up to the cooldown. That is accurate: it
  means the edit is not written yet.
- A rejected write is not retried. Firestore's offline persistence queues
  writes rather than rejecting them, so a rejection means a rules violation or
  similar — something a retry would not fix.

Edits are durable locally as soon as the write is issued, since Firestore's
cache is written before the server round-trip. The debounce window is therefore
the only true data-loss window, which is why it stays short while the cooldown
does the cost work.

## Development

```bash
npm install
npm run dev      # start dev server
npm run build    # typecheck + production build
npm run preview  # preview a production build locally
npm run lint     # Rules of React / React Compiler checks
npm run check    # typecheck + lint (run before committing)
```

Firestore rules are **not** deployed by the app pipeline. They are deployed
using `firebase deploy`

## Status

Built: Google sign-in, the note tree with folders and drag-reordering, the
Lexical editor (floating toolbar, Markdown shortcuts and paste, links with
editing and removal), autosave with cross-device sync, and trash with restore
and TTL reaping.

Next up: linking notes to each other. Bullets are reachable by typing `- ` and
deliberately have no toolbar button.

Not yet decided: the schema migration path — documents carry no version field
today, so growing the Lexical node set has no story yet for clients running an
older cached build. Note-to-note links are the likely trigger: reusing
`LinkNode` with an internal href avoids growing the node set, a dedicated node
type would not.
