# Spaces feature plan

Status: implemented locally, including a Move to space menu and touch buttons for space ordering. The Supabase schema must be applied before deployment; browser and live database behaviour awaits manual verification.

## Goal and agreed behaviour

Spaces separate groups of pages within one account, such as Personal and Work. They are organisational boundaries, with no sharing or separate accounts.

- New accounts start with one space named **Pages**. The sidebar looks as it does today, including existing onboarding.
- Existing accounts receive the same space, containing all existing pages, including trashed pages. Page IDs, links, hierarchy, order, content and favourites remain intact.
- Settings provides space creation, renaming and deletion.
- Deleting a space moves its live pages to Trash for recovery. Already-trashed pages remain recoverable; space deletion does not permanently erase notes.
- The default display shows one space at a time. With multiple spaces, a dropdown arrow appears beside the current space name where **PAGES** currently appears. One space has no arrow.
- Settings offers **Inline spaces**, off by default. Inline mode shows each space as its own section, using the current Pages/Favourites heading style, with no space dropdown.
- Favourites contains only the selected space's favourites in default mode, and favourites from all spaces in inline mode. Preserve current favourite rows and their subpages.

## Recommended interaction details

These fill gaps in the brief and can be adjusted before implementation.

| Area | Proposed behaviour |
| --- | --- |
| Settings | Add a Spaces section with name and Rename/Delete actions for each space, plus Add space. Put the Inline spaces toggle here. |
| Names | Trim whitespace; require a non-empty name; prevent duplicate names among active spaces within an account, ignoring case. Renaming Pages changes the sidebar heading too. If restoring a deleted space conflicts with an active name, offer a new name. |
| Space order | Drag space headings in inline mode or the handles in Settings to reorder them. The order is saved and synced, and used in Settings, the dropdown and inline sections. Focus a handle and use Up/Down for keyboard reordering. |
| Switching | Save the current editor using the existing close/flush path, then open the last viewed live page in the destination space, or its empty state. Remember that choice per device. |
| Creating pages | Each visible space section has its own Add new action. Root pages go into that section's space; subpages inherit their parent's space. Empty spaces show their heading and Add new action, without an empty-state message. |
| Inline favourites | Use one uninterrupted Favourites list after the space sections, without space labels or separate groups. |
| Navigation | Existing page URLs keep working. Opening a page link or using Back/Forward selects its owning space in default mode. In inline mode it highlights the page in its section. |
| Page search/link picker | Search the selected space in default mode and all visible spaces in inline mode. Existing cross-space links still open their destination and switch context. |
| Trash | Ordinary trashed pages follow the same scope: selected space in default mode, all active spaces in inline mode. Include notes from deleted spaces in the same list in both modes. Empty trash deletes the displayed list, including notes from deleted spaces. |
| Last space | Prevent deleting the last remaining space, keeping the account usable. The original Pages space can be renamed or deleted once another exists. |
| Preferences | Space names, ownership and ordering sync across devices. Keep display mode, selected space and last viewed pages per account on each device, consistent with the current local theme preference. |

### Space deletion

Confirmed preference: deleting a space moves its live pages, including nested pages, to Trash. Already-trashed pages stay in Trash, and no page content is permanently erased by this action. Retain the space as a recoverable record, hidden from Settings' active space list, the sidebar and its dropdown.

Confirmation example:

> Deleting this space will move all of its pages to Trash.

Use explicit Cancel and Delete space actions. The operation also covers pages not yet downloaded and pages created on other devices before the server processes deletion. After deletion, fall back to the first remaining active space and close any deleted open page. If it happens from another device, apply the same fallback without throwing the user out of Settings.

Recovery interaction: Trash includes notes from deleted spaces in the normal list in both display modes, labelled with their space name. Restoring a note reactivates its space with only that note; other notes, including its children, remain in Trash until individually restored. Existing restore-to-root behaviour applies when its parent stays trashed. There are no separate space recovery sections or space restore/purge buttons.

Keep deletion provenance so later restores of notes moved by space deletion also restore individually. Once the space is active again, remaining trashed pages appear in its ordinary Trash scope. Empty trash deletes the displayed notes, including notes from deleted spaces, after its usual confirmation.

## Implementation design

The current app uses one Dexie database per account, local page metadata, Yjs documents and Supabase sync. Keep that architecture: add spaces inside the account database rather than creating a database per space.

