'use client'

import { Icon } from '@/components/ui/Icon'
import { toggleFavorite } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'

/** Adds the open page to the favourites, or takes it off. Where it sits,
 *  and whether it has a backdrop, is up to the caller. */
export function StarButton({ page, className }: { page: PageRow; className: string }) {
  return (
    <button
      type="button"
      onClick={() => void toggleFavorite(page.id)}
      aria-label={page.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={page.isFavorite === 1}
      className={`pointer-events-auto grid size-8 shrink-0 place-items-center transition-colors hover:bg-[var(--hover)] pointer-coarse:size-9 ${className} ${
        page.isFavorite ? 'text-star' : 'text-faint hover:text-muted pointer-coarse:text-muted'
      }`}
    >
      <Icon name="star" size={18} className="pointer-coarse:size-5" strokeWidth={1.8} filled={page.isFavorite === 1} />
    </button>
  )
}
