'use client'

import { useCallback, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { createPage, dropRelative, type DropZone } from '@/lib/db/pages'
import { raiseKeyboard } from '@/lib/util/keyboard'
import type { TreeNode } from '@/lib/db/hooks'
import { PageMenu } from './PageMenu'

interface TreeProps {
  nodes: TreeNode[]
  openId: string | null
  onOpen: (id: string) => void
  expanded: ReadonlySet<string>
  onToggleExpand: (id: string) => void
  depth?: number
}

export function PageTree(props: TreeProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null)

  return (
    <Branch
      {...props}
      dragId={dragId}
      drop={drop}
      setDragId={setDragId}
      setDrop={setDrop}
    />
  )
}

interface BranchProps extends TreeProps {
  dragId: string | null
  drop: { id: string; zone: DropZone } | null
  setDragId: (id: string | null) => void
  setDrop: (value: { id: string; zone: DropZone } | null) => void
}

function Branch({ nodes, depth = 0, ...rest }: BranchProps) {
  return (
    <ul className="min-w-0">
      {nodes.map((node) => (
        <Row key={node.page.id} node={node} depth={depth} {...rest} />
      ))}
    </ul>
  )
}

function Row({
  node,
  depth,
  openId,
  onOpen,
  expanded,
  onToggleExpand,
  dragId,
  drop,
  setDragId,
  setDrop,
}: Omit<BranchProps, 'nodes'> & { node: TreeNode; depth: number }) {
  const { page, children } = node
  const isOpen = openId === page.id
  const isExpanded = expanded.has(page.id)
  const hasChildren = children.length > 0

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!dragId || dragId === page.id) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const offset = (event.clientY - rect.top) / rect.height
      // Edges reorder, the middle nests — the same gesture people expect from
      // every file tree they have used.
      const zone: DropZone = offset < 0.28 ? 'before' : offset > 0.72 ? 'after' : 'inside'
      setDrop({ id: page.id, zone })
    },
    [dragId, page.id, setDrop],
  )

  const active = drop?.id === page.id ? drop.zone : null

  return (
    <li>
      <div
        draggable
        onDragStart={(event) => {
          setDragId(page.id)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', page.id)
        }}
        onDragEnd={() => {
          setDragId(null)
          setDrop(null)
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDrop(null)}
        onDrop={(event) => {
          event.preventDefault()
          const zone = drop?.zone
          if (dragId && zone) {
            void dropRelative(dragId, page.id, zone)
          }
          setDragId(null)
          setDrop(null)
        }}
        // Each level steps in by one icon's width, so a sub-page's icon sits
        // just past its parent's and the tree reads in clean columns. The
        // icon is wider on a touch screen, and the step follows it.
        className={`group relative flex items-center gap-1.5 rounded-md pl-[calc(var(--depth)*20px+6px)] pr-1 transition-colors pointer-coarse:pl-[calc(var(--depth)*24px+6px)] ${
          isOpen ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'
        } ${dragId === page.id ? 'opacity-40' : ''} ${
          active === 'inside' ? 'ring-1 ring-inset ring-[var(--accent)]' : ''
        }`}
        style={{ '--depth': depth } as React.CSSProperties}
      >
        {active === 'before' && <Indicator className="top-0" />}
        {active === 'after' && <Indicator className="bottom-0" />}

        {/* A page with sub-pages shows its chevron where the page icon would
            be, as Notion does, so the row needs only the one icon. */}
        {hasChildren && (
          <button
            type="button"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpand(page.id)
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-[var(--active)] hover:text-muted pointer-coarse:size-6"
          >
            <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={14} strokeWidth={2} />
          </button>
        )}

        <button
          type="button"
          onClick={() => onOpen(page.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left pointer-coarse:py-2"
        >
          {!hasChildren && (
            <span className="grid size-5 shrink-0 place-items-center pointer-coarse:size-6">
              <Icon name="file" size={15} className="text-faint" />
            </span>
          )}
          <span
            className={`truncate ${isOpen ? 'font-medium text-ink' : '[font-weight:var(--body-weight)] text-ink'}`}
          >
            {page.title || 'Untitled'}
          </span>
        </button>

        {/* Shown on hover, or while the menu is open, which a touch screen
            never has, so there they stay, a little faded. Hidden, they take
            no width, so a long title runs to the row's edge. */}
        <div className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-opacity group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 has-[[aria-expanded=true]]:w-auto has-[[aria-expanded=true]]:overflow-visible has-[[aria-expanded=true]]:opacity-100 pointer-coarse:w-auto pointer-coarse:overflow-visible pointer-coarse:opacity-40">
          <PageMenu page={page} />

          <button
            type="button"
            aria-label="Add a subpage"
            onClick={(event) => {
              event.stopPropagation()
              raiseKeyboard()
              void createPage({ parentId: page.id }).then((id) => {
                if (!isExpanded) onToggleExpand(page.id)
                onOpen(id)
              })
            }}
            className="grid size-6 touch-manipulation place-items-center rounded-md text-faint transition-colors hover:bg-[var(--active)] hover:text-muted active:bg-[var(--active)] pointer-coarse:h-10 pointer-coarse:w-8 pointer-coarse:text-muted pointer-coarse:[&_svg]:size-5"
          >
            <Icon name="plus" size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <Branch
          nodes={children}
          depth={depth + 1}
          openId={openId}
          onOpen={onOpen}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          dragId={dragId}
          drop={drop}
          setDragId={setDragId}
          setDrop={setDrop}
        />
      )}
    </li>
  )
}

function Indicator({ className }: { className: string }) {
  return (
    <span
      className={`pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-accent ${className}`}
    />
  )
}
