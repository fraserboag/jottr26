'use client'

import { Icon } from '@/components/ui/Icon'
import { deleteForever, emptyTrash, restorePage } from '@/lib/db/pages'
import { useTrashedPages } from '@/lib/db/hooks'
import { useWorkspace } from './WorkspaceProvider'

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export function TrashPanel({ onClose }: { onClose: () => void }) {
  const { userId } = useWorkspace()
  const pages = useTrashedPages(userId) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trash"
        className="relative flex max-h-[68vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Icon name="trash" size={16} className="text-faint" />
          <h2 className="flex-1 text-[14px] font-semibold text-ink pointer-coarse:text-[16px]">Trash</h2>
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Permanently delete ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}? This cannot be undone.`)) {
                  void emptyTrash()
                }
              }}
              className="rounded-md px-2 py-1 text-[12.5px] font-medium text-danger transition-colors hover:bg-[var(--hover)] pointer-coarse:py-2 pointer-coarse:text-[14px]"
            >
              Empty trash
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-[var(--hover)] pointer-coarse:size-9"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        {pages.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-faint pointer-coarse:text-[15px]">
            Nothing in the trash.
          </p>
        ) : (
          <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {pages.map((page) => (
              <li
                key={page.id}
                className="group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--hover)]"
              >
                <span className="w-4 shrink-0 text-center text-[13px] leading-5">
                  <Icon name="file" size={14} className="text-faint" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink pointer-coarse:text-[15px]">
                    {page.title || 'Untitled'}
                  </span>
                  <span className="block text-[11.5px] text-faint pointer-coarse:text-[13px]">
                    Deleted {when.format(page.deletedAt)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void restorePage(page.id)}
                  className="rounded-md px-2 py-1 text-[12.5px] font-medium text-accent opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 pointer-coarse:py-2 pointer-coarse:text-[14px] pointer-coarse:opacity-100"
                >
                  Restore
                </button>
                <button
                  type="button"
                  aria-label="Delete permanently"
                  onClick={() => {
                    if (window.confirm('Permanently delete this page and everything inside it?')) {
                      void deleteForever(page.id)
                    }
                  }}
                  className="grid size-7 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
