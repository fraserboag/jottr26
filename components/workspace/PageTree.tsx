'use client'

import { useCallback, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { MenuItem, Popover } from '@/components/ui/Popover'
import { createPage, dropRelative, trashPage, type DropZone } from '@/lib/db/pages'
import { raiseKeyboard } from '@/lib/util/keyboard'
import type { TreeNode } from '@/lib/db/hooks'

interface TreeProps {
  nodes: TreeNode[]
  openId: string | null
  onOpen: (id: string) => void
  expanded: Set<string>
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
            void dropRelative(dragId, page.id, zone).then(() => {
              if (zone === 'inside') onToggleExpand(page.id)
            })
          }
          setDragId(null)
          setDrop(null)
        }}
        className={`group relative flex items-center gap-1 rounded-md pr-1 transition-colors ${
          isOpen ? 'bg-[var(--active)]' : 'hover:bg-[var(--hover)]'
        } ${dragId === page.id ? 'opacity-40' : ''} ${
          active === 'inside' ? 'ring-1 ring-inset ring-[var(--accent)]' : ''
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {active === 'before' && <Indicator className="top-0" />}
        {active === 'after' && <Indicator className="bottom-0" />}

        <button
          type="button"
          aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (hasChildren) onToggleExpand(page.id)
          }}
          className={`grid size-5 shrink-0 place-items-center rounded text-faint transition-colors pointer-coarse:size-7 ${
            hasChildren ? 'hover:bg-[var(--active)] hover:text-muted' : 'invisible'
          }`}
          tabIndex={hasChildren ? 0 : -1}
        >
          <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={14} strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={() => onOpen(page.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left pointer-coarse:py-2"
        >
          <span className="w-4 shrink-0 text-center text-[13px] leading-none">
            <Icon name="file" size={15} className="text-faint" />
          </span>
          <span
            className={`truncate ${isOpen ? 'font-medium text-ink' : 'text-muted'}`}
          >
            {page.title || 'Untitled'}
          </span>
        </button>

        {/* Shown on hover, which a touch screen never has, so there they stay. */}
        <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          <Popover
            width={208}
            trigger={({ toggle, ref }) => (
              <button
                type="button"
                ref={ref}
                aria-label={`Actions for ${page.title || 'Untitled'}`}
                onClick={(event) => {
                  event.stopPropagation()
                  toggle()
                }}
                className="grid size-5 place-items-center rounded text-faint hover:bg-[var(--active)] hover:text-muted pointer-coarse:size-8"
              >
                <Icon name="more" size={15} strokeWidth={2.4} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Icon name="trash" size={14} />}
                  tone="danger"
                  onClick={() => {
                    void trashPage(page.id)
                    close()
                  }}
                >
                  Move to trash
                </MenuItem>
              </>
            )}
          </Popover>

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
            className="grid size-5 place-items-center rounded text-faint hover:bg-[var(--active)] hover:text-muted pointer-coarse:size-8"
          >
            <Icon name="plus" size={15} strokeWidth={2.2} />
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
