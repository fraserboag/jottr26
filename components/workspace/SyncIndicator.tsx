'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useWorkspace } from './WorkspaceProvider'
import type { SyncPhase } from '@/lib/sync/types'

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function timeAgo(timestamp: number | null) {
  if (!timestamp) return 'not yet'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  if (seconds > -45) return 'just now'
  if (seconds > -3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (seconds > -86400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86400), 'day')
}

const look: Record<SyncPhase, { icon: IconName; tone: string; label: string }> = {
  synced: { icon: 'cloudCheck', tone: 'text-muted', label: 'Synced' },
  syncing: { icon: 'refresh', tone: 'text-muted', label: 'Saving' },
  offline: { icon: 'cloudOff', tone: 'text-warn', label: 'Offline' },
  error: { icon: 'alert', tone: 'text-danger', label: "Can't sync" },
  signedOut: { icon: 'cloudOff', tone: 'text-faint', label: 'Signed out' },
}

export function SyncIndicator() {
  const { status, retrySync, syncNow } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [, forceTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The engine only reports 'syncing' once a round trip is slow enough to be
  // worth mentioning, so there is no timing logic left to do here.
  const visual = look[status.phase]
  const saving = status.phase === 'syncing'

  const detail =
    status.phase === 'error'
      ? (status.error ?? 'Something went wrong.')
      : status.phase === 'offline'
        ? status.pending
          ? `${status.pending} ${status.pending === 1 ? 'page' : 'pages'} waiting to upload.`
          : 'Everything here was uploaded before you went offline.'
        : status.phase === 'syncing'
          ? 'Uploading your latest changes…'
          : `Last synced ${timeAgo(status.lastSyncedAt)}.`

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--hover)] ${visual.tone}`}
        aria-expanded={open}
        aria-label={`Sync status: ${visual.label}`}
      >
        <Icon name={visual.icon} size={15} className={saving ? 'animate-spin' : ''} />
        <span className="truncate font-medium">{saving ? 'Saving…' : visual.label}</span>
        {status.pending > 0 && !saving && (
          <span className="ml-auto rounded-full bg-[var(--active)] px-1.5 py-px text-[11px] font-semibold tabular-nums text-ink">
            {status.pending}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-3.5 shadow-[var(--shadow-pop)]"
        >
          <div className={`flex items-center gap-2 text-[13px] font-semibold ${visual.tone}`}>
            <Icon name={visual.icon} size={15} />
            {status.phase === 'syncing' ? 'Saving to your account' : visual.label}
          </div>

          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{detail}</p>

          {/* The one thing worth repeating in every state: nothing is at risk. */}
          <p className="mt-2.5 border-t border-line pt-2.5 text-[12px] leading-relaxed text-faint">
            Every keystroke is written to this device as you type. Sync is only about
            getting those changes onto your other devices.
          </p>

          {(status.phase === 'error' || status.phase === 'offline' || status.phase === 'synced') && (
            <button
              type="button"
              onClick={() => {
                if (status.phase === 'error') retrySync()
                else syncNow()
                setOpen(false)
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--hover)]"
            >
              <Icon name="refresh" size={14} />
              {status.phase === 'error' ? 'Try again now' : 'Sync now'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
