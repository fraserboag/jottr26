'use client'

import { Icon } from '@/components/ui/Icon'
import { MenuItem, Popover } from '@/components/ui/Popover'
import { useEffect, useRef, useState } from 'react'
import { movePageToWorkspace, toggleFavorite, trashPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'
import { useNoteWorkspaces } from './NoteWorkspacesContext'

/** Direct note actions shared by the sidebar and subpage lists. */
export function PageActions({ page }: { page: PageRow }) {
  const { active } = useNoteWorkspaces()
  const destinations = active.filter((space) => space.id !== page.workspaceId)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const moving = useRef(false)
  const moveTrigger = useRef<HTMLButtonElement | null>(null)
  const favoriteLabel = page.isFavorite ? 'Remove from favourites' : 'Add to favourites'
  const trashLabel = `Move ${page.title || 'Untitled'} to trash`
  const buttonClass = 'grid size-6 shrink-0 touch-manipulation place-items-center rounded-md transition-colors hover:bg-[var(--active)] active:bg-[var(--active)] pointer-coarse:h-10 pointer-coarse:w-8 pointer-coarse:[&_svg]:size-5'

  return (
    <>
      {destinations.length > 0 && <Popover label="Move to space" align="end"
        trigger={({ open, toggle, ref }) => <button type="button" ref={(node) => { ref(node); moveTrigger.current = node }}
          aria-label="Move to space" aria-haspopup="menu" aria-expanded={open} title="Move to space"
          onClick={(event) => { event.stopPropagation(); setError(''); toggle() }}
          className={`${buttonClass} text-faint hover:text-muted pointer-coarse:text-muted`}>
          <Icon name="more" size={16} />
        </button>}>
        {(close) => <MoveOptions busy={busy} close={() => { close(); moveTrigger.current?.focus({ preventScroll: true }) }}>
          <p className="px-2 py-1 text-xs text-muted">Move to space</p>
          {destinations.map((space) => <MenuItem key={space.id} onClick={() => {
            if (moving.current) return
            moving.current = true
            setBusy(true)
            setError('')
            void movePageToWorkspace(page.id, space.id).then(() => { close(); moveTrigger.current?.focus({ preventScroll: true }) }).catch((error: unknown) => {
              setError(error instanceof Error ? error.message : 'Could not move this page.')
            }).finally(() => { moving.current = false; setBusy(false) })
          }}>{space.name}</MenuItem>)}
          {error && <p role="alert" className="px-2 py-1 text-danger">{error}</p>}
        </MoveOptions>}
      </Popover>}
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

function MoveOptions({ children, busy, close }: { children: React.ReactNode; busy: boolean; close: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => panel.current?.querySelector('button')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div ref={panel} className="max-h-[min(320px,calc(100dvh-32px))] overflow-y-auto overscroll-contain" aria-busy={busy}
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
      if (event.key === 'Tab') { close(); return }
      const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
        : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined
      if (next === undefined) return
      event.preventDefault()
      buttons[next]?.focus()
    }}>
    {children}
  </div>
}
