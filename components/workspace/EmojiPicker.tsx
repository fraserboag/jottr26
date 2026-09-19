'use client'

import { setIcon } from '@/lib/db/pages'

/** A fixed shortlist rather than a full emoji index: a searchable picker is a
 *  large dependency and a slow first open, and page icons are decoration. */
const EMOJI = [
  '📄', '📝', '📌', '📎', '🗒️', '📚', '📓', '🗂️',
  '💡', '🎯', '✅', '⭐', '🔥', '🚀', '🧠', '🔧',
  '💬', '📊', '📅', '⏱️', '💰', '🧾', '🏷️', '🔗',
  '🏠', '✈️', '🍳', '🏃', '🎵', '🎬', '🌱', '☕',
]

export function EmojiPicker({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  return (
    <div className="px-1 pb-1 pt-1.5">
      <p className="px-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        Icon
      </p>
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Use ${emoji} as the page icon`}
            onClick={() => {
              void setIcon(pageId, emoji)
              onDone()
            }}
            className="grid size-6 place-items-center rounded text-[14px] leading-none transition-colors hover:bg-[var(--hover)]"
          >
            {emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          void setIcon(pageId, '')
          onDone()
        }}
        className="mt-1 w-full rounded-lg px-1.5 py-1 text-left text-[12.5px] text-faint transition-colors hover:bg-[var(--hover)]"
      >
        Remove icon
      </button>
    </div>
  )
}
