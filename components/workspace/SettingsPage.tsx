'use client'

import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SyncStatus, useRetrySync } from './SyncControls'
import { useSyncStatus, useWorkspace } from './WorkspaceProvider'
import { setTheme, useTheme, type Theme } from '@/lib/util/theme'
import { WorkspaceSettings } from './WorkspaceSettings'
import { useNoteWorkspaces } from './NoteWorkspacesContext'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
const INLINE_OPTIONS = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] as const

/** The build as MMDDHHMM, in this device's time. */
function buildStamp() {
  const at = new Date(process.env.BUILD_TIME!)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`
}

/** The row the trail takes on a page: on the left the build this device is
 *  running, which the service worker swaps for a new deploy's on a later load,
 *  in the same colour as the trail's last crumb; on the right the
 *  button to sign out, where the trash keeps its Empty trash. */
export function SettingsBar() {
  const { signOut } = useWorkspace()
  const status = useSyncStatus()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <span className="flex h-8 items-center text-faint pointer-coarse:text-[13px]">v{buildStamp()}</span>
      <button
        type="button"
        onClick={() => {
          // Signing out erases the local copy, so unsynced work has to be
          // called out rather than quietly discarded.
          if (status.pending > 0) {
            setConfirming(true)
            return
          }
          void signOut()
        }}
        className="pointer-events-auto ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-sunken px-3 text-[14.5px] font-medium text-danger shadow-[var(--shadow-subtle)] transition-colors hover:bg-[var(--hover)]"
      >
        <Icon name="logout" size={14} />
        Sign out
      </button>
      {confirming && (
        <ConfirmDialog
          title="Sign out with unsynced changes?"
          description={`${status.pending} ${status.pending === 1 ? 'item has' : 'items have'} changes that haven't reached your account yet. Signing out now will discard them.`}
          confirmLabel="Sign out"
          onConfirm={signOut}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}

/** Laid out like a note, as the trash is: a smaller title, then the settings
 *  where the body would be. */
export function SettingsPage() {
  const { session } = useWorkspace()
  const { inline, setInline } = useNoteWorkspaces()
  const retrySync = useRetrySync()

  return (
    <>
      <h1 className="page-title settings-title">Settings</h1>

      <ul className="divide-y divide-line pointer-coarse:text-[15px]">
        <Row label="Account">
          <span className="min-w-0 truncate text-muted">{session?.user.email}</span>
        </Row>
        <Row label="Sync Status">
          <SyncStatus onRetry={() => void retrySync.startSync()} />
        </Row>
        <Row label="Theme">
          <ThemeSwitch />
        </Row>
        <Row label="Show all spaces simultaneously">
          <SegmentedControl label="Show all spaces simultaneously" value={inline ? 'on' : 'off'} options={INLINE_OPTIONS} onChange={(value) => void setInline(value === 'on')} />
        </Row>
      </ul>
      <WorkspaceSettings />
      {retrySync.overlay}
    </>
  )
}

function ThemeSwitch() {
  const theme = useTheme()
  return (
    <SegmentedControl label="Theme" value={theme} options={THEMES} onChange={setTheme} />
  )
}

/** One setting: what it is on the left, its value or control on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 py-2 first:min-h-0 first:pt-0">
      <span className="min-w-0 text-ink">{label}</span>
      <span className="ml-auto flex min-w-0 max-w-full items-center justify-end">{children}</span>
    </li>
  )
}
