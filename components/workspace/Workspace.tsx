'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { EnsureFirstPage } from './EnsureFirstPage'
import { PagesContext } from './PagesContext'
import { Sidebar } from './Sidebar'
import { TrashPage } from './TrashPage'
import { useWorkspace } from './WorkspaceProvider'
import { useAllPages } from '@/lib/db/hooks'
import { toggleFavorite } from '@/lib/db/pages'
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
  const { userId } = useWorkspace()
  const pages = useAllPages(userId)
  const [openId, open] = useOpenPageId()
  const [trashOpen, openTrash] = useTrashOpen()

  const [wide, setWide] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{
    x: number
    width: number
    last: number
    pointerId: number
    handle: HTMLElement
  } | null>(null)

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

  const landOn = useCallback((id: string) => open(id, { replace: true }), [open])

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

  // Leaving for another page from the open drawer waits for the drawer to
  // finish sliding shut. iOS takes the picture it shows during a swipe back at
  // the moment the history entry is pushed, so pushing any earlier would have
  // the drawer reappear on the page being swiped back to.
  const pending = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pending.current), [])
  const afterDrawerShuts = useCallback(
    (go: () => void) => {
      window.clearTimeout(pending.current)
      if (wide || !sidebarOpen) {
        go()
        return
      }
      setSidebarOpen(false)
      // The slide's 200ms, and a little over for its last frame to be shown.
      pending.current = window.setTimeout(go, 250)
    },
    [wide, sidebarOpen],
  )

  const openPage = useCallback(
    (id: string | null) => {
      // Opening a page on a narrow screen gets the drawer out of the way.
      // Closing one leaves it up: the list is what you came back to.
      if (id) afterDrawerShuts(() => open(id))
      else open(id)
    },
    [open, afterDrawerShuts],
  )

  const showTrash = useCallback(() => afterDrawerShuts(openTrash), [openTrash, afterDrawerShuts])

  // Dragging the sidebar's edge works like dragging a table column. Once the
  // press lands on the handle, the rest of the drag is followed on the window
  // rather than on the handle, so it neither depends on pointer capture holding
  // nor on the handle still being on screen, and the width is only written
  // back once the drag ends.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = {
      x: event.clientX,
      width,
      last: width,
      pointerId: event.pointerId,
      handle: event.currentTarget,
    }
    setDragging(true)
    // Only keeps hover effects elsewhere from lighting up on the way past.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Ignore. */
    }
  }

  // Every way a drag can finish comes through here, and more than one of them
  // can fire for the same release, so it does nothing once the drag is over.
  // Without a position to work from, the drag keeps the last width it showed.
  const endResize = useCallback((clientX?: number) => {
    const from = drag.current
    if (!from) return
    drag.current = null
    setDragging(false)
    // A drag given up on rather than released can leave the handle holding
    // the pointer, which would steer every later click back onto it.
    try {
      if (from.handle.hasPointerCapture(from.pointerId)) {
        from.handle.releasePointerCapture(from.pointerId)
      }
    } catch {
      /* Ignore. */
    }
    // Worked out from the release rather than read off `width`: releasing is a
    // discrete event and can land before the last move has rendered, which
    // would otherwise store a width a few pixels behind the one on screen.
    const final = clientX === undefined ? from.last : clampWidth(from.width + clientX - from.x)
    setWidth(final)
    try {
      localStorage.setItem(WIDTH_KEY, String(final))
    } catch {
      /* Ignore. */
    }
  }, [])

  // A release can go missing — let go over another window or the browser's
  // own chrome, a context menu or system gesture taking the pointer, capture
  // dropped along the way — and a drag that never hears it would otherwise
  // leave the whole app stuck showing the resize cursor until a reload. So
  // besides the release itself, a move with the button already up, the
  // window losing focus and the tab being hidden all end it too. Listened for
  // on the way down, so nothing in the page stopping an event can hide it,
  // and only for the pointer that started the drag.
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      const from = drag.current
      if (!from || event.pointerId !== from.pointerId) return
      if ((event.buttons & 1) === 0) {
        endResize()
        return
      }
      from.last = clampWidth(from.width + event.clientX - from.x)
      setWidth(from.last)
    }
    const release = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) endResize(event.clientX)
    }
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) endResize()
    }
    const abandon = () => endResize()
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', abandon)
    document.addEventListener('visibilitychange', abandon)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', abandon)
      document.removeEventListener('visibilitychange', abandon)
    }
  }, [dragging, endResize])

  if (!pages) return <Splash />

  const showSidebar = sidebarOpen

  return (
    <PagesContext.Provider value={pages}>
      <div
        className={`flex h-dvh overflow-hidden bg-surface${
          dragging ? ' cursor-col-resize select-none [&_button]:cursor-col-resize' : ''
        }`}
      >
        <EnsureFirstPage pages={pages} onCreated={landOn} />

        {/* Kept in the page while shut, so it fades with the drawer's slide both
            ways rather than blinking on and off around it. */}
        {!wide && (
          <div
            className={`fixed inset-0 z-40 bg-[var(--overlay)] transition-opacity duration-200 ${
              showSidebar ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onPointerDown={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          className={`${
            wide
              ? `relative shrink-0 ${dragging ? '' : 'transition-[width] duration-200'}`
              : // The shadow fades out with the slide: its blur reaches far enough
                // past the drawer's edge to stay visible on the page once the
                // drawer itself is off screen. The slide is named as `translate`
                // rather than `transform` because that is the property the
                // translate utilities set — transitioning `transform` leaves the
                // drawer snapping open with no animation at all.
                `fixed inset-y-0 left-0 z-40 w-[min(300px,86vw)] transition-[translate,box-shadow] duration-200 ${showSidebar ? 'translate-x-0 shadow-[var(--shadow-pop)]' : '-translate-x-full shadow-none'}`
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
              onLostPointerCapture={() => endResize()}
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
          {/* The top left: the way back to a hidden sidebar, then, on a wide
              screen, the open page's trail. Both float over the page rather
              than scrolling away with it, on one line with the star in the
              opposite corner — same top, same height, same distance in from the
              edge — and stop short of it. The row itself lets clicks through to
              the page; only what is drawn in it takes them. */}
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
            {wide && page && trail.length > 1 && <Breadcrumb trail={trail} onOpen={openPage} floating />}
          </div>

          {/* The top-right counterpart of the sidebar button, with the same
              backdrop for the same reason. It sits where the settings button
              sits in the sidebar's header: that button is centred on the Jottr
              wordmark's line, which puts it a few pixels below the header's
              padding — 3.6px, and 3.2px with a touch screen's larger text. */}
          {wide && page && (
            <StarButton
              page={page}
              className="absolute right-2 top-[calc(max(0.5rem,env(safe-area-inset-top))+3.6px)] z-30 rounded-md bg-surface/85 backdrop-blur-md pointer-coarse:top-[calc(max(0.5rem,env(safe-area-inset-top))+3.2px)] pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-raised/90"
            />
          )}

          {page && <LastUpdated at={Math.max(page.updatedAt, page.editedAt ?? 0)} />}

          {page || trashOpen ? (
            <div className="scroll-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {/* On a narrow screen the trail and the star are part of the page:
                  they start level with the sidebar button, the trail just past
                  it, but scroll away with the text rather than floating over
                  it, so they need no backdrop. */}
              {!wide && page && (
                <div className="pointer-events-none absolute left-2 right-2 top-[calc(max(0.5rem,env(safe-area-inset-top))+3.6px)] z-10 flex min-w-0 items-center gap-2 pl-10 pointer-coarse:top-[calc(max(0.5rem,env(safe-area-inset-top))+3.2px)] pointer-coarse:pl-11">
                  {trail.length > 1 && <Breadcrumb trail={trail} onOpen={openPage} />}
                  <StarButton page={page} className="ml-auto rounded-md" />
                </div>
              )}
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
                    : 'pt-[calc(max(0.5rem,env(safe-area-inset-top))+4.5rem)] pointer-coarse:pt-[calc(max(0.5rem,env(safe-area-inset-top))+4.75rem)]'
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
    </PagesContext.Provider>
  )
}

/** The ancestors, then the page itself as plain unclickable text to close
 *  the trail. Most pages are top level and get no trail at all. The crumbs
 *  are plain text, and hovering underlines one the way a link would. When
 *  the trail floats, the box round it is the floating buttons' backdrop,
 *  there so the page can scroll under the trail without the two reading as
 *  one. On a narrow screen a deep trail won't fit, so rather than cutting the
 *  titles short it scrolls sideways, starting at the right-hand end with the
 *  open page, and the reader swipes back for the rest. */
function Breadcrumb({
  trail,
  onOpen,
  floating = false,
}: {
  trail: PageRow[]
  onOpen: (id: string | null) => void
  floating?: boolean
}) {
  const navRef = useRef<HTMLElement>(null)
  // Keyed on the titles as well as the ids, so renaming a page, which changes
  // how wide the trail is, puts the open page back in view.
  const trailKey = trail.map((crumb) => `${crumb.id}:${crumb.title}`).join('/')

  // Starts the scrolling trail at its end. It happens again when the width
  // changes, such as when the phone turns, but not while the reader is only
  // swiping along it.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (floating || !nav) return
    const pin = () => {
      nav.scrollLeft = nav.scrollWidth
    }
    pin()
    const observer = new ResizeObserver(pin)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [floating, trailKey])

  return (
    <nav
      ref={navRef}
      aria-label="Breadcrumb"
      className={`pointer-events-auto flex h-8 min-w-0 items-center gap-1.5 pointer-coarse:h-9 ${
        floating
          ? 'overflow-hidden rounded-md bg-surface/85 px-2 backdrop-blur-md pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-raised/90'
          : 'overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }`}
    >
      {trail.map((crumb, index) => (
        <span
          key={crumb.id}
          className={`flex items-center gap-1.5 ${floating ? 'min-w-0' : 'shrink-0 whitespace-nowrap'}`}
        >
          {index > 0 && <Icon name="chevronRight" size={12} className="text-faint" />}
          {index === trail.length - 1 ? (
            <span aria-current="page" className={`text-faint ${floating ? 'truncate' : ''}`}>
              {crumb.title || 'Untitled'}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(crumb.id)}
              className={`text-muted underline-offset-2 hover:underline ${floating ? 'truncate' : ''}`}
            >
              {crumb.title || 'Untitled'}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

/** Adds the open page to the favourites, or takes it off. Where it sits,
 *  and whether it has a backdrop, is up to the caller. */
function StarButton({ page, className }: { page: PageRow; className: string }) {
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
 *  the trail's last crumb — and lets clicks through. Left off touch screens,
 *  where the corner belongs to the page and the keyboard bar. Ticks every half minute so
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
      className="pointer-events-none absolute right-2 bottom-2 z-20 flex h-8 select-none items-center px-2 text-faint pointer-coarse:hidden"
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
