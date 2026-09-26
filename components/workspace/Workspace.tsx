'use client'

import dynamic from 'next/dynamic'
import { useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/Icon'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { Breadcrumb } from './Breadcrumb'
import { EmptyState } from './EmptyState'
import { EnsureFirstPage } from './EnsureFirstPage'
import { LastUpdated } from './LastUpdated'
import { PagesContext } from './PagesContext'
import { Sidebar } from './Sidebar'
import { StarButton } from './StarButton'
import { TrashPage } from './TrashPage'
import { useWorkspace } from './WorkspaceProvider'
import { usePageTrail, useEntryFromAbove } from './pageTrail'
import { useSidebarDrawer } from './useSidebarDrawer'
import { useSidebarResize } from './useSidebarResize'
import { useAllPages } from '@/lib/db/hooks'
import { useOpenPageId, useTrashOpen } from '@/lib/util/route'

// The editor is the heaviest thing in the app and nobody needs it until a page
// is open, so it loads as its own chunk and never during hydration.
const Editor = dynamic(() => import('@/components/editor/Editor').then((m) => m.Editor), {
  ssr: false,
})

export function Workspace() {
  const { userId } = useWorkspace()
  const pages = useAllPages(userId)
  const [openId, open] = useOpenPageId()
  const [trashOpen, openTrash] = useTrashOpen()
  const { wide, sidebarOpen, setSidebarOpen, afterDrawerShuts } = useSidebarDrawer()
  const { width, dragging, startResize, endResize } = useSidebarResize()

  const landOn = useCallback((id: string) => open(id, { replace: true }), [open])

  const byId = useMemo(() => new Map((pages ?? []).map((page) => [page.id, page])), [pages])
  const page = openId ? (byId.get(openId) ?? null) : null

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

  const showTrash = useCallback(() => afterDrawerShuts(openTrash), [openTrash, afterDrawerShuts])

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
          style={wide ? { width: sidebarOpen ? width : 0 } : undefined}
          aria-label="Pages"
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
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
        {wide && sidebarOpen && (
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
            {!sidebarOpen && (
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
                className={`page-enter mx-auto w-full max-w-[780px] px-5 pb-[calc(4rem+var(--toolbar-inset,0px))] sm:px-10 ${enteringFromAbove ? '[--enter-side:-1] ' : ''}${
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
