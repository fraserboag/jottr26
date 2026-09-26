'use client'

import { catchError } from 'next/error'
import { Icon } from '@/components/ui/Icon'

/** Catches the editor failing to load, rather than letting it take the whole
 *  workspace down. The likely cause is its chunk missing offline after a
 *  deploy; a failed lazy import stays failed, so the way out is a reload once
 *  back online, not a retry. */
export const EditorError = catchError(function EditorFallback() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-line bg-sunken text-faint">
        <Icon name="cloudOff" size={20} />
      </div>
      <p className="max-w-[32ch] text-faint">
        This page couldn&apos;t open. Jottr has updated and needs a connection to finish.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="px-1 font-medium text-accent hover:underline pointer-coarse:py-2"
      >
        Reload
      </button>
    </div>
  )
})
