'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
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

export function Workspace() {
  const { userId, status } = useWorkspace()
  const pages = useAllPages(userId)
  const [openId, open] = useOpenPageId()
  const query = useQuery()

  const [wide, setWide] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [overlay, setOverlay] = useState<'search' | 'trash' | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 880px)')
    const apply = () => {
      setWide(media.matches)
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
      if (!wide) setSidebarOpen(false)
    },
    [open, wide],
  )

  if (!pages) return <Splash />

  const showSidebar = sidebarOpen

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
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
            ? `relative shrink-0 border-r border-line transition-[width] duration-200 ${showSidebar ? 'w-[264px]' : 'w-0'}`
            : `fixed inset-y-0 left-0 z-40 w-[min(300px,86vw)] border-r border-line shadow-[var(--shadow-pop)] transition-transform duration-200 ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`
        } overflow-hidden`}
        aria-label="Pages"
        aria-hidden={!showSidebar}
        inert={!showSidebar}
      >
        <div className={wide ? 'h-full w-[264px]' : 'h-full w-full'}>
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

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          page={page}
          trail={trail}
          sidebarHidden={!showSidebar}
          onShowSidebar={() => setSidebar(true)}
          onOpen={openPage}
        />

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[46rem] px-5 pb-16 pt-8 sm:px-10">
            {page ? <Editor pageId={page.id} /> : <EmptyState onCreate={() => void createPage().then(openPage)} />}
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-line bg-sunken text-faint">
        <Icon name="file" size={20} />
      </div>
      <h2 className="mt-4 text-[15px] font-semibold text-ink">No page open</h2>
      <p className="mt-1 max-w-[30ch] text-[13.5px] leading-relaxed text-muted">
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
