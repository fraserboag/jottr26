'use client'

import { Icon } from '@/components/ui/Icon'
import { MenuItem, Popover } from '@/components/ui/Popover'
import { trashPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'

/** The three-dot menu on a page, wherever the page is listed: a row in the
 *  sidebar, or an entry in a page's subpage list. One component so the two
 *  offer the same things. */
export function PageMenu({ page }: { page: PageRow }) {
  return (
    <Popover
      width={208}
      align="end"
      trigger={({ open, toggle, ref }) => (
        <button
          type="button"
          ref={ref}
          aria-label={`Actions for ${page.title || 'Untitled'}`}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
          className={`grid size-6 touch-manipulation place-items-center rounded-md transition-colors hover:bg-[var(--active)] hover:text-muted active:bg-[var(--active)] pointer-coarse:h-10 pointer-coarse:w-8 pointer-coarse:[&_svg]:size-5 ${
            open ? 'bg-[var(--active)] text-muted' : 'text-faint pointer-coarse:text-muted'
          }`}
        >
          <Icon name="more" size={16} strokeWidth={2.4} />
        </button>
      )}
    >
      {(close) => (
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
      )}
    </Popover>
  )
}
