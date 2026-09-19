'use client'

import { Icon } from '@/components/ui/Icon'
import { MenuItem, MenuSeparator, Popover } from '@/components/ui/Popover'
import { createPage, toggleFavorite, trashPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'
import { EmojiPicker } from './EmojiPicker'

export function TopBar({
  page,
  trail,
  sidebarHidden,
  onShowSidebar,
  onOpen,
}: {
  page: PageRow | null
  trail: PageRow[]
  sidebarHidden: boolean
  onShowSidebar: () => void
  onOpen: (id: string | null) => void
}) {
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center gap-1 border-b border-line bg-surface/85 px-2 backdrop-blur-md">
      {sidebarHidden && (
        <button
          type="button"
          onClick={onShowSidebar}
          aria-label="Show sidebar"
          className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted"
        >
          <Icon name="panel" size={16} />
        </button>
      )}

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {trail.map((crumb, index) => (
          <span key={crumb.id} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && <Icon name="chevronRight" size={12} className="text-faint" />}
            <button
              type="button"
              onClick={() => onOpen(crumb.id)}
              className={`truncate rounded px-1.5 py-1 text-[13px] transition-colors hover:bg-[var(--hover)] ${
                index === trail.length - 1 ? 'text-ink' : 'text-muted'
              }`}
            >
              {crumb.icon && <span className="mr-1">{crumb.icon}</span>}
              {crumb.title || 'Untitled'}
            </button>
          </span>
        ))}
      </nav>

      {page && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void toggleFavorite(page.id)}
            aria-label={page.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={page.isFavorite === 1}
            className={`grid size-7 place-items-center rounded-md transition-colors hover:bg-[var(--hover)] ${
              page.isFavorite ? 'text-warn' : 'text-faint'
            }`}
          >
            <Icon name="star" size={15} filled={page.isFavorite === 1} />
          </button>

          <Popover
            width={214}
            align="end"
            trigger={({ ref, toggle }) => (
              <button
                type="button"
                ref={ref}
                onClick={toggle}
                aria-label="Page actions"
                className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted"
              >
                <Icon name="more" size={16} strokeWidth={2.4} />
              </button>
            )}
          >
            {(close) => (
              <>
                <EmojiPicker pageId={page.id} onDone={close} />
                <MenuSeparator />
                <MenuItem
                  icon={<Icon name="plus" size={14} className="text-faint" />}
                  onClick={() => {
                    close()
                    void createPage({ parentId: page.id }).then(onOpen)
                  }}
                >
                  Add a subpage
                </MenuItem>
                <MenuItem
                  icon={<Icon name="trash" size={14} />}
                  tone="danger"
                  onClick={() => {
                    close()
                    void trashPage(page.id).then(() => onOpen(null))
                  }}
                >
                  Move to trash
                </MenuItem>
              </>
            )}
          </Popover>
        </div>
      )}
    </header>
  )
}
