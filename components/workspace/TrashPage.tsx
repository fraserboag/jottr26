'use client'

import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useState } from 'react'
import { emptyTrash, restorePage } from '@/lib/db/pages'
import { updateWorkspace } from '@/lib/db/workspaces'
import type { PageRow } from '@/lib/db/schema'
import { useNoteWorkspaces } from './NoteWorkspacesContext'

const when = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const count = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

/** Sits where a page's trail and star would: how many pages are in the trash
 *  on the left, and the button to empty it on the right, in the star's pale
 *  box. */
export function TrashBar({ pages }: { pages: PageRow[] }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <span className="flex h-8 items-center text-faint">{count(pages.length)}</span>
      <button
        type="button"
        disabled={pages.length === 0}
        onClick={() => setConfirming(true)}
        className="pointer-events-auto ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-sunken px-3 text-[14.5px] font-medium text-danger shadow-[var(--shadow-subtle)] transition-colors hover:bg-[var(--hover)]"
      >
        <Icon name="trash" size={16} strokeWidth={1.8} />
        Empty trash
      </button>
      {confirming && (
        <ConfirmDialog
          title="Empty trash?"
          description={`Permanently delete ${count(pages.length)}? This cannot be undone.`}
          confirmLabel="Empty trash"
          onConfirm={() => emptyTrash([...new Set(pages.map((page) => page.workspaceId))])}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}

/** Laid out like a note: the same title, then the trashed pages where the body
 *  would be. It sits in the page's column, so it takes the page's padding. */
export function TrashPage({ pages }: { pages: PageRow[] }) {
  const { active, workspaces } = useNoteWorkspaces()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const showWorkspaceNames = new Set(pages.map((page) => page.workspaceId)).size > 1
    || pages.some((page) => workspaces.find((row) => row.id === page.workspaceId)?.deletedAt)
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return
    setError('')
    setBusy(true)
    try { await work() } catch (error) { setError(error instanceof Error ? error.message : 'Could not update Trash.') }
    finally { setBusy(false) }
  }
  const resolveName = async (id: string) => {
    const workspace = workspaces.find((row) => row.id === id)
    if (!workspace?.deletedAt || !active.some((row) => row.name.toLocaleLowerCase() === workspace.name.toLocaleLowerCase())) return true
    const name = window.prompt('A space with this name already exists. Restore this space as:', `${workspace.name} (restored)`)
    if (name === null) return false
    await updateWorkspace(id, { name }, true)
    return true
  }
  return (
    <>
      <h1 className="page-title">Trash</h1>
      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}
      <TrashedPages
        pages={pages}
        busy={busy}
        labelFor={showWorkspaceNames ? (page) => workspaces.find((row) => row.id === page.workspaceId)?.name : undefined}
        onRestore={(page) => void run(async () => {
          if (await resolveName(page.workspaceId)) await restorePage(page.id)
        })}
      />

    </>
  )
}

function TrashedPages({ pages, onRestore, busy, labelFor }: {
  pages: PageRow[]; onRestore: (page: PageRow) => void; busy: boolean; labelFor?: (page: PageRow) => string | undefined
}) {
  return pages.length > 0 ? (
    <ul>
      {pages.map((page) => {
        const workspaceName = labelFor?.(page)
        return (
            <li key={page.id} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-sunken">
              <span className="flex h-[1lh] w-4 shrink-0 items-center justify-center self-start text-[length:var(--body-size)]">
                <Icon name="file" size={15} className="text-faint" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--body-size)] text-ink">
                  {page.title || 'Untitled'}
                </span>
                <span className="block truncate text-[12.5px] text-faint pointer-coarse:text-[13.5px]">
                  {workspaceName && <>{workspaceName} <span aria-hidden="true">·</span>{' '}</>}
                  Deleted {when.format(page.deletedAt)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRestore(page)}
                className="flex h-[1.6rem] items-center gap-1 self-start px-1 text-[14.5px] font-medium text-accent hover:underline"
              >
                <Icon name="undo" size={15} strokeWidth={1.8} />
                Restore
              </button>
            </li>
          )
      })}
        </ul>
  ) : null
}
