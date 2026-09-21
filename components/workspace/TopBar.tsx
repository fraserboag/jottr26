'use client'

import { Icon } from '@/components/ui/Icon'
import type { PageRow } from '@/lib/db/schema'

export function TopBar({
  trail,
  sidebarHidden,
  onShowSidebar,
  onOpen,
}: {
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
              {crumb.title || 'Untitled'}
            </button>
          </span>
        ))}
      </nav>
    </header>
  )
}
