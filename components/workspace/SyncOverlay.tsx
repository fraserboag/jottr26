'use client'

import { useEffect } from 'react'
import { Icon } from '@/components/ui/Icon'

/** Shown while a sync someone asked for is running. It closes itself when the
 *  sync finishes, and can be cancelled in case the network never answers. A
 *  sync that fails stays up with the reason until it is closed. */
export function SyncOverlay({
  failure,
  onCancel,
  onClose,
}: {
  /** Why the sync did not finish, or null while it is still running. */
  failure: string | null
  onCancel: () => void
  onClose: () => void
}) {
  const dismiss = failure === null ? onCancel : onClose

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onPointerDown={(event) => {
        // A stray click should not abandon a sync; only a finished one closes this way.
        if (failure !== null && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={failure === null ? 'Syncing' : "Couldn't sync"}
        aria-busy={failure === null}
        className="pop-in relative flex w-full max-w-[320px] flex-col items-center rounded-2xl border border-line bg-raised px-5 pt-6 pb-4 text-center shadow-[var(--shadow-pop)]"
      >
        {failure === null ? (
          <>
            <Icon name="refresh" size={22} className="animate-spin text-muted" />
            <h2 className="mt-3 font-semibold text-ink">Syncing</h2>
            <p className="mt-1 leading-relaxed text-muted">
              Uploading your changes and fetching anything new.
            </p>
          </>
        ) : (
          <>
            <Icon name="alert" size={22} className="text-danger" />
            <h2 className="mt-3 font-semibold text-ink">Couldn&apos;t sync</h2>
            <p className="mt-1 leading-relaxed text-muted">{failure}</p>
          </>
        )}

        <button
          type="button"
          autoFocus
          onClick={dismiss}
          className="mt-4 w-full rounded-lg border border-line px-3 py-1.5 font-medium transition-colors hover:bg-[var(--hover)] pointer-coarse:py-2"
        >
          {failure === null ? 'Cancel' : 'Close'}
        </button>
      </div>
    </div>
  )
}
