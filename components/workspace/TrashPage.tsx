'use client'

import { Icon } from '@/components/ui/Icon'
import { deleteForever, emptyTrash, restorePage } from '@/lib/db/pages'
import { useTrashedPages } from '@/lib/db/hooks'
import { useWorkspace } from './WorkspaceProvider'

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** Laid out like a note: the same title, then the trashed pages where the body
 *  would be. It sits in the page's column, so it takes the page's padding. */
export function TrashPage() {
  const { userId } = useWorkspace()
  const pages = useTrashedPages(userId) ?? []

  return (
    <>
      <div className="flex items-baseline gap-4">
        <h1 className="page-title flex-1">View Trash</h1>
        {pages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Permanently delete ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}? This cannot be undone.`)) {
                void emptyTrash()
              }
            }}
            className="shrink-0 font-medium text-danger hover:underline pointer-coarse:py-2"
          >
            Empty
          </button>
        )}
      </div>

      {pages.length === 0 ? (
        <p className="text-[length:var(--body-size)] text-faint">Empty.</p>
      ) : (
        <ul>
          {pages.map((page) => (
            <li key={page.id} className="flex items-center gap-2 py-2">
              <span className="flex h-[1lh] w-4 shrink-0 items-center justify-center self-start text-[length:var(--body-size)]">
                <Icon name="file" size={15} className="text-faint" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--body-size)] text-ink">
                  {page.title || 'Untitled'}
                </span>
                <span className="block text-[12.5px] text-faint pointer-coarse:text-[13.5px]">
                  Deleted {when.format(page.deletedAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void restorePage(page.id)}
                className="px-1 font-medium text-accent hover:underline pointer-coarse:py-2"
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
                className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:text-danger pointer-coarse:size-9"
              >
                <Icon name="trash" size={18} className="pointer-coarse:size-5" strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
