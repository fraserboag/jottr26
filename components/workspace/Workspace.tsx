'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Sidebar } from './Sidebar'
import { QuickSearch } from './QuickSearch'
import { TrashPanel } from './TrashPanel'
import { useWorkspace } from './WorkspaceProvider'
import { useAllPages } from '@/lib/db/hooks'
import { createPage } from '@/lib/db/pages'
import { ensureWelcomePage } from '@/lib/db/welcome'
import { useOpenPageId, useQuery } from '@/lib/util/route'
import type { PageRow } from '@/lib/db/schema'

// The editor is the heaviest thing in the app and nobody needs it until a page
// is open, so it loads as its own chunk and never during hydration.
const Editor = dynamic(() => import('@/components/editor/Editor').then((m) => m.Editor), {
  ssr: false,
})

const SIDEBAR_KEY = 'jottr.sidebar'
const WIDTH_KEY = 'jottr.sidebarWidth'

// The floor keeps the header's workspace button and the collapse control side
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
  const query = useQuery()

  const [wide, setWide] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [overlay, setOverlay] = useState<'search' | 'trash' | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 880px)')
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

      if (!media.matches) setSidebarOpen(false)
      else {
        let stored: string | null = null
        try {
          stored = localStorage.getItem(SIDEBAR_KEY)
        } catch {
          /* Ignore. */
        }
        setSidebarOpen(stored !== 'hidden')
      }
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  const setSidebar = useCallback(
    (next: boolean) => {
      setSidebarOpen(next)
      if (!wide) return
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'shown' : 'hidden')
      } catch {
        /* Ignore. */
      }
    },
    [wide],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOverlay((current) => (current === 'search' ? null : 'search'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A brand new account gets one page to land on rather than an empty screen.
  useEffect(() => {
    if (!userId || !pages || pages.length > 0) return
    // Only once the server has confirmed the account really is empty. A device
    // that first opens offline would otherwise write a second welcome page.
    if (status.lastSyncedAt === null) return
    void ensureWelcomePage().then((id) => {
      if (id) open(id, { replace: true })
    })
  }, [userId, pages, status.lastSyncedAt, open])

  // The manifest shortcut lands here asking for a blank page.
  useEffect(() => {
    if (query.get('new') !== '1') return
    void createPage().then((id) => open(id, { replace: true }))
  }, [query, open])

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

  const openPage = useCallback(
    (id: string | null) => {
      open(id)
      // Opening a page on a narrow screen gets the drawer out of the way.
      // Closing one leaves it up: the list is what you came back to.
      if (id && !wide) setSidebarOpen(false)
    },
    [open, wide],
  )

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
          onPointerDown={() => setSidebar(false)}
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
            onOpenSearch={() => setOverlay('search')}
            onOpenTrash={() => setOverlay('trash')}
            onCollapse={() => setSidebar(false)}
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
        {/* The only way back to a hidden sidebar, so it floats over the page
            rather than scrolling away with it. It keeps the old top bar's
            backdrop: on a phone the page's left edge passes underneath. There
            it is always on screen, so it gets an outline rather than being a
            bare icon that looks like part of the text. */}
        {!showSidebar && (
          <button
            type="button"
            onClick={() => setSidebar(true)}
            aria-label="Show sidebar"
            className="absolute left-2 top-[max(0.5rem,env(safe-area-inset-top))] z-30 grid size-7 place-items-center rounded-md bg-surface/85 text-faint backdrop-blur-md transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:size-9 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-raised/90 pointer-coarse:text-muted"
          >
            <Icon name="panel" size={16} className="pointer-coarse:size-[18px]" />
          </button>
        )}

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {/* 700px of text, the same column Notion sets, plus the side padding:
              the cap is the two added together, not the column on its own. */}
          {/* Narrow screens centre nothing, so the floating button would sit on
              the first line of the page. The extra padding drops it clear, and
              follows the notch the button is offset by. It does not depend on
              the sidebar being hidden: there the sidebar is a drawer over the
              page, and keying on it would shuffle the page up and down as the
              drawer opened and closed. */}
          <div
            className={`mx-auto w-full max-w-[780px] px-5 pb-[calc(4rem+var(--toolbar-inset,0px))] sm:px-10 ${
              wide
                ? 'pt-16'
                : 'pt-[calc(max(0.5rem,env(safe-area-inset-top))+2.75rem)] pointer-coarse:pt-[calc(max(0.5rem,env(safe-area-inset-top))+3rem)]'
            }`}
          >
            {page ? (
              <>
                {trail.length > 1 && <Breadcrumb trail={trail.slice(0, -1)} onOpen={openPage} />}
                <Editor pageId={page.id} />
              </>
            ) : (
              <EmptyState onCreate={() => void createPage().then(openPage)} />
            )}
          </div>
        </div>
      </main>

      {overlay === 'search' && (
        <QuickSearch pages={pages} onOpen={openPage} onClose={() => setOverlay(null)} />
      )}
      {overlay === 'trash' && <TrashPanel onClose={() => setOverlay(null)} />}
    </div>
  )
}

/** Only the ancestors: the page's own name is the title right underneath, and
 *  most pages are top level and get no trail at all. Plain text with no box
 *  around it: a crumb starts exactly where the title does, and hovering
 *  underlines it the way a link would. The spacing either side of a chevron
 *  carries the separation the padding used to. */
function Breadcrumb({ trail, onOpen }: { trail: PageRow[]; onOpen: (id: string | null) => void }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-1.5 overflow-hidden">
      {trail.map((crumb, index) => (
        <span key={crumb.id} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <Icon name="chevronRight" size={12} className="text-faint" />}
          <button
            type="button"
            onClick={() => onOpen(crumb.id)}
            className="truncate text-[13px] text-muted underline-offset-2 hover:underline pointer-coarse:text-[14.5px]"
          >
            {crumb.title || 'Untitled'}
          </button>
        </span>
      ))}
    </nav>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-line bg-sunken text-faint">
        <Icon name="file" size={20} />
      </div>
      <h2 className="mt-4 text-[15px] font-semibold text-ink">No page open</h2>
      <p className="mt-1 max-w-[30ch] text-[13.5px] leading-relaxed text-muted pointer-coarse:text-[15px]">
        Pick something from the sidebar, or start a new page.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13.5px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
      >
        <Icon name="plus" size={15} strokeWidth={2.2} />
        New page
      </button>
    </div>
  )
}

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-surface">
      <div className="flex items-center gap-2.5 text-muted">
        <Icon name="refresh" size={16} className="animate-spin" />
        <span className="text-[13.5px]">Opening your notes…</span>
      </div>
    </div>
  )
}
