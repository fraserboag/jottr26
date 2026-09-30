'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo } from 'react'
import { Icon } from '@/components/ui/Icon'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { Breadcrumb } from './Breadcrumb'
import { EditorError } from './EditorError'
import { EmptyState } from './EmptyState'
import { EnsureFirstPage } from './EnsureFirstPage'
import { PagesContext } from './PagesContext'
import { SettingsBar, SettingsPage } from './SettingsPage'
import { Sidebar } from './Sidebar'
import { StarButton } from './StarButton'
import { TrashBar, TrashPage } from './TrashPage'
import { useWorkspace } from './WorkspaceProvider'
import { usePageTrail, useEntryFromAbove } from './pageTrail'
import { useSidebarDrawer } from './useSidebarDrawer'
import { useSidebarResize } from './useSidebarResize'
import { useAllPages, useTrashedPages } from '@/lib/db/hooks'
import { useOpenPageId, useView, type View } from '@/lib/util/route'
import { afterPaint, idleAfterPaint } from '@/lib/util/idle'
import { markStartup } from '@/lib/util/startupTiming'

// Kept out of hydration so the workspace can open before the editor is
// evaluated. Its build manifest lets the worker cache these chunks without
// loading or evaluating them in the foreground.
const loadEditor = () => {
  markStartup('editor-load-start')
  return import('@/components/editor/Editor')
}
const Editor = dynamic(() => {
  markStartup('editor-load-start')
  return import('@/components/editor/Editor').then((m) => m.Editor)
}, {
  ssr: false,
  loading: () => (
    <div className="appear-late flex items-center gap-1.5 text-muted">
      <Icon name="refresh" size={16} className="animate-spin" />
      <span>Loading the editor…</span>
    </div>
  ),
})

// The gap between the wide sidebar and the window's edges, on every side.
const SIDEBAR_INSET = 10

