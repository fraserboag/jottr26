'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Sidebar } from './Sidebar'
import { TrashPage } from './TrashPage'
import { useWorkspace } from './WorkspaceProvider'
import { useAllPages } from '@/lib/db/hooks'
import { toggleFavorite } from '@/lib/db/pages'
import { ensureFirstPage } from '@/lib/db/welcome'
import { useOpenPageId, useTrashOpen } from '@/lib/util/route'
import type { PageRow } from '@/lib/db/schema'

// The editor is the heaviest thing in the app and nobody needs it until a page
// is open, so it loads as its own chunk and never during hydration.
const Editor = dynamic(() => import('@/components/editor/Editor').then((m) => m.Editor), {
  ssr: false,
})

const WIDTH_KEY = 'jottr.sidebarWidth'

// The floor keeps the header's workspace button and the sync indicator side
// by side; the ceiling stops a drag from crowding out the page itself.
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 264

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

export function Workspace() {
  const { userId, status } = useWorkspace()
  const pages = useAllPages(userId)
  const [openId, open] = useOpenPageId()
  const [trashOpen, openTrash] = useTrashOpen()

  const [wide, setWide] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 880px)')
    let cold = true
    const apply = () => {
      setWide(media.matches)

      let storedWidth: string | null = null
      try {
        storedWidth = localStorage.getItem(WIDTH_KEY)
      } catch {
        /* Ignore. */
      }
      // Clamped on the way in as well as out: a value left behind by an older
      // build, or by hand, should not be able to produce an unusable sidebar.
      const parsedWidth = Number(storedWidth)
      if (Number.isFinite(parsedWidth) && parsedWidth > 0) setWidth(clampWidth(parsedWidth))

      // A phone opening the app cold lands on the page list, since picking a
      // page is the first thing to do there. Narrowing a window later is not
      // a fresh start, and gets the page to itself. A wide screen always has
      // the sidebar: there is no way to hide it there.
      setSidebarOpen(media.matches || cold)
      cold = false
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  // A brand new account gets one page to land on rather than an empty screen.
  useEffect(() => {
    if (!userId || !pages || pages.length > 0) return
    // Only once the server has confirmed the account really is empty. A device
    // that first opens offline would otherwise write a duplicate page.
    if (status.lastSyncedAt === null) return
    void ensureFirstPage().then((id) => {
      if (id) open(id, { replace: true })
    })
  }, [userId, pages, status.lastSyncedAt, open])

  const byId = useMemo(() => new Map((pages ?? []).map((page) => [page.id, page])), [pages])
  const page = openId ? (byId.get(openId) ?? null) : null

  const trail = useMemo(() => {
    const out: PageRow[] = []
    let current = page
    for (let depth = 0; current && depth < 24; depth += 1) {
      out.unshift(current)
      current = current.parentId ? (byId.get(current.parentId) ?? null) : null
    }
    return out
  }, [page, byId])

  // Which way the page slides in: from the left when it is an
  // ancestor of the one being left, since that is going back up the tree.
  // Worked out while rendering, from the last page seen, so the new page
  // mounts already facing the right way.
  const [entry, setEntry] = useState<{ id: string | null; up: boolean }>({ id: openId, up: false })
  if (entry.id !== openId) {
    let up = false
    let current = entry.id ? byId.get(entry.id) : undefined
    for (let depth = 0; current?.parentId && depth < 24; depth += 1) {
      if (current.parentId === openId) up = true
      current = byId.get(current.parentId)
    }
    setEntry({ id: openId, up })
  }

  const openPage = useCallback(
    (id: string | null) => {
      open(id)
      // Opening a page on a narrow screen gets the drawer out of the way.
      // Closing one leaves it up: the list is what you came back to.
      if (id && !wide) setSidebarOpen(false)
    },
    [open, wide],
  )

  const showTrash = useCallback(() => {
    openTrash()
    if (!wide) setSidebarOpen(false)
  }, [openTrash, wide])

  // Dragging the sidebar's edge works like dragging a table column: the
  // pointer is captured so the drag survives leaving the few pixels of the
  // handle, and the width is only written back once the pointer is released.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
    setDragging(true)
  }

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from) return
    setWidth(clampWidth(from.width + event.clientX - from.x))
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // Worked out from the event rather than read off `width`: releasing is a
    // discrete event and can land before the last move has rendered, which
    // would otherwise store a width a few pixels behind the one on screen.
    const final = clampWidth(from.width + event.clientX - from.x)
    setWidth(final)
    try {
      localStorage.setItem(WIDTH_KEY, String(final))
    } catch {
      /* Ignore. */
    }
  }

  if (!pages) return <Splash />

  const showSidebar = sidebarOpen

  return (
    <div
      className={`flex h-dvh overflow-hidden bg-surface${
        dragging ? ' cursor-col-resize select-none [&_button]:cursor-col-resize' : ''
      }`}
    >
      {showSidebar && !wide && (
        <div
          className="fixed inset-0 z-40 bg-[var(--overlay)]"
          onPointerDown={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`${
          wide
            ? `relative shrink-0 border-r border-line ${dragging ? '' : 'transition-[width] duration-200'}`
            : // The shadow fades out with the slide: its blur reaches far enough
              // past the drawer's edge to stay visible on the page once the
              // drawer itself is off screen. The slide is named as `translate`
              // rather than `transform` because that is the property the
              // translate utilities set — transitioning `transform` leaves the
              // drawer snapping open with no animation at all.
              `fixed inset-y-0 left-0 z-40 w-[min(300px,86vw)] border-r border-line transition-[translate,box-shadow] duration-200 ${showSidebar ? 'translate-x-0 shadow-[var(--shadow-pop)]' : '-translate-x-full shadow-none'}`
        } overflow-hidden`}
        style={wide ? { width: showSidebar ? width : 0 } : undefined}
        aria-label="Pages"
        aria-hidden={!showSidebar}
        inert={!showSidebar}
      >
        <div className={wide ? 'h-full' : 'h-full w-full'} style={wide ? { width } : undefined}>
          <Sidebar
            pages={pages}
            openId={openId}
            onOpen={openPage}
            trashOpen={trashOpen}
            onOpenTrash={showTrash}
          />
        </div>
      </aside>

      {/* Outside the sidebar on purpose. Inside it, the six pixels of grab area
          would sit on top of the page list's own scrollbar, which is nine
          pixels wide, and anyone whose scrollbars are always visible could not
          reach the thumb. Out here it hangs over the page's left margin. */}
      {wide && showSidebar && (
        <div className="relative z-40 w-0 shrink-0">
          <div
            className="group absolute inset-y-0 left-0 w-1.5 cursor-col-resize touch-none"
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          >
            <div
              className={`absolute inset-y-0 -left-px w-0.5 bg-accent transition-opacity ${
                dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* The top left: the way back to a hidden sidebar, then the open
            page's trail. Both float over the page rather than scrolling away
            with it, on one line with the star in the opposite corner — same
            top, same height, same distance in from the edge — and stop short
            of it. The row itself lets clicks through to the page; only what
            is drawn in it takes them. */}
        <div className="pointer-events-none absolute left-2 right-12 top-[calc(max(0.5rem,env(safe-area-inset-top))+3.6px)] z-30 flex min-w-0 items-center gap-2 pointer-coarse:right-[3.25rem] pointer-coarse:top-[calc(max(0.5rem,env(safe-area-inset-top))+3.2px)]">
          {/* It keeps the old top bar's backdrop: on a phone the page's left
              edge passes underneath. There it is always on screen, so it gets
              an outline rather than being a bare icon that looks like part of
              the text. */}
          {!showSidebar && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Show sidebar"
              className="pointer-events-auto grid size-8 shrink-0 place-items-center rounded-md bg-surface/85 text-faint backdrop-blur-md transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:size-9 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-raised/90 pointer-coarse:text-muted"
            >
              <Icon name="panel" size={18} />
            </button>
          )}
          {page && trail.length > 1 && <Breadcrumb trail={trail} onOpen={openPage} />}
        </div>

        {/* The top-right counterpart of the sidebar button, with the same
            backdrop for the same reason. It sits where the settings button
            sits in the sidebar's header: that button is centred on the Jottr
            wordmark's line, which puts it a few pixels below the header's
            padding — 3.6px, and 3.2px with a touch screen's larger text. */}
        {page && (
          <button
            type="button"
            onClick={() => void toggleFavorite(page.id)}
            aria-label={page.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={page.isFavorite === 1}
            className={`absolute right-2 top-[calc(max(0.5rem,env(safe-area-inset-top))+3.6px)] z-30 grid size-8 place-items-center rounded-md bg-surface/85 backdrop-blur-md transition-colors hover:bg-[var(--hover)] pointer-coarse:top-[calc(max(0.5rem,env(safe-area-inset-top))+3.2px)] pointer-coarse:size-9 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-raised/90 ${
              page.isFavorite ? 'text-star' : 'text-faint hover:text-muted pointer-coarse:text-muted'
            }`}
          >
            <Icon
              name="star"
              size={18}
              className="pointer-coarse:size-5"
              strokeWidth={1.8}
              filled={page.isFavorite === 1}
            />
          </button>
        )}

        {page && <LastUpdated at={Math.max(page.updatedAt, page.editedAt ?? 0)} />}

        {page || trashOpen ? (
          <div className="scroll-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {/* 700px of text, the same column Notion sets, plus the side padding:
                the cap is the two added together, not the column on its own. */}
            {/* Narrow screens centre nothing, so the floating button would sit on
                the first line of the page. The extra padding drops it clear, and
                follows the notch the button is offset by. It does not depend on
                the sidebar being hidden: there the sidebar is a drawer over the
                page, and keying on it would shuffle the page up and down as the
                drawer opened and closed. */}
            {/* Keyed on the page so the slide replays on every navigation. The
                editor underneath already remounts per page, so this costs
                nothing more than it did. The trash takes the same column. */}
            <div
              key={page?.id ?? 'trash'}
              className={`page-enter mx-auto w-full max-w-[780px] px-5 pb-[calc(4rem+var(--toolbar-inset,0px))] sm:px-10 ${entry.up ? '[--enter-side:-1] ' : ''}${
                wide
                  ? 'pt-28'
                  : 'pt-[calc(max(0.5rem,env(safe-area-inset-top))+3.75rem)] pointer-coarse:pt-[calc(max(0.5rem,env(safe-area-inset-top))+4rem)]'
              }`}
            >
              {page ? (
                <Editor pageId={page.id} />
              ) : (
                <TrashPage />
              )}
            </div>
          </div>
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}

/** The ancestors, then the page itself as plain unclickable text to close
 *  the trail. Most pages are top level and get no trail at all. The crumbs
 *  are plain text, and hovering underlines one the way a link would; the box
 *  round them is the floating buttons' backdrop, there so the page can scroll
 *  under the trail without the two reading as one. */
function Breadcrumb({ trail, onOpen }: { trail: PageRow[]; onOpen: (id: string | null) => void }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="pointer-events-auto flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-md bg-surface/85 px-2 backdrop-blur-md pointer-coarse:h-9 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-raised/90"
    >
      {trail.map((crumb, index) => (
        <span key={crumb.id} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <Icon name="chevronRight" size={12} className="text-faint" />}
          {index === trail.length - 1 ? (
            <span aria-current="page" className="truncate text-faint">
              {crumb.title || 'Untitled'}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(crumb.id)}
              className="truncate text-muted underline-offset-2 hover:underline"
            >
              {crumb.title || 'Untitled'}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

function describeEdit(at: number, now: number) {
  // An edit newer than the last tick reads as just now.
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return relative.format(-days, 'day')
  const date = new Date(at)
  return (date.getFullYear() === new Date(now).getFullYear() ? shortDate : longDate).format(date)
}

/** When the open page last changed, faintly in the bottom right. It mirrors
 *  the breadcrumb in the opposite corner — same size, padding and colour as
 *  the trail's last crumb — lets clicks through, and rides above the phone's
 *  formatting bar while that is up. Ticks every half minute so
 *  "just now" doesn't stay just now. */
function LastUpdated({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (!at) return null
  return (
    <p
      title={fullTime.format(at)}
      className="pointer-events-none absolute right-2 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+var(--toolbar-inset,0px))] z-20 flex h-8 select-none items-center px-2 text-faint pointer-coarse:h-9"
    >
      Last updated {describeEdit(at, now)}
    </p>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-line bg-sunken text-faint">
        <Icon name="file" size={20} />
      </div>
      <p className="text-faint">No page selected</p>
    </div>
  )
}

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-surface">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon name="refresh" size={16} className="animate-spin" />
        <span>Opening your notes…</span>
      </div>
    </div>
  )
}