1. **Data model:** add space rows locally and in Supabase, with ID, account ownership, name, ordering, timestamps, soft-deletion state and sync bookkeeping. Add a required `workspaceId` to page metadata and its tracked dirty fields. Record space-deletion provenance for pages newly moved to Trash, using a deletion operation identifier. Index live root queries by space and parent so pages from different spaces do not share sibling ordering. Keep document content keyed by the existing page IDs.
2. **Migration/bootstrap:** bump the Dexie version and backfill existing live and trashed pages into Pages. Make default-space creation idempotent across devices, using one stable identity per account. Distinguish initial bootstrap from a later deletion so Pages is not recreated. Preserve dirty offline edits. Onboarding runs once for the account, not once for every empty space.
3. **Sync:** pull space metadata and deletion markers before resolving page membership; push new spaces before their pages. Add space changes to realtime subscriptions, retry handling and pending-change status. Switching spaces changes the UI scope; all account spaces continue syncing.
4. **Deletion and recovery:** queue soft deletion durably offline, and use a server transaction that marks the space deleted and moves its live pages to Trash, retaining documents. Apply the matching local changes atomically. Preserve already-trashed pages' deletion state. Late offline creations in a deleted space must arrive as recoverable trashed pages; pending document edits may sync without making their pages or space live. Stale metadata cannot clear deletion implicitly. Restoration is an explicit operation applied coherently to space state and the intended pages. Reserve purge queues and durable space/page tombstones for confirmed permanent deletion; after a purge, reject stale writes so nothing is resurrected. Enforce account ownership on space membership and server operations.
5. **UI state:** add a distinct space-selection context. The existing `WorkspaceProvider` handles authentication, storage and sync, so avoid overloading its current `useWorkspace()` name with selection semantics. Keep the account-wide page map for link resolution; derive visible page lists separately for sidebar, favourites, search and Trash.
6. **Page operations:** pass space membership explicitly for root creation; derive it from parents for children. Make sibling queries, restore-to-root and drag/drop space-aware. In inline mode, dropping on another space's heading or Add new area moves a note to its root; dropping on a note uses the existing before/after/inside positions. Move the complete subtree, including trashed descendants, while preserving IDs, documents, favourites and deletion state. Queue moves durably and transfer server-side subtrees atomically, including children the moving device has not downloaded. Parent and child must belong to the same space.

Primary implementation files: `lib/db/schema.ts`, `lib/db/dexie.ts`, `lib/db/pages.ts`, `lib/db/hooks.ts`, `lib/sync/engine.ts`, `supabase/schema.sql`, and the Sidebar, Space, SettingsPage, TrashPage and LinkPicker components. Add a dedicated space data module and selection context.

## Delivery sequence

1. Review the proposed recovery interactions and other defaults above. Moving notes to Trash on space deletion is confirmed.
2. Implement schema, migrations, space CRUD and sync, including soft deletion, recovery and deletion conflict handling.
3. Add Settings management and the default sidebar switcher; connect page creation, navigation, favourites, search and Trash to space scope, including deleted spaces’ notes in the normal Trash list.
4. Add inline mode and its per-section creation actions.

Cross-space drag/drop is implemented in inline mode. The **Move to space** menu also transfers notes and their subtrees in either display mode without dragging. Settings provides touch buttons for space ordering.

Deploy the compatible Supabase schema before the client. Review cached older PWA builds: legacy inserts must receive a valid space, and stale writes must never bypass space deletion. Define an update-required response for incompatible clients rather than silently misfiling notes.

## Acceptance and validation

- A fresh account and an upgraded account retain the familiar single-Pages experience; onboarding is not repeated in new spaces.
- Creating and renaming spaces updates Settings and the sidebar; adding a second reveals the switcher, returning to one removes it.
- Root creation and nested-page creation always choose the correct space; sibling ordering never mixes spaces.
- Switching scopes pages and favourites correctly. Inline mode displays all sections, each with its own Add new action and one combined Favourites section.
- Direct links and browser history reveal the correct active space; links to trashed pages do not implicitly restore anything. Search and Trash follow the agreed scope, including scoped Empty trash and always-accessible notes from deleted spaces.
- Deletion moves live and nested pages to Trash without purging content; previously trashed pages remain recoverable. Last-active-space deletion is blocked. Deletion converges across devices, even when another device has pending edits or creates a page offline.
- Individual restoration reactivates the owning space with only the restored note, preserving its content and favourites. Subsequent restores add one note at a time. Name conflicts are handled; Empty trash uses its usual confirmation for all displayed notes.
- The switcher supports keyboard use and touch.

When implemented, add focused tests for migration/bootstrap, space ownership in page operations, scope filtering, recovery provenance and offline deletion/restoration convergence. Default validation should use quick targeted checks only. Do not run browser automation, broad suites or a production build without a request. Hand over for manual testing after those checks and wait for feedback before further validation or iteration.

Implementation validation and manual testing instructions are recorded in `docs/workspaces-testing.md`. The relevant bundled Next.js guides were read before implementation. No browser automation or production build is part of default verification.
