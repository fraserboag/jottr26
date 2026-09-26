'use client'

import { useMemo } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'
import { MenuItem, MenuSeparator, Popover } from '@/components/ui/Popover'
import { PageMenu } from './PageMenu'
import { PageTree } from './PageTree'
import { SyncStatusRow, useForceSync } from './SyncControls'
import { useSyncStatus, useWorkspace } from './WorkspaceProvider'
import { buildTree, type TreeNode } from '@/lib/db/hooks'
import { createPage } from '@/lib/db/pages'
import { toggleExpanded, useExpanded } from '@/lib/util/expanded'
import { raiseKeyboard } from '@/lib/util/keyboard'
import type { PageRow } from '@/lib/db/schema'

export function Sidebar({
  pages,
  openId,
  onOpen,
  trashOpen,
  onOpenTrash,
}: {
  pages: PageRow[]
  openId: string | null
  onOpen: (id: string | null) => void
  trashOpen: boolean
  onOpenTrash: () => void
}) {
  const { session } = useWorkspace()
  const forceSync = useForceSync()
  const expanded = useExpanded()

  const tree: TreeNode[] = useMemo(() => buildTree(pages), [pages])
  const favourites = useMemo(() => pages.filter((page) => page.isFavorite), [pages])

  return (
    <div className="sidebar-tones flex h-full flex-col bg-sidebar">
      <header className="flex items-center gap-1 px-3 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="mr-auto min-w-0 truncate px-2 py-1.5 text-[17px] font-semibold tracking-[-0.01em] text-ink pointer-coarse:text-[19px]">
          Jottr
        </span>
        <Popover
          width="auto"
          align="end"
          className="min-w-[244px]"
          trigger={({ ref, toggle }) => (
            <button
              type="button"
              ref={ref}
              onClick={toggle}
              aria-label="Settings"
              className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink pointer-coarse:size-9"
            >
              <Icon name="settings" size={18} className="pointer-coarse:size-5" strokeWidth={1.8} />
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-ink pointer-coarse:py-2.5">
                <Icon name="user" size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{session?.user.email}</span>
              </p>
              <MenuSeparator />
              <SyncStatusRow
                onForceSync={() => {
                  close()
                  void forceSync.startSync()
                }}
              />
              <MenuSeparator />
              <SignOutItem close={close} />
            </>
          )}
        </Popover>
      </header>

      {forceSync.overlay}

      {/* Clicking the empty space under the list closes the open page, or the
          trash. Rows, and the menus they portal out of this element, bubble
          through here too, so only a click that landed on the space itself
          counts — and not one on the scrollbar, which Firefox reports as a
          click on the element it scrolls. */}
      <nav
        onClick={(event) => {
          if ((!openId && !trashOpen) || event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX - bounds.left >= event.currentTarget.clientWidth) return
          onOpen(null)
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4"
      >
        <SectionLabel>Pages</SectionLabel>
        {tree.length === 0 ? (
          <p className="px-2 py-2 leading-relaxed text-faint">
            No pages yet. Create one to get started.
          </p>
        ) : (
          <PageTree
            nodes={tree}
            openId={openId}
            onOpen={onOpen}
            expanded={expanded}
            onToggleExpand={toggleExpanded}
          />
        )}
        <AddPage
          onClick={() => {
            raiseKeyboard()
            void createPage().then(onOpen)
          }}
        />

        {favourites.length > 0 && (
          <div className="mt-3">
            <SectionLabel>Favourites</SectionLabel>
            <ul className="min-w-0">
              {favourites.map((page) => (
                <Favourite key={page.id} page={page} isOpen={openId === page.id} onOpen={onOpen} />
              ))}
            </ul>
          </div>
        )}
      </nav>

      <footer className="border-t border-line px-3 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <SidebarAction icon="trash" label="View Trash" current={trashOpen} onClick={onOpenTrash} />
      </footer>
    </div>
  )
}

/** Its own component so that only an open settings menu follows the pending
 *  count, rather than the whole sidebar. */
function SignOutItem({ close }: { close: () => void }) {
  const { signOut } = useWorkspace()
  const status = useSyncStatus()
  return (
    <MenuItem
      icon={<Icon name="logout" size={14} />}
      tone="danger"
      onClick={() => {
        // Signing out erases the local copy, so unsynced work has to
        // be called out rather than quietly discarded.
        if (
          status.pending > 0 &&
          !window.confirm(
            `${status.pending} ${status.pending === 1 ? 'page has' : 'pages have'} changes that haven't reached your account yet. Signing out now will discard them. Continue?`,
          )
        ) {
          return
        }
        close()
        void signOut()
      }}
    >
      Sign out
    </MenuItem>
  )
}

/** A row drawn like the page tree's, flat and without the tree's drag, which
 *  would move the page itself rather than reorder the favourites. */
function Favourite({
  page,
  isOpen,
  onOpen,
}: {
  page: PageRow
  isOpen: boolean
  onOpen: (id: string | null) => void
}) {
  return (
    <li>
      <div
        className={`group flex items-center gap-1.5 rounded-md pl-1.5 pr-1 transition-colors ${
          isOpen ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(page.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left pointer-coarse:py-2"
        >
          <span className="grid size-5 shrink-0 place-items-center pointer-coarse:size-6">
            <Icon name="file" size={15} className="text-faint" />
          </span>
          <span
            className={`truncate ${isOpen ? 'font-medium text-ink' : '[font-weight:var(--body-weight)] text-ink'}`}
          >
            {page.title || 'Untitled'}
          </span>
        </button>
        {/* Shown on hover, or while the menu is open, which a touch screen
            never has, so there it stays, a little faded. Hidden, it takes
            no width, so a long title runs to the row's edge. */}
        <div className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-opacity group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 has-[[aria-expanded=true]]:w-auto has-[[aria-expanded=true]]:overflow-visible has-[[aria-expanded=true]]:opacity-100 pointer-coarse:w-auto pointer-coarse:overflow-visible pointer-coarse:opacity-40">
          <PageMenu page={page} />
        </div>
      </div>
    </li>
  )
}

function AddPage({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Lines up with the pages above it, the plus sitting where each page's
      // icon sits.
      className="flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:py-2"
    >
      <span className="grid size-5 shrink-0 place-items-center pointer-coarse:size-6">
        <Icon name="plus" size={15} strokeWidth={2} />
      </span>
      <span className="flex-1 text-left">Add new</span>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1.5 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint pointer-coarse:text-[12.5px]">
      {children}
    </p>
  )
}

function SidebarAction({
  icon,
  label,
  current,
  onClick,
}: {
  icon: IconName
  label: string
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-muted transition-colors pointer-coarse:py-2.5 ${
        current ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'
      }`}
    >
      <Icon name={icon} size={16} className="text-faint" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}
