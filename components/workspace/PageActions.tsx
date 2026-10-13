'use client'

import { Icon } from '@/components/ui/Icon'
import { toggleFavorite, trashPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'

/** Direct note actions shared by the sidebar and subpage lists. */
export function PageActions({ page }: { page: PageRow }) {
  const favoriteLabel = page.isFavorite ? 'Remove from favourites' : 'Add to favourites'
  const trashLabel = `Move ${page.title || 'Untitled'} to trash`
  const buttonClass = 'grid size-6 shrink-0 touch-manipulation place-items-center rounded-md transition-colors hover:bg-[var(--active)] active:bg-[var(--active)] pointer-coarse:h-10 pointer-coarse:w-8 pointer-coarse:[&_svg]:size-5'

  return (
    <>
      <button
        type="button"
        aria-label={favoriteLabel}
        aria-pressed={page.isFavorite === 1}
        title={favoriteLabel}
        onClick={(event) => {
          event.stopPropagation()
          void toggleFavorite(page.id)
        }}
        className={`${buttonClass} ${page.isFavorite ? 'text-star' : 'text-faint hover:text-muted pointer-coarse:text-muted'}`}
      >
        <Icon name="star" size={16} filled={page.isFavorite === 1} />
      </button>
      <button
        type="button"
        aria-label={trashLabel}
        title={trashLabel}
        onClick={(event) => {
          event.stopPropagation()
          void trashPage(page.id)
        }}
        className={`${buttonClass} text-faint hover:text-danger pointer-coarse:text-muted`}
      >
        <Icon name="trash" size={16} />
      </button>
    </>
  )
}
