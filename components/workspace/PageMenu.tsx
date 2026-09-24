'use client'

import { Icon } from '@/components/ui/Icon'
import { MenuItem, MenuSeparator, Popover } from '@/components/ui/Popover'
import { toggleFavorite, trashPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'

/** The three-dot menu on a page, wherever the page is listed: a row in the
 *  sidebar, or an entry in a page's subpage list. One component so the two
 *  offer the same things. */
export function PageMenu({ page }: { page: PageRow }) {
  return (
    <Popover
      width="auto"
      align="end"
      trigger={({ open, toggle, ref }) => (
        <button
          type="button"
          ref={ref}
          aria-label={`Actions for ${page.title || 'Untitled'}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
          className={`grid size-6 touch-manipulation place-items-center rounded-md transition-colors hover:bg-[var(--active)] hover:text-muted active:bg-[var(--active)] pointer-coarse:h-10 pointer-coarse:w-8 pointer-coarse:[&_svg]:size-5 ${
            open ? 'bg-[var(--active)] text-muted' : 'text-faint pointer-coarse:text-muted'
          }`}
        >
          {/* Heavier than the other icons' strokes: at their weight the dots
              are specks. */}
          <Icon name="more" size={16} strokeWidth={3.6} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon={<Icon name="star" size={14} filled={page.isFavorite === 1} />}
            onClick={() => {
              void toggleFavorite(page.id)
              close()
            }}
          >
            {page.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="trash" size={14} />}
            tone="danger"
            onClick={() => {
              void trashPage(page.id)
              close()
            }}
          >
            Trash
          </MenuItem>
        </>
      )}
    </Popover>
  )
}
