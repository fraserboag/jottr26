import type { SlashHandlers } from './extensions/slash'

/** The slash menu's ProseMirror plugin is built when the editor is created, but
 *  its handlers live in React state that changes on every render. This module
 *  is the seam between them.
 *
 *  A module-level value is enough because Jottr shows exactly one editor at a
 *  time — one open page, one document. The mounted editor claims the bridge and
 *  releases it on unmount. */
let current: SlashHandlers | null = null

export const claimSlashBridge = (handlers: SlashHandlers) => {
  current = handlers
}

export const releaseSlashBridge = (handlers: SlashHandlers) => {
  if (current === handlers) current = null
}

export const slashHandlers = () => current
