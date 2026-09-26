'use client'

import { Icon } from '@/components/ui/Icon'
import type { PageRow } from '@/lib/db/schema'

/** The part of a sidebar row that opens the page: its icon, where it has one,
 *  and its title. Shared by the page tree and the favourites. */
export function PageRowButton({
  page,
  isOpen,
  onOpen,
  icon = true,
}: {
  page: PageRow
  isOpen: boolean
  onOpen: (id: string) => void
  /** Off for a tree row with sub-pages, whose chevron stands in its place. */
  icon?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(page.id)}
      className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left pointer-coarse:py-2"
    >
      {icon && (
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
  )
}

/** A row's buttons. Shown on hover, or while a menu among them is open, which
 *  a touch screen never has, so there they stay, a little faded. Hidden, they
 *  take no width, so a long title runs to the row's edge. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-opacity group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 has-[[aria-expanded=true]]:w-auto has-[[aria-expanded=true]]:overflow-visible has-[[aria-expanded=true]]:opacity-100 pointer-coarse:w-auto pointer-coarse:overflow-visible pointer-coarse:opacity-40">
      {children}
    </div>
  )
}
