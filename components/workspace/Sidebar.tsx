'use client'

import { useMemo, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'
import { createPageDropStore, PageDragContext, PageTree } from './PageTree'
import { buildTree, useDrawnRows, type TreeNode } from '@/lib/db/hooks'
import { createPage, movePageToWorkspace } from '@/lib/db/pages'
import { useWorkspaceOrderDrag } from './useWorkspaceOrderDrag'
import {
  toggleExpanded,
  toggleExpandedFavourite,
  useExpanded,
  useExpandedFavourites,
} from '@/lib/util/expanded'
import { raiseKeyboard } from '@/lib/util/keyboard'
import { useNoteWorkspaces } from './NoteWorkspacesContext'
import { SpaceSwitcher } from './SpaceSwitcher'
import type { View } from '@/lib/util/route'
import type { PageRow } from '@/lib/db/schema'

export function Sidebar({
  pages,
  openId,
  onOpen,
  view,
  onOpenView,
}: {
  pages: PageRow[]
  openId: string | null
  onOpen: (id: string | null) => void
  view: View | null
  onOpenView: (view: View) => void
}) {
  const { active, selectedId, inline, select } = useNoteWorkspaces()
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [pageDrop, setPageDrop] = useState<string | null>(null)
  const [pageDropStore] = useState(createPageDropStore)
  const pageDrag = useMemo(() => ({
    dragId,
    setDragId: (id: string | null) => {
      setDragId(id)
      setPageDrop(null)
      pageDropStore.set(null)
    },
    drop: pageDropStore,
    clearWorkspaceDrop: () => setPageDrop(null),
  }), [dragId, pageDropStore])
  const ordering = useWorkspaceOrderDrag(active, setError)
  const selected = active.find((row) => row.id === selectedId)
  const expanded = useExpanded()
  const expandedFavourites = useExpandedFavourites()

  // Sync rewrites rows' bookkeeping, which the sidebar doesn't draw; kept rows
  // mean the tree isn't rebuilt or redrawn for it.
  const rows = useDrawnRows(pages)
  const tree: TreeNode[] = useMemo(() => buildTree(rows), [rows])
  // Each favourite with its subpages, taken from the tree so they read the
  // same in both sections.
  const favourites: TreeNode[] = useMemo(() => {
    const nodes = new Map<string, TreeNode>()
    const walk = (list: TreeNode[]) => {
      for (const node of list) {
        nodes.set(node.page.id, node)
        walk(node.children)
      }
    }
    walk(tree)
    return rows.filter((page) => page.isFavorite).map((page) => nodes.get(page.id)!)
  }, [rows, tree])

  return (
    <PageDragContext.Provider value={pageDrag}>
    <div className="sidebar-tones relative flex h-full flex-col bg-sidebar">
      {/* Clicking the empty space under the list closes the open page, the
          trash or the settings. Rows, and the menus they portal out of this
          element, bubble through here too, so only a click that landed on the
          space itself counts — and not one on the scrollbar, which Firefox
          reports as a click on the element it scrolls. */}
      <nav
        onClick={(event) => {
          if ((!openId && !view) || event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX - bounds.left >= event.currentTarget.clientWidth) return
          onOpen(null)
        }}
        className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-[max(0.5rem,env(safe-area-inset-top))]"
      >
        {(inline ? active : selected ? [selected] : []).map((workspace, index) => {
          const nodes = tree.filter((node) => node.page.workspaceId === workspace.id)
          return (
            <section key={inline ? workspace.id : 'selected-space'} className={`relative ${inline ? `pt-2 pb-1 ${index > 0 ? 'mt-3' : 'mt-1'}` : ''} ${ordering.dragging === workspace.id ? 'opacity-40' : ''} ${dragId && pageDrop === workspace.id ? 'rounded-md ring-1 ring-inset ring-accent' : ''}`} aria-label={workspace.name}
              {...(inline ? ordering.containerProps(workspace.id) : {})}
              onDragOver={(event) => {
                if (!inline) return
                if (event.dataTransfer.types.includes('application/x-jottr-page') && dragId) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  pageDropStore.set(null)
                  setPageDrop(workspace.id)
                } else ordering.containerProps(workspace.id).onDragOver(event)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPageDrop(null)
                ordering.containerProps(workspace.id).onDragLeave(event)
              }}
              onDrop={(event) => {
                if (!inline) return
                const pageId = event.dataTransfer.getData('application/x-jottr-page')
                if (pageId) {
                  event.preventDefault()
                  event.stopPropagation()
                  void movePageToWorkspace(pageId, workspace.id).catch((error: Error) => setError(error.message))
                  setDragId(null)
                  setPageDrop(null)
                } else ordering.containerProps(workspace.id).onDrop(event)
              }}>
              {inline && ordering.drop?.id === workspace.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${ordering.drop.side === 'before' ? 'top-0' : 'bottom-0'}`} />}
              {!inline && active.length > 1 ? (
                <SpaceSwitcher spaces={active} selectedId={selectedId} onSelect={(id) => {
                  setError('')
                  void select(id).catch((error: Error) => setError(error.message))
                }} />
              ) : inline ? (
                <button type="button" {...ordering.handleProps(workspace.id)} className="flex max-w-full cursor-default items-center gap-1 px-2 pb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint pointer-coarse:text-[12.5px]">
                  <span className="truncate">{workspace.name}</span>
                </button>
              ) : <SectionLabel>{workspace.name}</SectionLabel>}
              <PageTree nodes={nodes} openId={openId} onOpen={onOpen} expanded={expanded} onToggleExpand={toggleExpanded} onDropError={setError} />
              <AddPage onClick={() => {
                raiseKeyboard()
                setError('')
                void createPage({ workspaceId: workspace.id }).then(onOpen).catch((error: Error) => setError(error.message))
              }} />
            </section>
          )
        })}
        {error && <p role="alert" className="px-2 py-2 text-danger">{error}</p>}

        {favourites.length > 0 && (
          <div className="mt-3">
            <SectionLabel>Favourites</SectionLabel>
            <PageTree nodes={favourites} openId={openId} onOpen={onOpen} expanded={expandedFavourites} onToggleExpand={toggleExpandedFavourite} draggable={false} />
          </div>
        )}
      </nav>

      <footer className="flex flex-col border-t border-line px-3 pt-[13px] pb-[max(13px,env(safe-area-inset-bottom))]">
        <SidebarAction
          icon="settings"
          label="Settings"
          current={view === 'settings'}
          onClick={() => onOpenView('settings')}
        />
        <SidebarAction
          icon="trash"
          label="Trash"
          current={view === 'trash'}
          onClick={() => onOpenView('trash')}
        />
      </footer>
    </div>
    </PageDragContext.Provider>
  )
}

function AddPage({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Lines up with the pages above it, the plus sitting where each page's
      // icon sits.
      className="my-px flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-[14.5px] text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:text-[15px]"
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Icon name="plus" size={15} strokeWidth={2} />
      </span>
      <span className="flex-1 text-left">Add page</span>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="cursor-default px-2 pb-1.5 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint pointer-coarse:text-[12.5px]">
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
      // Spaced as the page rows above are, the icon in the same slot. The
      // footer is a column, so the margins add up to the rows' 2px gap.
      className={`my-px flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-[14.5px] text-muted transition-colors pointer-coarse:text-[15px] ${
        current ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'
      }`}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Icon name={icon} size={15} className="text-muted" />
      </span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}