export function Workspace() {
  const { userId } = useWorkspace()
  const pages = useAllPages(userId)
  const [openId, open] = useOpenPageId()
  const [view, openView] = useView()
  const trashed = useTrashedPages(userId)
  const { wide, sidebarOpen, setSidebarOpen, afterDrawerShuts } = useSidebarDrawer()
  const { width, dragging, startResize, endResize } = useSidebarResize()

  const pagesReady = pages !== undefined

  useEffect(() => {
    if (!pagesReady) return
    markStartup('pages-ready')
    return afterPaint(() => markStartup('workspace-painted'))
  }, [pagesReady])

  // Let the page list paint before importing and evaluating optional editor
  // code. Selecting a note cancels this warmup; dynamic() loads it immediately.
  // Offline safety still comes from the worker's build manifest.
  useEffect(() => {
    if (!pagesReady || openId || view) return
    return idleAfterPaint(() => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        loadEditor().catch(() => undefined)
      }
    })
  }, [pagesReady, openId, view])

  const landOn = useCallback((id: string) => open(id, { replace: true }), [open])

  const byId = useMemo(() => new Map((pages ?? []).map((page) => [page.id, page])), [pages])
  const page = openId ? (byId.get(openId) ?? null) : null
  // An empty trash gets the empty state rather than a title over nothing. It
  // waits for the query, so a full trash never flashes as an empty one.
  const trashEmpty = !page && view === 'trash' && trashed?.length === 0

  const trail = usePageTrail(byId, page)
  const enteringFromAbove = useEntryFromAbove(byId, openId)

  const openPage = useCallback(
    (id: string | null) => {
      // Opening a page on a narrow screen gets the drawer out of the way.
      // Closing one leaves it up: the list is what you came back to.
      if (id) afterDrawerShuts(() => open(id))
      else open(id)
    },
    [open, afterDrawerShuts],
  )

  const showView = useCallback(
    (next: View) => afterDrawerShuts(() => openView(next)),
    [openView, afterDrawerShuts],
  )

  if (!pages) return <LoadingScreen label="Opening your notes…" />

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
              sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
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
                `fixed inset-y-0 left-0 z-40 w-[min(300px,86vw)] transition-[translate,box-shadow] duration-200 ${sidebarOpen ? 'translate-x-0 shadow-[var(--shadow-pop)]' : '-translate-x-full shadow-none'}`
          } overflow-hidden`}
          style={wide ? { width: sidebarOpen ? width + SIDEBAR_INSET * 2 : 0 } : undefined}
          aria-label="Pages"
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
        >
          {/* On a wide screen the sidebar floats a few pixels in from the
              window's edges, rounded like the app's other panels. The inset is
              added around the kept width rather than taken out of it. */}
          <div
            className={wide ? 'h-full' : 'h-full w-full'}
            style={wide ? { width: width + SIDEBAR_INSET * 2, padding: SIDEBAR_INSET } : undefined}
          >
            <div className={wide ? 'h-full overflow-hidden rounded-xl shadow-[var(--shadow-subtle)]' : 'h-full'}>
              <Sidebar
                pages={pages}
                openId={openId}
                onOpen={openPage}
                view={view}
                onOpenView={showView}
              />
            </div>
          </div>
        </aside>

        {/* Outside the sidebar on purpose. Inside it, the six pixels of grab area
            would sit on top of the page list's own scrollbar, which is nine
            pixels wide, and anyone whose scrollbars are always visible could not
            reach the thumb. Out here it fills the gap beside the sidebar and
            hangs a little over the page's left margin, its line drawn down the
            middle of the gap. */}
        {wide && sidebarOpen && (
          <div className="relative z-40 w-0 shrink-0">
            <div
              className="group absolute inset-y-0 cursor-col-resize touch-none"
              style={{ left: -SIDEBAR_INSET, width: SIDEBAR_INSET + 3 }}
              onPointerDown={startResize}
              onLostPointerCapture={() => endResize()}
            >
              <div
                className={`absolute w-0.5 bg-accent transition-opacity ${
                  dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={{ top: SIDEBAR_INSET, bottom: SIDEBAR_INSET, left: SIDEBAR_INSET / 2 - 1 }}
              />
            </div>
          </div>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* The top left: the way back to a hidden sidebar. It floats over
              the page rather than scrolling away with it. The row itself lets
              clicks through to the page; only what is drawn in it takes them. */}
          <div className="float-top pointer-events-none absolute left-2 right-12 z-30 flex min-w-0 items-center gap-2 pointer-coarse:right-14">
            {/* The same pale box and shadow as the star, so the page's left
                edge can pass underneath on a phone without the icon looking
                like part of the text. */}
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Show sidebar"
                className="pointer-events-auto grid rounded-md bg-sunken shadow-[var(--shadow-subtle)] size-8 shrink-0 place-items-center text-faint transition-colors hover:bg-[var(--hover)] hover:text-muted pointer-coarse:size-10 pointer-coarse:text-muted"
              >
                <Icon name="panel" size={18} className="pointer-coarse:size-5" />
              </button>
            )}
          </div>

          {(page || view) && !trashEmpty ? (
            <div className="scrollbar-none relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {/* The trail and the star are part of the page: they start level
                  with the sidebar button, the trail just past it, but scroll
                  away with the text rather than floating over it, so they need
                  no backdrop. The star keeps a pale box of its own, and on a wide
                  screen that box sits as far in from the edge as the trail's text.
                  On a wide screen the trail only steps aside while the button is
                  there. */}
              {page && (
                <div
                  className={`float-top pointer-events-none absolute left-2 z-10 flex min-w-0 items-center gap-2 ${wide ? 'right-4' : 'right-2'} ${
                    wide && sidebarOpen ? 'pl-2' : 'pl-10 pointer-coarse:pl-12'
                  }`}
                >
                  {trail.length > 1 && <Breadcrumb trail={trail} onOpen={openPage} truncate={wide} />}
                  <StarButton page={page} className="ml-auto rounded-md bg-sunken shadow-[var(--shadow-subtle)]" />
                </div>
              )}
              {/* The trash takes the same row: its count where the trail would
                  be, and the button to empty it where the star would be. */}
              {!page && view === 'trash' && (
                <div
                  className={`float-top pointer-events-none absolute left-2 z-10 flex min-w-0 items-center gap-2 ${wide ? 'right-4' : 'right-2'} ${
                    wide && sidebarOpen ? 'pl-2' : 'pl-10 pointer-coarse:pl-12'
                  }`}
                >
                  <TrashBar pages={trashed ?? []} />
                </div>
              )}
              {/* And the settings put the version there. */}
              {!page && view === 'settings' && (
                <div
                  className={`float-top pointer-events-none absolute left-2 z-10 flex min-w-0 items-center gap-2 ${wide ? 'right-4' : 'right-2'} ${
                    wide && sidebarOpen ? 'pl-2' : 'pl-10 pointer-coarse:pl-12'
                  }`}
                >
                  <SettingsBar />
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
                  nothing more than it did. The trash and the settings take the same
                  column. */}
              <div
                key={page?.id ?? view}
                className={`page-enter mx-auto w-full max-w-[780px] has-[[data-editor-error]]:flex has-[[data-editor-error]]:min-h-full has-[[data-editor-error]]:flex-col has-[[data-editor-error]]:py-0 px-5 pb-[calc(4rem+var(--toolbar-inset,0px))] sm:px-10 ${enteringFromAbove ? '[--enter-side:-1] ' : ''}${
                  wide
                    ? 'pt-28'
                    : 'pt-[calc(max(0.5rem,env(safe-area-inset-top))+4.5rem)] pointer-coarse:pt-[calc(max(0.5rem,env(safe-area-inset-top))+5rem)]'
                }`}
              >
                {page ? (
                  <EditorError>
                    <Editor pageId={page.id} />
                  </EditorError>
                ) : view === 'settings' ? (
                  <SettingsPage />
                ) : (
                  <TrashPage pages={trashed ?? []} />
                )}
              </div>
            </div>
          ) : trashEmpty ? (
            <EmptyState icon="trash" label="Trash is empty" />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </PagesContext.Provider>
  )
}
