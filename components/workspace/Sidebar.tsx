'use client'

import { useCallback, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'
import { MenuItem, MenuSeparator, Popover } from '@/components/ui/Popover'
import { PageTree } from './PageTree'
import { SyncIndicator } from './SyncIndicator'
import { useWorkspace } from './WorkspaceProvider'
import { buildTree, type TreeNode } from '@/lib/db/hooks'
import { createPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'

const EXPANDED_KEY = 'jottr.expanded'

export function Sidebar({
  pages,
  openId,
  onOpen,
  onOpenSearch,
  onOpenTrash,
  onCollapse,
}: {
  pages: PageRow[]
  openId: string | null
  onOpen: (id: string | null) => void
  onOpenSearch: () => void
  onOpenTrash: () => void
  onCollapse: () => void
}) {
  const { session, signOut, status } = useWorkspace()
  // The sidebar only ever renders after the workspace has mounted and read
  // IndexedDB, so there is no server render to disagree with.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })

  const toggleExpand = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      } catch {
        /* Ignore. */
      }
      return next
    })
  }, [])

  const tree: TreeNode[] = buildTree(pages)

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <header className="flex items-center gap-1 px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Popover
          width={244}
          trigger={({ ref, toggle }) => (
            <button
              type="button"
              ref={ref}
              onClick={toggle}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-[var(--hover)]"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[#1a1a19] text-[11px] font-bold text-white pointer-coarse:size-7 pointer-coarse:text-[13px]">
                J
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-ink pointer-coarse:text-[15px]">
                Jottr
              </span>
              <Icon name="chevronDown" size={13} className="text-faint pointer-coarse:size-[15px]" strokeWidth={2} />
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="truncate px-2.5 pb-1.5 pt-1 text-[12px] text-faint pointer-coarse:text-[13px]">
                {session?.user.email}
              </p>
              <MenuSeparator />
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
            </>
          )}
        </Popover>

        <SyncIndicator />

        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide sidebar"
          className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:size-9"
        >
          <Icon name="panel" size={16} className="pointer-coarse:size-5" />
        </button>
      </header>

      {/* Clicking the empty space under the list closes the open page. Rows,
          and the menus they portal out of this element, bubble through here
          too, so only a click that landed on the space itself counts — and
          not one on the scrollbar, which Firefox reports as a click on the
          element it scrolls. */}
      <nav
        onClick={(event) => {
          if (!openId || event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX - bounds.left >= event.currentTarget.clientWidth) return
          onOpen(null)
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        <SectionLabel>Pages</SectionLabel>
        {tree.length === 0 ? (
          <p className="px-2 py-2 text-[12.5px] leading-relaxed text-faint pointer-coarse:text-[14px]">
            No pages yet. Create one to get started.
          </p>
        ) : (
          <PageTree
            nodes={tree}
            openId={openId}
            onOpen={onOpen}
            expanded={expanded}
            onToggleExpand={toggleExpand}
          />
        )}
        <AddPage onClick={() => void createPage().then(onOpen)} />
      </nav>

      <footer className="border-t border-line px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <SidebarAction icon="search" label="Search" shortcut="⌘K" onClick={onOpenSearch} />
        <SidebarAction icon="trash" label="Trash" onClick={onOpenTrash} />
      </footer>
    </div>
  )
}

function AddPage({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Lines up with the page titles above it: past the chevron column, with
      // the plus sitting where each page's icon sits. The chevron is wider on
      // a touch screen, and the offset follows it.
      className="flex w-full items-center gap-1.5 rounded-md py-1 pl-7 pr-1 pointer-coarse:pl-9 text-[13px] text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:py-2 pointer-coarse:text-[15px]"
    >
      <span className="w-4 shrink-0">
        <Icon name="plus" size={14} strokeWidth={2} />
      </span>
      <span className="flex-1 text-left">Add new</span>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint pointer-coarse:text-[12px]">
      {children}
    </p>
  )
}

function SidebarAction({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-muted transition-colors hover:bg-[var(--hover)] pointer-coarse:py-2.5 pointer-coarse:text-[15px]"
    >
      <Icon name={icon} size={15} className="text-faint" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[11.5px] text-faint pointer-coarse:hidden">{shortcut}</span>}
    </button>
  )
}
